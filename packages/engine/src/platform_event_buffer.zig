const std = @import("std");
const Events = @import("events.zig");
const Event = Events.Event;

pub const MAX_FRAMES = 500;
pub const MAX_EVENTS_PER_FRAME = 8;

/// A single frame's worth of platform events.
/// The engine_frame field acts as a sentinel to detect stale ring buffer data.
pub const PlatformEventSlot = struct {
    events: [MAX_EVENTS_PER_FRAME]Event = undefined,
    count: u8 = 0,
    /// Which engine frame this slot represents. Used to detect stale data after wraparound.
    engine_frame: u32 = 0,

    pub fn clear(self: *PlatformEventSlot) void {
        self.count = 0;
    }

    pub fn add(self: *PlatformEventSlot, event: Event) error{SlotFull}!void {
        if (self.count >= MAX_EVENTS_PER_FRAME) {
            return error.SlotFull;
        }
        self.events[self.count] = event;
        self.count += 1;
    }

    pub fn slice(self: *const PlatformEventSlot) []const Event {
        return self.events[0..self.count];
    }
};

/// Observer callback for platform events.
/// Called when a platform event is added to the buffer.
pub const PlatformEventObserver = struct {
    callback: *const fn (ctx: *anyopaque, engine_frame: u32, event: Event) void,
    context: *anyopaque,

    pub fn notify(self: PlatformEventObserver, engine_frame: u32, event: Event) void {
        self.callback(self.context, engine_frame, event);
    }
};

/// Buffer for platform events (network events like peer join/leave, session init).
///
/// Platform events are indexed by engine_frame (not match_frame like inputs).
/// This buffer is used for:
/// - Live play: events written when emitted, read by beforeTickListener
/// - Tape replay: events written from tape, read by beforeTickListener
/// - Rollback: events already in buffer from original emission, re-read during resim
pub const PlatformEventBuffer = struct {
    /// Ring buffer: slots[engine_frame % MAX_FRAMES]
    slots: [MAX_FRAMES]PlatformEventSlot = [_]PlatformEventSlot{.{}} ** MAX_FRAMES,

    /// Observer for platform events (e.g., tape recording)
    observer: ?PlatformEventObserver = null,

    /// Emit a platform event at a given engine frame.
    /// Observer is notified for tape recording.
    pub fn emit(self: *PlatformEventBuffer, engine_frame: u32, event: Event) void {
        const slot_idx = engine_frame % MAX_FRAMES;
        var slot = &self.slots[slot_idx];

        // Only clear if this slot was for a different frame
        if (slot.engine_frame != engine_frame) {
            slot.clear();
            slot.engine_frame = engine_frame;
        }

        slot.add(event) catch {
            // Slot full - panic since platform events are critical
            @panic("Platform event slot full");
        };

        // Notify observer for tape recording
        if (self.observer) |obs| {
            obs.notify(engine_frame, event);
        }
    }

    /// Get platform events for a given engine frame.
    /// Returns empty slice if the slot doesn't contain data for the requested frame.
    pub fn get(self: *const PlatformEventBuffer, engine_frame: u32) []const Event {
        const slot_idx = engine_frame % MAX_FRAMES;
        const slot = &self.slots[slot_idx];

        // Check sentinel to detect stale data
        if (slot.engine_frame != engine_frame) {
            return &[_]Event{};
        }
        return slot.slice();
    }
};

// ============================================================================
// Tests
// ============================================================================

test "PlatformEventSlot basic operations" {
    var slot = PlatformEventSlot{};

    try std.testing.expectEqual(@as(u8, 0), slot.count);
    try std.testing.expectEqual(@as(usize, 0), slot.slice().len);

    try slot.add(Event.netPeerJoin(0));
    try slot.add(Event.netPeerJoin(1));

    try std.testing.expectEqual(@as(u8, 2), slot.count);
    try std.testing.expectEqual(@as(usize, 2), slot.slice().len);
    try std.testing.expectEqual(@as(u8, 0), slot.slice()[0].payload.peer_id);
    try std.testing.expectEqual(@as(u8, 1), slot.slice()[1].payload.peer_id);
}

test "PlatformEventSlot clear" {
    var slot = PlatformEventSlot{};
    try slot.add(Event.netPeerJoin(0));

    slot.clear();
    try std.testing.expectEqual(@as(u8, 0), slot.count);
    try std.testing.expectEqual(@as(usize, 0), slot.slice().len);
}

test "PlatformEventSlot max capacity" {
    var slot = PlatformEventSlot{};

    // Fill to capacity
    for (0..MAX_EVENTS_PER_FRAME) |i| {
        try slot.add(Event.netPeerJoin(@intCast(i)));
    }
    try std.testing.expectEqual(@as(u8, MAX_EVENTS_PER_FRAME), slot.count);

    // Try to add one more - should error
    try std.testing.expectError(error.SlotFull, slot.add(Event.netPeerJoin(0)));
}

test "PlatformEventBuffer emit and get round-trip" {
    var buffer = PlatformEventBuffer{};

    buffer.emit(5, Event.netPeerJoin(0));
    buffer.emit(5, Event.netPeerJoin(1));

    const retrieved = buffer.get(5);
    try std.testing.expectEqual(@as(usize, 2), retrieved.len);
    try std.testing.expectEqual(@as(u8, 0), retrieved[0].payload.peer_id);
    try std.testing.expectEqual(@as(u8, 1), retrieved[1].payload.peer_id);
}

test "PlatformEventBuffer ring buffer wraparound" {
    var buffer = PlatformEventBuffer{};

    // Emit at frame 0
    buffer.emit(0, Event.netPeerJoin(0));

    // Emit at frame MAX_FRAMES (should wrap to same slot)
    buffer.emit(MAX_FRAMES, Event.netPeerJoin(1));

    // Frame 0's slot should now have frame MAX_FRAMES's data
    const retrieved = buffer.get(MAX_FRAMES);
    try std.testing.expectEqual(@as(usize, 1), retrieved.len);
    try std.testing.expectEqual(@as(u8, 1), retrieved[0].payload.peer_id);

    // Frame 0 should return empty (stale sentinel)
    const stale = buffer.get(0);
    try std.testing.expectEqual(@as(usize, 0), stale.len);
}

test "PlatformEventBuffer stale slot detection" {
    var buffer = PlatformEventBuffer{};

    buffer.emit(109, Event.netPeerJoin(0));

    // Should get the event for frame 109
    const retrieved109 = buffer.get(109);
    try std.testing.expectEqual(@as(usize, 1), retrieved109.len);

    // Frame 109 + MAX_FRAMES maps to same slot, should get empty
    const stale = buffer.get(109 + MAX_FRAMES);
    try std.testing.expectEqual(@as(usize, 0), stale.len);

    // Frame 110 has no events
    const retrieved110 = buffer.get(110);
    try std.testing.expectEqual(@as(usize, 0), retrieved110.len);
}

test "PlatformEventBuffer observer callback" {
    const TestCtx = struct {
        call_count: u32 = 0,
        last_frame: u32 = 0,

        fn callback(ctx: *anyopaque, engine_frame: u32, _: Event) void {
            const self: *@This() = @ptrCast(@alignCast(ctx));
            self.call_count += 1;
            self.last_frame = engine_frame;
        }
    };

    var ctx = TestCtx{};
    var buffer = PlatformEventBuffer{};
    buffer.observer = PlatformEventObserver{
        .callback = TestCtx.callback,
        .context = @ptrCast(&ctx),
    };

    // Emit 2 events
    buffer.emit(42, Event.netPeerJoin(0));
    buffer.emit(42, Event.netPeerJoin(1));

    // Observer should have been called twice
    try std.testing.expectEqual(@as(u32, 2), ctx.call_count);
    try std.testing.expectEqual(@as(u32, 42), ctx.last_frame);
}
