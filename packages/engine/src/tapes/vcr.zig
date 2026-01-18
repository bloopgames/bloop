const std = @import("std");
const Tapes = @import("tapes.zig");
const Events = @import("../events.zig");
const Log = @import("../log.zig");
const IB = @import("../input_buffer.zig");
const Event = Events.Event;

/// VCR (Video Cassette Recorder) manages tape recording and replay state.
/// This is a controller that coordinates recording/replaying without owning
/// the underlying Sim state it operates on.
pub const VCR = struct {
    tape: ?Tapes.Tape = null,
    is_recording: bool = false,
    is_replaying: bool = false,
    allocator: std.mem.Allocator,

    // Checkpoint support (runtime-only, not persisted to tape)
    checkpoints: std.ArrayList(Checkpoint) = .empty,
    checkpoint_config: CheckpointConfig = .{},
    checkpoint_total_size: u32 = 0,

    pub const CheckpointConfig = struct {
        interval: u32 = 0, // 0 = disabled, else frames between checkpoints
        max_size: u32 = 0, // max bytes for all checkpoints combined
    };

    pub const Checkpoint = struct {
        frame: u32,
        snapshot: *Tapes.Snapshot,
    };

    pub const RecordingError = error{
        AlreadyRecording,
        OutOfMemory,
        TapeError,
    };

    pub fn init(allocator: std.mem.Allocator) VCR {
        return VCR{
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *VCR) void {
        self.clearCheckpoints();
        self.checkpoints.deinit(self.allocator);

        if (self.tape) |*t| {
            t.free(self.allocator);
            self.tape = null;
        }
    }

    /// Start recording to a new tape.
    /// start_frame: The frame number where recording starts (tape header start_frame)
    /// snapshot: Initial state snapshot to store in tape header
    /// max_events: Maximum number of events the tape can hold
    /// max_packet_bytes: Maximum bytes for network packet storage
    pub fn startRecording(self: *VCR, start_frame: u32, snapshot: *Tapes.Snapshot, max_events: u32, max_packet_bytes: u32) RecordingError!void {
        if (self.is_recording) {
            return RecordingError.AlreadyRecording;
        }

        // Free existing tape if any (allows restart after stop_recording)
        if (self.tape) |*t| {
            t.free(self.allocator);
            self.tape = null;
        }

        self.tape = Tapes.Tape.init(self.allocator, start_frame, snapshot, max_events, max_packet_bytes) catch {
            return RecordingError.OutOfMemory;
        };

        self.is_recording = true;

        // Start the first frame marker so events are captured correctly
        self.tape.?.start_frame() catch {
            return RecordingError.TapeError;
        };
    }

    /// Stop recording
    pub fn stopRecording(self: *VCR) void {
        self.is_recording = false;
    }

    /// Load a tape from raw bytes (enters replay mode)
    /// Returns the initial snapshot from the tape for the caller to restore
    pub fn loadTape(self: *VCR, tape_buf: []u8) !*Tapes.Snapshot {
        if (self.is_recording) {
            return error.CurrentlyRecording;
        }

        // Make a copy of the tape buffer
        const copy = try self.allocator.alloc(u8, tape_buf.len);
        @memcpy(copy, tape_buf);

        self.tape = try Tapes.Tape.load(copy);
        self.is_replaying = true;

        // Return initial snapshot for caller to restore
        const snapshot = self.tape.?.closest_snapshot(0);

        // Validate snapshot version
        // v2: added room_code to NetCtx
        // v3: added input_buffer_len for network session tape recording
        // v4: added rand_ctx for deterministic PRNG
        if (snapshot.version < 2 or snapshot.version > 4) {
            Log.log("Snapshot version mismatch: expected 2-4, got {d}", .{snapshot.version});
            return error.UnsupportedVersion;
        }

        return snapshot;
    }

    /// Get the current tape buffer (for serialization)
    pub fn getTapeBuffer(self: *VCR) []u8 {
        if (self.tape) |*t| {
            return t.get_buffer();
        }
        @panic("No tape loaded");
    }

    /// Check if we have a tape loaded (recording or replaying)
    pub fn hasTape(self: *const VCR) bool {
        return self.tape != null;
    }

    /// Get the match_frame at which the tape started (from the tape's snapshot)
    pub fn getTapeStartMatchFrame(self: *const VCR) u32 {
        if (self.tape) |tape| {
            // Read snapshot directly from tape buffer
            const header: *Tapes.TapeHeader = @ptrCast(@alignCast(tape.buf.ptr));
            const snapshot_offset = header.snapshot_offset;
            const snapshot_slice = tape.buf[snapshot_offset .. snapshot_offset + @sizeOf(Tapes.Snapshot)];
            const snapshot: *const Tapes.Snapshot = @ptrCast(@alignCast(snapshot_slice.ptr));
            return snapshot.net.match_frame;
        }
        return 0;
    }

    /// Record an event to tape (if recording)
    pub fn recordEvent(self: *VCR, event: Event) bool {
        if (!self.is_recording or self.is_replaying) return true;

        if (self.tape) |*t| {
            t.append_event(event) catch {
                return false; // Tape full
            };
        }
        return true;
    }

    /// Record a packet to tape (if recording)
    /// Returns false if recording failed (e.g., packet buffer full)
    pub fn recordPacket(self: *VCR, frame: u32, peer_id: u8, data: []const u8) bool {
        if (!self.is_recording) return true;

        if (self.tape) |*t| {
            t.append_packet(frame, peer_id, data) catch {
                return false; // Packet buffer full
            };
        }
        return true;
    }

    /// Advance frame marker in tape (if recording and not replaying/resimulating)
    pub fn advanceFrame(self: *VCR) bool {
        if (!self.is_recording or self.is_replaying) return true;

        if (self.tape) |*t| {
            t.start_frame() catch return false;
        }
        return true;
    }

    /// Get events for a frame from tape (for replay)
    pub fn getEventsForFrame(self: *VCR, frame: u32) []const Event {
        if (self.tape) |*t| {
            return t.get_events(frame);
        }
        @panic("No tape loaded");
    }

    /// Get packet iterator for a frame from tape (for replay)
    pub fn getPacketsForFrame(self: *VCR, frame: u32) Tapes.Tape.PacketIterator {
        if (self.tape) |*t| {
            return t.get_packets_for_frame(frame);
        }
        @panic("No tape loaded");
    }

    /// Get closest snapshot for seeking (checks both checkpoints and initial tape snapshot)
    pub fn closestSnapshot(self: *VCR, frame: u32) *Tapes.Snapshot {
        if (self.tape == null) {
            @panic("No tape loaded");
        }

        // Find closest checkpoint at or before target frame using binary search
        var best_checkpoint: ?*Tapes.Snapshot = null;
        var best_frame: u32 = 0;

        if (self.checkpoints.items.len > 0) {
            // Binary search for largest frame <= target
            var low: usize = 0;
            var high: usize = self.checkpoints.items.len;

            while (low < high) {
                const mid = low + (high - low) / 2;
                if (self.checkpoints.items[mid].frame <= frame) {
                    low = mid + 1;
                } else {
                    high = mid;
                }
            }

            // low is now the index of first checkpoint > frame, so low-1 is the closest <= frame
            if (low > 0) {
                const cp = &self.checkpoints.items[low - 1];
                best_checkpoint = cp.snapshot;
                best_frame = cp.frame;
            }
        }

        // Compare with tape's initial snapshot
        const tape_snapshot = self.tape.?.closest_snapshot(frame);
        const tape_frame = tape_snapshot.time.frame;

        // Return whichever is closer to (but not past) the target frame
        if (best_checkpoint) |cp| {
            if (best_frame >= tape_frame) {
                return cp;
            }
        }

        return tape_snapshot;
    }

    /// Exit replay mode (used after seek completes)
    pub fn exitReplayMode(self: *VCR) void {
        self.is_replaying = false;
    }

    /// Enter replay mode (used during seek)
    pub fn enterReplayMode(self: *VCR) void {
        self.is_replaying = true;
    }

    // ─────────────────────────────────────────────────────────────
    // Checkpoint Methods (for seek performance optimization)
    // ─────────────────────────────────────────────────────────────

    /// Configure checkpoint behavior
    pub fn configureCheckpoints(self: *VCR, interval: u32, max_size: u32) void {
        self.checkpoint_config = .{
            .interval = interval,
            .max_size = max_size,
        };
    }

    /// Clear all checkpoints and free their memory
    pub fn clearCheckpoints(self: *VCR) void {
        for (self.checkpoints.items) |cp| {
            cp.snapshot.deinit(self.allocator);
        }
        self.checkpoints.clearRetainingCapacity();
        self.checkpoint_total_size = 0;
    }

    /// Check if we should create a checkpoint at this frame
    /// Returns true if: interval is configured, frame is on interval boundary,
    /// and we have budget remaining
    pub fn shouldCheckpoint(self: *VCR, frame: u32) bool {
        const interval = self.checkpoint_config.interval;
        if (interval == 0) return false;
        if (frame == 0) return false; // Don't checkpoint frame 0 (tape has that)
        if (frame % interval != 0) return false;

        // Check if we already have a checkpoint at this frame
        for (self.checkpoints.items) |cp| {
            if (cp.frame == frame) return false;
        }

        return true;
    }

    /// Store a checkpoint if within size budget
    /// The snapshot ownership is transferred to VCR (will be freed on clear/deinit)
    pub fn storeCheckpoint(self: *VCR, frame: u32, snapshot: *Tapes.Snapshot) void {
        const snapshot_size = @sizeOf(Tapes.Snapshot) + snapshot.user_data_len;

        // Check size budget
        if (self.checkpoint_config.max_size > 0 and
            self.checkpoint_total_size + snapshot_size > self.checkpoint_config.max_size)
        {
            // Over budget - don't store, free the snapshot
            snapshot.deinit(self.allocator);
            return;
        }

        // Insert in sorted order by frame (maintain sorted for binary search)
        var insert_idx: usize = self.checkpoints.items.len;
        for (self.checkpoints.items, 0..) |cp, i| {
            if (cp.frame > frame) {
                insert_idx = i;
                break;
            }
        }

        self.checkpoints.insert(self.allocator, insert_idx, Checkpoint{
            .frame = frame,
            .snapshot = snapshot,
        }) catch {
            // Allocation failed, free the snapshot
            snapshot.deinit(self.allocator);
            return;
        };

        self.checkpoint_total_size += snapshot_size;
    }
};

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

test "VCR init and deinit" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    try std.testing.expectEqual(false, vcr.is_recording);
    try std.testing.expectEqual(false, vcr.is_replaying);
    try std.testing.expectEqual(null, vcr.tape);
}

test "VCR startRecording fails if already recording" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    // Create a minimal snapshot for testing
    const snap = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    defer snap.deinit(std.testing.allocator);

    try vcr.startRecording(0, snap, 1024, 0);
    try std.testing.expectEqual(true, vcr.is_recording);

    // Second call should fail
    const result = vcr.startRecording(0, snap, 1024, 0);
    try std.testing.expectError(VCR.RecordingError.AlreadyRecording, result);
}

test "VCR stopRecording" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    const snap = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    defer snap.deinit(std.testing.allocator);

    try vcr.startRecording(0, snap, 1024, 0);
    try std.testing.expectEqual(true, vcr.is_recording);

    vcr.stopRecording();
    try std.testing.expectEqual(false, vcr.is_recording);

    // Tape should still exist (not freed until deinit or new recording)
    try std.testing.expect(vcr.tape != null);
}

test "VCR hasTape" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    try std.testing.expectEqual(false, vcr.hasTape());

    const snap = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    defer snap.deinit(std.testing.allocator);

    try vcr.startRecording(0, snap, 1024, 0);
    try std.testing.expectEqual(true, vcr.hasTape());
}

test "VCR recordEvent" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    // Recording without tape does nothing
    try std.testing.expectEqual(true, vcr.recordEvent(Event.keyDown(.KeyA, 0, .LocalKeyboard)));

    const snap = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    defer snap.deinit(std.testing.allocator);

    try vcr.startRecording(0, snap, 1024, 0);

    // Recording with tape works
    try std.testing.expectEqual(true, vcr.recordEvent(Event.keyDown(.KeyA, 0, .LocalKeyboard)));
}

// ─────────────────────────────────────────────────────────────
// Checkpoint Tests
// ─────────────────────────────────────────────────────────────

test "VCR configureCheckpoints" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    try std.testing.expectEqual(@as(u32, 0), vcr.checkpoint_config.interval);
    try std.testing.expectEqual(@as(u32, 0), vcr.checkpoint_config.max_size);

    vcr.configureCheckpoints(120, 1024 * 1024);
    try std.testing.expectEqual(@as(u32, 120), vcr.checkpoint_config.interval);
    try std.testing.expectEqual(@as(u32, 1024 * 1024), vcr.checkpoint_config.max_size);
}

test "VCR shouldCheckpoint respects interval" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    // Disabled by default (interval = 0)
    try std.testing.expectEqual(false, vcr.shouldCheckpoint(120));

    vcr.configureCheckpoints(120, 10 * 1024 * 1024);

    // Frame 0 should not checkpoint (tape has that)
    try std.testing.expectEqual(false, vcr.shouldCheckpoint(0));

    // Frames on interval boundary should checkpoint
    try std.testing.expectEqual(true, vcr.shouldCheckpoint(120));
    try std.testing.expectEqual(true, vcr.shouldCheckpoint(240));
    try std.testing.expectEqual(true, vcr.shouldCheckpoint(360));

    // Frames not on boundary should not
    try std.testing.expectEqual(false, vcr.shouldCheckpoint(121));
    try std.testing.expectEqual(false, vcr.shouldCheckpoint(119));
    try std.testing.expectEqual(false, vcr.shouldCheckpoint(60));
}

test "VCR storeCheckpoint and clearCheckpoints" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    vcr.configureCheckpoints(120, 10 * 1024 * 1024);

    // Store a checkpoint
    const snap1 = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    snap1.time.frame = 120;
    vcr.storeCheckpoint(120, snap1);

    try std.testing.expectEqual(@as(usize, 1), vcr.checkpoints.items.len);
    try std.testing.expectEqual(@as(u32, 120), vcr.checkpoints.items[0].frame);

    // Store another checkpoint
    const snap2 = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    snap2.time.frame = 240;
    vcr.storeCheckpoint(240, snap2);

    try std.testing.expectEqual(@as(usize, 2), vcr.checkpoints.items.len);

    // Clear checkpoints
    vcr.clearCheckpoints();
    try std.testing.expectEqual(@as(usize, 0), vcr.checkpoints.items.len);
    try std.testing.expectEqual(@as(u32, 0), vcr.checkpoint_total_size);
}

test "VCR storeCheckpoint maintains sorted order" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    vcr.configureCheckpoints(60, 10 * 1024 * 1024);

    // Store checkpoints out of order
    const snap3 = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    snap3.time.frame = 180;
    vcr.storeCheckpoint(180, snap3);

    const snap1 = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    snap1.time.frame = 60;
    vcr.storeCheckpoint(60, snap1);

    const snap2 = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    snap2.time.frame = 120;
    vcr.storeCheckpoint(120, snap2);

    // Should be sorted by frame
    try std.testing.expectEqual(@as(u32, 60), vcr.checkpoints.items[0].frame);
    try std.testing.expectEqual(@as(u32, 120), vcr.checkpoints.items[1].frame);
    try std.testing.expectEqual(@as(u32, 180), vcr.checkpoints.items[2].frame);
}

test "VCR storeCheckpoint respects size budget" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    // Set a small budget (just enough for 1 snapshot with no user data)
    const snapshot_size = @sizeOf(Tapes.Snapshot);
    vcr.configureCheckpoints(60, snapshot_size);

    // First checkpoint should be stored
    const snap1 = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    snap1.time.frame = 60;
    vcr.storeCheckpoint(60, snap1);
    try std.testing.expectEqual(@as(usize, 1), vcr.checkpoints.items.len);

    // Second checkpoint should be rejected (over budget)
    const snap2 = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    snap2.time.frame = 120;
    vcr.storeCheckpoint(120, snap2);
    try std.testing.expectEqual(@as(usize, 1), vcr.checkpoints.items.len);
}

test "VCR shouldCheckpoint avoids duplicates" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    vcr.configureCheckpoints(120, 10 * 1024 * 1024);

    // Frame 120 should checkpoint
    try std.testing.expectEqual(true, vcr.shouldCheckpoint(120));

    // Store a checkpoint at frame 120
    const snap = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    snap.time.frame = 120;
    vcr.storeCheckpoint(120, snap);

    // Now frame 120 should NOT checkpoint (already exists)
    try std.testing.expectEqual(false, vcr.shouldCheckpoint(120));
}

test "VCR closestSnapshot uses checkpoints" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    // Create initial snapshot and start recording
    const initial_snap = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    defer initial_snap.deinit(std.testing.allocator);
    initial_snap.time.frame = 0;
    try vcr.startRecording(0, initial_snap, 1024, 0);

    vcr.configureCheckpoints(100, 10 * 1024 * 1024);

    // Store checkpoints at frames 100 and 200
    const snap100 = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    snap100.time.frame = 100;
    vcr.storeCheckpoint(100, snap100);

    const snap200 = try Tapes.Snapshot.init(std.testing.allocator, 0, 0);
    snap200.time.frame = 200;
    vcr.storeCheckpoint(200, snap200);

    // Seeking to frame 50 should use initial snapshot (frame 0)
    const closest50 = vcr.closestSnapshot(50);
    try std.testing.expectEqual(@as(u32, 0), closest50.time.frame);

    // Seeking to frame 150 should use checkpoint at 100
    const closest150 = vcr.closestSnapshot(150);
    try std.testing.expectEqual(@as(u32, 100), closest150.time.frame);

    // Seeking to frame 250 should use checkpoint at 200
    const closest250 = vcr.closestSnapshot(250);
    try std.testing.expectEqual(@as(u32, 200), closest250.time.frame);

    // Seeking to exact checkpoint frame should use that checkpoint
    const closest100 = vcr.closestSnapshot(100);
    try std.testing.expectEqual(@as(u32, 100), closest100.time.frame);
}
