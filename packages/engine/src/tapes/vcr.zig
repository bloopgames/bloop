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
        if (self.tape) |*t| {
            t.free(self.allocator);
            self.tape = null;
        }
    }

    /// Start recording to a new tape.
    /// snapshot: Initial state snapshot to store in tape header
    /// max_events: Maximum number of events the tape can hold
    /// max_packet_bytes: Maximum bytes for network packet storage
    pub fn startRecording(self: *VCR, snapshot: *Tapes.Snapshot, max_events: u32, max_packet_bytes: u32) RecordingError!void {
        if (self.is_recording) {
            return RecordingError.AlreadyRecording;
        }

        // Free existing tape if any (allows restart after stop_recording)
        if (self.tape) |*t| {
            t.free(self.allocator);
            self.tape = null;
        }

        self.tape = Tapes.Tape.init(self.allocator, snapshot, max_events, max_packet_bytes) catch {
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

        // Validate snapshot version - version 2 added room_code to NetCtx
        if (snapshot.version != 2) {
            Log.log("Snapshot version mismatch: expected 2, got {d}", .{snapshot.version});
            return error.UnsupportedVersion;
        }

        return snapshot;
    }

    /// Get the current tape buffer (for serialization)
    pub fn getTapeBuffer(self: *VCR) ?[]u8 {
        if (self.tape) |*t| {
            return t.get_buffer();
        }
        return null;
    }

    /// Check if we have a tape loaded (recording or replaying)
    pub fn hasTape(self: *const VCR) bool {
        return self.tape != null;
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
    pub fn recordPacket(self: *VCR, frame: u32, peer_id: u8, data: []const u8) void {
        if (!self.is_recording) return;

        if (self.tape) |*t| {
            t.append_packet(frame, peer_id, data) catch {};
        }
    }

    /// Advance frame marker in tape (if recording and not replaying/resimulating)
    pub fn advanceFrame(self: *VCR) bool {
        if (!self.is_recording or self.is_replaying) return true;

        if (self.tape) |*t| {
            t.start_frame() catch {
                return false; // Tape full
            };
        }
        return true;
    }

    /// Get events for a frame from tape (for replay)
    pub fn getEventsForFrame(self: *VCR, frame: u32) []const Event {
        if (self.tape) |*t| {
            return t.get_events(frame);
        }
        return &[_]Event{};
    }

    /// Get packet iterator for a frame from tape (for replay)
    pub fn getPacketsForFrame(self: *VCR, frame: u32) ?Tapes.Tape.PacketIterator {
        if (self.tape) |*t| {
            return t.get_packets_for_frame(frame);
        }
        return null;
    }

    /// Get closest snapshot for seeking
    pub fn closestSnapshot(self: *VCR, frame: u32) ?*Tapes.Snapshot {
        if (self.tape) |*t| {
            return t.closest_snapshot(frame);
        }
        return null;
    }

    /// Exit replay mode (used after seek completes)
    pub fn exitReplayMode(self: *VCR) void {
        self.is_replaying = false;
    }

    /// Enter replay mode (used during seek)
    pub fn enterReplayMode(self: *VCR) void {
        self.is_replaying = true;
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
    const snap = try Tapes.Snapshot.init(std.testing.allocator, 0);
    defer snap.deinit(std.testing.allocator);

    try vcr.startRecording(snap, 1024, 0);
    try std.testing.expectEqual(true, vcr.is_recording);

    // Second call should fail
    const result = vcr.startRecording(snap, 1024, 0);
    try std.testing.expectError(VCR.RecordingError.AlreadyRecording, result);
}

test "VCR stopRecording" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    const snap = try Tapes.Snapshot.init(std.testing.allocator, 0);
    defer snap.deinit(std.testing.allocator);

    try vcr.startRecording(snap, 1024, 0);
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

    const snap = try Tapes.Snapshot.init(std.testing.allocator, 0);
    defer snap.deinit(std.testing.allocator);

    try vcr.startRecording(snap, 1024, 0);
    try std.testing.expectEqual(true, vcr.hasTape());
}

test "VCR recordEvent" {
    var vcr = VCR.init(std.testing.allocator);
    defer vcr.deinit();

    // Recording without tape does nothing
    try std.testing.expectEqual(true, vcr.recordEvent(Event.keyDown(.KeyA, 0, .LocalKeyboard)));

    const snap = try Tapes.Snapshot.init(std.testing.allocator, 0);
    defer snap.deinit(std.testing.allocator);

    try vcr.startRecording(snap, 1024, 0);

    // Recording with tape works
    try std.testing.expectEqual(true, vcr.recordEvent(Event.keyDown(.KeyA, 0, .LocalKeyboard)));
}
