const std = @import("std");
const Events = @import("events.zig");
const Event = Events.Event;
const Tapes = @import("tapes/tapes.zig");

pub const MAX_PEERS = 12;
pub const MAX_FRAMES = 500;
pub const MAX_EVENTS_PER_FRAME = 16;

/// A single frame's worth of inputs for one peer.
/// The match_frame field acts as a sentinel to detect stale ring buffer data.
pub const InputSlot = struct {
    events: [MAX_EVENTS_PER_FRAME]Event = undefined,
    count: u8 = 0,
    /// Which match frame this slot represents. Used to detect stale data after wraparound.
    match_frame: u32 = 0,

    pub fn clear(self: *InputSlot) void {
        self.count = 0;
    }

    pub fn add(self: *InputSlot, event: Event) error{SlotFull}!void {
        if (self.count >= MAX_EVENTS_PER_FRAME) {
            return error.SlotFull;
        }
        self.events[self.count] = event;
        self.count += 1;
    }

    pub fn slice(self: *const InputSlot) []const Event {
        return self.events[0..self.count];
    }
};

/// Observer callback for input events.
/// Called when an input is added to the canonical buffer.
pub const InputObserver = struct {
    callback: *const fn (ctx: *anyopaque, peer: u8, match_frame: u32, event: Event) void,
    context: *anyopaque,

    pub fn notify(self: InputObserver, peer: u8, match_frame: u32, event: Event) void {
        self.callback(self.context, peer, match_frame, event);
    }
};

/// Canonical input buffer - single source of truth for all inputs.
///
/// All inputs (local or remote) are written here with match_frame tagging.
/// Local play is a special case where peer_count=1 and match_frame == time.frame - session_start_frame.
///
/// Tape recording, packet building, and rollback resimulation are all views onto this buffer.
pub const InputBuffer = struct {
    /// Ring buffer: slots[peer][match_frame % MAX_FRAMES]
    slots: [MAX_PEERS][MAX_FRAMES]InputSlot = [_][MAX_FRAMES]InputSlot{[_]InputSlot{.{}} ** MAX_FRAMES} ** MAX_PEERS,

    /// Per-peer confirmed frame (inputs received up to this frame, -1 = no inputs yet)
    peer_confirmed: [MAX_PEERS]i32 = [_]i32{-1} ** MAX_PEERS,

    /// Session configuration
    peer_count: u8 = 1,
    session_start_frame: u32 = 0,

    /// Observer for input events (e.g., tape recording)
    observer: ?InputObserver = null,

    /// Initialize for a session.
    /// Call this when starting a session or when using local play (peer_count=1).
    pub fn init(self: *InputBuffer, peer_count: u8, session_start_frame: u32) void {
        self.peer_count = peer_count;
        self.session_start_frame = session_start_frame;
        // Reset confirmed frames to -1 (no inputs received yet)
        for (0..MAX_PEERS) |i| {
            self.peer_confirmed[i] = -1;
        }
    }

    /// Emit inputs for a peer at a given match frame.
    /// This is the unified write API - works for any peer (local or remote).
    /// Observer is notified for each event (used for tape recording).
    pub fn emit(self: *InputBuffer, peer: u8, match_frame: u32, events: []const Event) void {
        if (peer >= self.peer_count) return;

        const slot_idx = match_frame % MAX_FRAMES;
        var slot = &self.slots[peer][slot_idx];

        // Only clear if this slot was for a different frame (preserves multiple events per frame)
        if (slot.match_frame != match_frame) {
            slot.clear();
            slot.match_frame = match_frame;
        }

        for (events) |event| {
            slot.add(event) catch {
                // Slot full - log and continue
                // In production this is a soft error, not a crash
            };

            // Notify observer for each event
            if (self.observer) |obs| {
                obs.notify(peer, match_frame, event);
            }
        }

        // Update confirmed frame for this peer
        const match_frame_i32 = @as(i32, @intCast(match_frame));
        if (match_frame_i32 > self.peer_confirmed[peer]) {
            self.peer_confirmed[peer] = match_frame_i32;
        }
    }

    /// Get inputs for a peer at a given match frame.
    /// Returns empty slice if the slot doesn't contain data for the requested frame.
    pub fn get(self: *const InputBuffer, peer: u8, match_frame: u32) []const Event {
        if (peer >= self.peer_count) return &[_]Event{};

        const slot_idx = match_frame % MAX_FRAMES;
        const slot = &self.slots[peer][slot_idx];

        // Check sentinel to detect stale data
        if (slot.match_frame != match_frame) {
            return &[_]Event{};
        }
        return slot.slice();
    }

    /// Convert absolute frame to match frame (0-indexed from session start).
    pub fn toMatchFrame(self: *const InputBuffer, absolute_frame: u32) u32 {
        return absolute_frame - self.session_start_frame;
    }

    /// Convert match frame to absolute frame.
    pub fn toAbsoluteFrame(self: *const InputBuffer, match_frame: u32) u32 {
        return match_frame + self.session_start_frame;
    }

    /// Calculate the next confirmable frame (minimum across all peers).
    /// Returns -1 if any peer has no confirmed inputs yet.
    pub fn calculateNextConfirmFrame(self: *const InputBuffer, current_match_frame: u32) i32 {
        var min_frame: i32 = @intCast(current_match_frame);
        for (0..self.peer_count) |i| {
            const peer_frame = self.peer_confirmed[i];
            if (peer_frame < min_frame) {
                min_frame = peer_frame;
            }
        }
        return min_frame;
    }

    // ========================================================================
    // Snapshot Support
    // ========================================================================

    /// Calculate the size needed for snapshot data.
    /// Returns the total bytes needed for InputBufferSnapshotHeader + all unconfirmed events.
    pub fn snapshotSize(self: *const InputBuffer, current_match_frame: u32) u32 {
        // For single-player (peer_count <= 1), no input buffer snapshot needed
        if (self.peer_count <= 1) return 0;

        var event_count: u32 = 0;
        const min_confirmed = self.calculateNextConfirmFrame(current_match_frame);
        // If min_confirmed is -1 (no inputs yet), start from 0
        const start_frame: u32 = if (min_confirmed < 0) 0 else @intCast(min_confirmed);

        // Count events across all peers from start_frame to current_match_frame
        for (0..self.peer_count) |peer| {
            var frame = start_frame;
            while (frame <= current_match_frame) : (frame += 1) {
                const slot = &self.slots[peer][frame % MAX_FRAMES];
                // Only count if slot is for the correct frame (not stale)
                if (slot.match_frame == frame) {
                    event_count += slot.count;
                }
            }
        }

        return @sizeOf(Tapes.InputBufferSnapshotHeader) + event_count * @sizeOf(Tapes.SnapshotWireEvent);
    }

    /// Write snapshot data to buffer.
    /// Buffer must be at least snapshotSize() bytes.
    pub fn writeSnapshot(self: *const InputBuffer, current_match_frame: u32, buf: []u8) void {
        if (buf.len == 0) return;

        const min_confirmed = self.calculateNextConfirmFrame(current_match_frame);
        // If min_confirmed is -1 (no inputs yet), start from 0
        const start_frame: u32 = if (min_confirmed < 0) 0 else @intCast(min_confirmed);

        // Write header
        var header = Tapes.InputBufferSnapshotHeader{
            .peer_confirmed = undefined,
            .peer_count = self.peer_count,
            .event_count = 0,
        };

        // Copy peer_confirmed
        for (0..MAX_PEERS) |i| {
            header.peer_confirmed[i] = self.peer_confirmed[i];
        }

        // Count and write events
        var write_offset: usize = @sizeOf(Tapes.InputBufferSnapshotHeader);

        for (0..self.peer_count) |peer| {
            var frame = start_frame;
            while (frame <= current_match_frame) : (frame += 1) {
                const slot = &self.slots[peer][frame % MAX_FRAMES];
                // Only include if slot is for the correct frame (not stale)
                if (slot.match_frame == frame) {
                    for (slot.slice()) |event| {
                        const wire_event = Tapes.SnapshotWireEvent.fromEvent(
                            event,
                            @intCast(peer),
                            @truncate(frame), // u16 truncation - assumes match_frame < 65536
                        );
                        const event_bytes = std.mem.asBytes(&wire_event);
                        @memcpy(buf[write_offset .. write_offset + @sizeOf(Tapes.SnapshotWireEvent)], event_bytes);
                        write_offset += @sizeOf(Tapes.SnapshotWireEvent);
                        header.event_count += 1;
                    }
                }
            }
        }

        // Write header at the beginning
        const header_bytes = std.mem.asBytes(&header);
        @memcpy(buf[0..@sizeOf(Tapes.InputBufferSnapshotHeader)], header_bytes);
    }

    /// Restore input buffer state from snapshot.
    /// Sets peer_confirmed and emits all unconfirmed events into the buffer.
    pub fn restoreFromSnapshot(self: *InputBuffer, buf: []const u8) void {
        if (buf.len < @sizeOf(Tapes.InputBufferSnapshotHeader)) return;

        // Read header using memcpy to avoid alignment issues
        var header: Tapes.InputBufferSnapshotHeader = undefined;
        @memcpy(std.mem.asBytes(&header), buf[0..@sizeOf(Tapes.InputBufferSnapshotHeader)]);

        // Restore peer_confirmed
        for (0..MAX_PEERS) |i| {
            self.peer_confirmed[i] = header.peer_confirmed[i];
        }
        self.peer_count = header.peer_count;

        // Temporarily disable observer to prevent recording restored events
        const saved_observer = self.observer;
        self.observer = null;
        defer self.observer = saved_observer;

        // Read and emit events
        var read_offset: usize = @sizeOf(Tapes.InputBufferSnapshotHeader);
        for (0..header.event_count) |_| {
            // Read wire event using memcpy to avoid alignment issues
            var wire_event: Tapes.SnapshotWireEvent = undefined;
            @memcpy(std.mem.asBytes(&wire_event), buf[read_offset .. read_offset + @sizeOf(Tapes.SnapshotWireEvent)]);

            const event = wire_event.toEvent();
            const match_frame: u32 = wire_event.frame;

            // Emit single event into buffer
            self.emitSingleEvent(wire_event.peer_id, match_frame, event);

            read_offset += @sizeOf(Tapes.SnapshotWireEvent);
        }
    }

    /// Emit a single event (helper for restore, bypasses observer since it's null during restore)
    fn emitSingleEvent(self: *InputBuffer, peer: u8, match_frame: u32, event: Event) void {
        if (peer >= self.peer_count) return;

        const slot_idx = match_frame % MAX_FRAMES;
        var slot = &self.slots[peer][slot_idx];

        // Only clear if this slot was for a different frame
        if (slot.match_frame != match_frame) {
            slot.clear();
            slot.match_frame = match_frame;
        }

        slot.add(event) catch {
            // Slot full - silently ignore during restore
        };

        // Don't update peer_confirmed here - it's already set from header
    }
};

// ============================================================================
// Frame space utilities (standalone functions)
// ============================================================================

/// Convert absolute frame to match frame.
pub fn toMatchFrame(absolute: u32, session_start: u32) u32 {
    return absolute - session_start;
}

/// Convert match frame to absolute frame.
pub fn toAbsoluteFrame(match_frame: u32, session_start: u32) u32 {
    return match_frame + session_start;
}

// ============================================================================
// Tests
// ============================================================================

test "InputSlot basic operations" {
    var slot = InputSlot{};

    try std.testing.expectEqual(@as(u8, 0), slot.count);
    try std.testing.expectEqual(@as(usize, 0), slot.slice().len);

    try slot.add(Event.keyDown(.KeyA, 0, .LocalKeyboard));
    try slot.add(Event.keyDown(.KeyB, 0, .LocalKeyboard));

    try std.testing.expectEqual(@as(u8, 2), slot.count);
    try std.testing.expectEqual(@as(usize, 2), slot.slice().len);
    try std.testing.expectEqual(Events.Key.KeyA, slot.slice()[0].payload.key);
    try std.testing.expectEqual(Events.Key.KeyB, slot.slice()[1].payload.key);
}

test "InputSlot clear" {
    var slot = InputSlot{};
    try slot.add(Event.keyDown(.KeyA, 0, .LocalKeyboard));

    slot.clear();
    try std.testing.expectEqual(@as(u8, 0), slot.count);
    try std.testing.expectEqual(@as(usize, 0), slot.slice().len);
}

test "InputSlot max capacity" {
    var slot = InputSlot{};

    // Fill to capacity
    for (0..MAX_EVENTS_PER_FRAME) |_| {
        try slot.add(Event.keyDown(.KeyA, 0, .LocalKeyboard));
    }
    try std.testing.expectEqual(@as(u8, MAX_EVENTS_PER_FRAME), slot.count);

    // Try to add one more - should error
    try std.testing.expectError(error.SlotFull, slot.add(Event.keyDown(.KeyB, 0, .LocalKeyboard)));
}

test "InputBuffer emit and get round-trip" {
    var buffer = InputBuffer{};
    buffer.init(2, 100);

    const events = [_]Event{
        Event.keyDown(.KeyA, 0, .LocalKeyboard),
        Event.keyDown(.KeyW, 0, .LocalKeyboard),
    };
    buffer.emit(0, 5, &events);

    const retrieved = buffer.get(0, 5);
    try std.testing.expectEqual(@as(usize, 2), retrieved.len);
    try std.testing.expectEqual(Events.Key.KeyA, retrieved[0].payload.key);
    try std.testing.expectEqual(Events.Key.KeyW, retrieved[1].payload.key);

    // Verify peer_confirmed was updated
    try std.testing.expectEqual(@as(i32, 5), buffer.peer_confirmed[0]);
}

test "InputBuffer ring buffer wraparound" {
    var buffer = InputBuffer{};
    buffer.init(1, 0);

    // Emit at frame 0
    const events0 = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
    buffer.emit(0, 0, &events0);

    // Emit at frame MAX_FRAMES (should wrap to same slot)
    const eventsWrap = [_]Event{Event.keyDown(.KeyB, 0, .LocalKeyboard)};
    buffer.emit(0, MAX_FRAMES, &eventsWrap);

    // Frame 0's slot should now have frame MAX_FRAMES's data
    const retrieved = buffer.get(0, MAX_FRAMES);
    try std.testing.expectEqual(@as(usize, 1), retrieved.len);
    try std.testing.expectEqual(Events.Key.KeyB, retrieved[0].payload.key);

    // Frame 0 should return empty (stale sentinel)
    const stale = buffer.get(0, 0);
    try std.testing.expectEqual(@as(usize, 0), stale.len);
}

test "InputBuffer stale slot detection" {
    var buffer = InputBuffer{};
    buffer.init(2, 0);

    // Emit event for peer 1 at frame 109
    const events = [_]Event{Event.mouseDown(.Left, 1, .LocalMouse)};
    buffer.emit(1, 109, &events);

    // Should get the event for frame 109
    const retrieved109 = buffer.get(1, 109);
    try std.testing.expectEqual(@as(usize, 1), retrieved109.len);

    // Frame 109 + MAX_FRAMES maps to same slot
    // But we never emitted events for that frame, so should get empty
    const stale = buffer.get(1, 109 + MAX_FRAMES);
    try std.testing.expectEqual(@as(usize, 0), stale.len);

    // Frame 110 also has no events
    const retrieved110 = buffer.get(1, 110);
    try std.testing.expectEqual(@as(usize, 0), retrieved110.len);
}

test "InputBuffer observer callback" {
    const TestCtx = struct {
        call_count: u32 = 0,
        last_peer: u8 = 0,
        last_frame: u32 = 0,

        fn callback(ctx: *anyopaque, peer: u8, match_frame: u32, _: Event) void {
            const self: *@This() = @ptrCast(@alignCast(ctx));
            self.call_count += 1;
            self.last_peer = peer;
            self.last_frame = match_frame;
        }
    };

    var ctx = TestCtx{};
    var buffer = InputBuffer{};
    buffer.init(2, 0);
    buffer.observer = InputObserver{
        .callback = TestCtx.callback,
        .context = @ptrCast(&ctx),
    };

    // Emit 2 events
    const events = [_]Event{
        Event.keyDown(.KeyA, 0, .LocalKeyboard),
        Event.keyDown(.KeyB, 0, .LocalKeyboard),
    };
    buffer.emit(1, 42, &events);

    // Observer should have been called twice
    try std.testing.expectEqual(@as(u32, 2), ctx.call_count);
    try std.testing.expectEqual(@as(u8, 1), ctx.last_peer);
    try std.testing.expectEqual(@as(u32, 42), ctx.last_frame);
}

test "InputBuffer multi-peer isolation" {
    var buffer = InputBuffer{};
    buffer.init(3, 0);

    // Emit different events for each peer at the same frame
    const events0 = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
    const events1 = [_]Event{Event.keyDown(.KeyB, 1, .LocalKeyboard)};
    const events2 = [_]Event{Event.keyDown(.KeyC, 2, .LocalKeyboard)};

    buffer.emit(0, 10, &events0);
    buffer.emit(1, 10, &events1);
    buffer.emit(2, 10, &events2);

    // Each peer should have their own events
    try std.testing.expectEqual(Events.Key.KeyA, buffer.get(0, 10)[0].payload.key);
    try std.testing.expectEqual(Events.Key.KeyB, buffer.get(1, 10)[0].payload.key);
    try std.testing.expectEqual(Events.Key.KeyC, buffer.get(2, 10)[0].payload.key);
}

test "InputBuffer toMatchFrame and toAbsoluteFrame" {
    var buffer = InputBuffer{};
    buffer.init(1, 100);

    try std.testing.expectEqual(@as(u32, 0), buffer.toMatchFrame(100));
    try std.testing.expectEqual(@as(u32, 5), buffer.toMatchFrame(105));
    try std.testing.expectEqual(@as(u32, 30), buffer.toMatchFrame(130));

    try std.testing.expectEqual(@as(u32, 100), buffer.toAbsoluteFrame(0));
    try std.testing.expectEqual(@as(u32, 105), buffer.toAbsoluteFrame(5));
    try std.testing.expectEqual(@as(u32, 130), buffer.toAbsoluteFrame(30));
}

test "InputBuffer calculateNextConfirmFrame" {
    var buffer = InputBuffer{};
    buffer.init(3, 0);

    // All peers at -1 initially (no inputs yet)
    try std.testing.expectEqual(@as(i32, -1), buffer.calculateNextConfirmFrame(10));

    // Peer 0 advances to frame 5
    buffer.peer_confirmed[0] = 5;
    try std.testing.expectEqual(@as(i32, -1), buffer.calculateNextConfirmFrame(10));

    // Peer 1 advances to frame 3
    buffer.peer_confirmed[1] = 3;
    try std.testing.expectEqual(@as(i32, -1), buffer.calculateNextConfirmFrame(10));

    // Peer 2 advances to frame 7 - now min is 3
    buffer.peer_confirmed[2] = 7;
    try std.testing.expectEqual(@as(i32, 3), buffer.calculateNextConfirmFrame(10));
}

test "InputBuffer ignores events for invalid peers" {
    var buffer = InputBuffer{};
    buffer.init(2, 0); // Only 2 peers (0 and 1)

    // Try to emit for peer 2 (invalid)
    const events = [_]Event{Event.keyDown(.KeyA, 2, .LocalKeyboard)};
    buffer.emit(2, 5, &events);

    // Should return empty
    const retrieved = buffer.get(2, 5);
    try std.testing.expectEqual(@as(usize, 0), retrieved.len);
}

test "standalone frame utilities" {
    try std.testing.expectEqual(@as(u32, 0), toMatchFrame(100, 100));
    try std.testing.expectEqual(@as(u32, 5), toMatchFrame(105, 100));
    try std.testing.expectEqual(@as(u32, 100), toAbsoluteFrame(0, 100));
    try std.testing.expectEqual(@as(u32, 105), toAbsoluteFrame(5, 100));
}

test "InputBuffer snapshot round-trip" {
    var buffer = InputBuffer{};
    buffer.init(2, 0); // 2 peers

    // Emit events for peer 0 at frames 0, 1, 2
    buffer.emit(0, 0, &[_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)});
    buffer.emit(0, 1, &[_]Event{Event.keyDown(.KeyB, 0, .LocalKeyboard)});
    buffer.emit(0, 2, &[_]Event{Event.keyDown(.KeyC, 0, .LocalKeyboard)});

    // peer_confirmed[0] should be 2, peer_confirmed[1] should be -1 (no inputs)
    try std.testing.expectEqual(@as(i32, 2), buffer.peer_confirmed[0]);
    try std.testing.expectEqual(@as(i32, -1), buffer.peer_confirmed[1]);

    // Calculate snapshot size at current_match_frame=2
    const size = buffer.snapshotSize(2);
    try std.testing.expect(size > 0);

    // Allocate and write snapshot
    var snap_buf: [1024]u8 = undefined;
    buffer.writeSnapshot(2, snap_buf[0..size]);

    // Create new buffer and restore
    var restored = InputBuffer{};
    restored.init(1, 0); // Start with different peer_count

    restored.restoreFromSnapshot(snap_buf[0..size]);

    // Verify peer_confirmed was restored
    try std.testing.expectEqual(@as(i32, 2), restored.peer_confirmed[0]);
    try std.testing.expectEqual(@as(i32, -1), restored.peer_confirmed[1]);
    try std.testing.expectEqual(@as(u8, 2), restored.peer_count);

    // Verify events were restored
    const frame0 = restored.get(0, 0);
    try std.testing.expectEqual(@as(usize, 1), frame0.len);
    try std.testing.expectEqual(Events.Key.KeyA, frame0[0].payload.key);

    const frame1 = restored.get(0, 1);
    try std.testing.expectEqual(@as(usize, 1), frame1.len);
    try std.testing.expectEqual(Events.Key.KeyB, frame1[0].payload.key);

    const frame2 = restored.get(0, 2);
    try std.testing.expectEqual(@as(usize, 1), frame2.len);
    try std.testing.expectEqual(Events.Key.KeyC, frame2[0].payload.key);
}

test "InputBuffer snapshot returns 0 for single player" {
    var buffer = InputBuffer{};
    buffer.init(1, 0); // Single player

    buffer.emit(0, 0, &[_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)});

    // Should return 0 for single player (no network session)
    const size = buffer.snapshotSize(0);
    try std.testing.expectEqual(@as(u32, 0), size);
}
