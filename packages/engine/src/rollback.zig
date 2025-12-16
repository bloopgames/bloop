const std = @import("std");
const Tapes = @import("tapes.zig");
const Events = @import("events.zig");
const Event = Events.Event;
const Log = @import("log.zig");

pub const MAX_ROLLBACK_FRAMES = 30;
pub const MAX_PEERS = 12;
pub const MAX_EVENTS_PER_FRAME = 16;

/// Stores events for a single frame from a single peer.
/// Tracks which frame the data belongs to, preventing stale reads when the ring buffer wraps.
pub const InputFrame = struct {
    events: [MAX_EVENTS_PER_FRAME]Event = undefined,
    count: u8 = 0,
    /// The match frame this slot was written for. Used to detect stale data.
    frame: u32 = 0,

    pub fn add(self: *InputFrame, event: Event) void {
        if (self.count < MAX_EVENTS_PER_FRAME) {
            self.events[self.count] = event;
            self.count += 1;
        }
    }

    pub fn clear(self: *InputFrame) void {
        self.count = 0;
    }

    pub fn setFrame(self: *InputFrame, match_frame: u32) void {
        self.frame = match_frame;
    }

    pub fn slice(self: *const InputFrame) []const Event {
        return self.events[0..self.count];
    }
};

/// Statistics for rollback introspection
pub const RollbackStats = struct {
    last_rollback_depth: u32 = 0,
    total_rollbacks: u32 = 0,
    frames_resimulated: u64 = 0,
};

/// Core rollback state machine
/// Tracks inputs per peer per frame, manages confirmed state snapshots,
/// and handles resimulation when late inputs arrive.
pub const RollbackState = struct {
    // Frame tracking
    session_start_frame: u32 = 0,
    confirmed_frame: u32 = 0, // In match_frame space (0-indexed from session start)
    peer_count: u8 = 0,

    // Confirmed state snapshot (engine allocates/manages)
    confirmed_snapshot: ?*Tapes.Snapshot = null,

    // Input history ring buffers - indexed by frame % MAX_ROLLBACK_FRAMES
    // peer_inputs[peer][f % 30] = inputs for frame f from that peer
    peer_inputs: [MAX_PEERS][MAX_ROLLBACK_FRAMES]InputFrame = [_][MAX_ROLLBACK_FRAMES]InputFrame{[_]InputFrame{.{}} ** MAX_ROLLBACK_FRAMES} ** MAX_PEERS,

    // Highest confirmed frame per peer (inputs received up to this frame)
    peer_confirmed_frame: [MAX_PEERS]u32 = [_]u32{0} ** MAX_PEERS,

    // Stats for introspection
    stats: RollbackStats = .{},

    // Allocator for snapshot management
    allocator: std.mem.Allocator,

    /// Clean up resources
    pub fn deinit(self: *RollbackState) void {
        if (self.confirmed_snapshot) |snap| {
            snap.deinit(self.allocator);
            self.confirmed_snapshot = null;
        }
    }

    /// Get current match frame (0-indexed from session start)
    pub fn getMatchFrame(self: *const RollbackState, current_frame: u32) u32 {
        return current_frame - self.session_start_frame;
    }

    /// Emit inputs for a peer at a given match frame
    /// This is the unified API - works for any peer (local or remote)
    pub fn emitInputs(self: *RollbackState, peer: u8, match_frame: u32, events: []const Event) void {
        if (peer >= self.peer_count) return;

        const slot = match_frame % MAX_ROLLBACK_FRAMES;
        var input_frame = &self.peer_inputs[peer][slot];

        // Only clear if this slot was for a different frame (preserves multiple events per frame)
        if (input_frame.frame != match_frame) {
            input_frame.clear();
            input_frame.setFrame(match_frame);
        }
        for (events) |event| {
            input_frame.add(event);
        }

        // Update confirmed frame for this peer
        if (match_frame > self.peer_confirmed_frame[peer]) {
            self.peer_confirmed_frame[peer] = match_frame;
        }
    }

    /// Get inputs for a peer at a given match frame.
    /// Returns empty if the slot doesn't contain data for the requested frame.
    pub fn getInputs(self: *const RollbackState, peer: u8, match_frame: u32) []const Event {
        if (peer >= self.peer_count) return &[_]Event{};

        const slot = match_frame % MAX_ROLLBACK_FRAMES;

        const input_frame = &self.peer_inputs[peer][slot];
        if (input_frame.frame != match_frame) {
            return &[_]Event{};
        }
        return input_frame.slice();
    }

    /// Calculate the next confirmable frame (minimum across all peers)
    pub fn calculateNextConfirmFrame(self: *const RollbackState, current_match_frame: u32) u32 {
        var min_frame = current_match_frame;
        for (0..self.peer_count) |i| {
            const peer_frame = self.peer_confirmed_frame[i];
            if (peer_frame < min_frame) {
                min_frame = peer_frame;
            }
        }
        return min_frame;
    }

    /// Check if rollback is needed (new confirmed frames available)
    pub fn needsRollback(self: *const RollbackState, current_match_frame: u32) bool {
        const next_confirm = self.calculateNextConfirmFrame(current_match_frame);
        return next_confirm > self.confirmed_frame;
    }

    /// Get stats for introspection
    pub fn getStats(self: *const RollbackState) RollbackStats {
        return self.stats;
    }
};

// Tests
// Note: Tests use heap allocation to mirror production usage and avoid stack issues

test "RollbackState init and deinit" {
    const state = try std.testing.allocator.create(RollbackState);
    state.* = .{
        .session_start_frame = 100,
        .peer_count = 2,
        .allocator = std.testing.allocator,
    };
    defer {
        state.deinit();
        std.testing.allocator.destroy(state);
    }

    try std.testing.expectEqual(@as(u32, 100), state.session_start_frame);
    try std.testing.expectEqual(@as(u32, 0), state.confirmed_frame);
    try std.testing.expectEqual(@as(u8, 2), state.peer_count);
    try std.testing.expectEqual(@as(?*Tapes.Snapshot, null), state.confirmed_snapshot);
}

test "RollbackState getMatchFrame" {
    const state = try std.testing.allocator.create(RollbackState);
    state.* = .{
        .session_start_frame = 100,
        .peer_count = 2,
        .allocator = std.testing.allocator,
    };
    defer {
        state.deinit();
        std.testing.allocator.destroy(state);
    }

    try std.testing.expectEqual(@as(u32, 0), state.getMatchFrame(100));
    try std.testing.expectEqual(@as(u32, 5), state.getMatchFrame(105));
    try std.testing.expectEqual(@as(u32, 30), state.getMatchFrame(130));
}

test "RollbackState emitInputs and getInputs" {
    const state = try std.testing.allocator.create(RollbackState);
    state.* = .{
        .peer_count = 2,
        .allocator = std.testing.allocator,
    };
    defer {
        state.deinit();
        std.testing.allocator.destroy(state);
    }

    // Emit some inputs for peer 0 at frame 5
    const events = [_]Event{
        Event.keyDown(.KeyA, 0, .LocalKeyboard),
        Event.keyDown(.KeyW, 0, .LocalKeyboard),
    };
    state.emitInputs(0, 5, &events);

    // Verify we can retrieve them
    const retrieved = state.getInputs(0, 5);
    try std.testing.expectEqual(@as(usize, 2), retrieved.len);
    try std.testing.expectEqual(Events.Key.KeyA, retrieved[0].payload.key);
    try std.testing.expectEqual(Events.Key.KeyW, retrieved[1].payload.key);

    // Verify peer_confirmed_frame was updated
    try std.testing.expectEqual(@as(u32, 5), state.peer_confirmed_frame[0]);
}

test "RollbackState ring buffer wraparound" {
    const state = try std.testing.allocator.create(RollbackState);
    state.* = .{
        .peer_count = 1,
        .allocator = std.testing.allocator,
    };
    defer {
        state.deinit();
        std.testing.allocator.destroy(state);
    }

    // Emit at frame 0
    const events0 = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
    state.emitInputs(0, 0, &events0);

    // Emit at frame 30 (should wrap to same slot)
    const events30 = [_]Event{Event.keyDown(.KeyB, 0, .LocalKeyboard)};
    state.emitInputs(0, 30, &events30);

    // Frame 0's slot should now have frame 30's data
    const retrieved = state.getInputs(0, 30);
    try std.testing.expectEqual(@as(usize, 1), retrieved.len);
    try std.testing.expectEqual(Events.Key.KeyB, retrieved[0].payload.key);
}

test "RollbackState getInputs returns empty for frames without events" {
    const state = try std.testing.allocator.create(RollbackState);
    state.* = .{
        .peer_count = 2,
        .allocator = std.testing.allocator,
    };
    defer {
        state.deinit();
        std.testing.allocator.destroy(state);
    }

    // Emit event for peer 1 at frame 109
    const events = [_]Event{Event.mouseDown(.Left, 1, .LocalMouse)};
    state.emitInputs(1, 109, &events);

    // Should get the event for frame 109
    const retrieved109 = state.getInputs(1, 109);
    try std.testing.expectEqual(@as(usize, 1), retrieved109.len);

    // Frame 139 maps to same slot (139 % 30 = 19 = 109 % 30)
    // But we never emitted events for frame 139, so should get empty
    const retrieved139 = state.getInputs(1, 139);
    try std.testing.expectEqual(@as(usize, 0), retrieved139.len);

    // Frame 110 also has no events
    const retrieved110 = state.getInputs(1, 110);
    try std.testing.expectEqual(@as(usize, 0), retrieved110.len);
}

test "RollbackState calculateNextConfirmFrame" {
    const state = try std.testing.allocator.create(RollbackState);
    state.* = .{
        .peer_count = 3,
        .allocator = std.testing.allocator,
    };
    defer {
        state.deinit();
        std.testing.allocator.destroy(state);
    }

    // All peers at frame 0 initially
    try std.testing.expectEqual(@as(u32, 0), state.calculateNextConfirmFrame(10));

    // Peer 0 advances to frame 5
    state.peer_confirmed_frame[0] = 5;
    try std.testing.expectEqual(@as(u32, 0), state.calculateNextConfirmFrame(10));

    // Peer 1 advances to frame 3
    state.peer_confirmed_frame[1] = 3;
    try std.testing.expectEqual(@as(u32, 0), state.calculateNextConfirmFrame(10));

    // Peer 2 advances to frame 7 - now min is 3
    state.peer_confirmed_frame[2] = 7;
    try std.testing.expectEqual(@as(u32, 3), state.calculateNextConfirmFrame(10));
}

test "RollbackState needsRollback" {
    const state = try std.testing.allocator.create(RollbackState);
    state.* = .{
        .peer_count = 2,
        .allocator = std.testing.allocator,
    };
    defer {
        state.deinit();
        std.testing.allocator.destroy(state);
    }

    // Initially no rollback needed (both peers at 0, confirmed at 0)
    try std.testing.expectEqual(false, state.needsRollback(5));

    // Peer 0 advances to frame 3
    state.peer_confirmed_frame[0] = 3;
    try std.testing.expectEqual(false, state.needsRollback(5)); // peer 1 still at 0

    // Peer 1 advances to frame 2 - now min is 2, which is > confirmed (0)
    state.peer_confirmed_frame[1] = 2;
    try std.testing.expectEqual(true, state.needsRollback(5));

    // Update confirmed frame
    state.confirmed_frame = 2;
    try std.testing.expectEqual(false, state.needsRollback(5));
}

test "InputFrame add and slice" {
    var frame = InputFrame{};

    try std.testing.expectEqual(@as(u8, 0), frame.count);

    frame.add(Event.keyDown(.KeyA, 0, .LocalKeyboard));
    frame.add(Event.keyDown(.KeyB, 0, .LocalKeyboard));

    try std.testing.expectEqual(@as(u8, 2), frame.count);

    const slice = frame.slice();
    try std.testing.expectEqual(@as(usize, 2), slice.len);
    try std.testing.expectEqual(Events.Key.KeyA, slice[0].payload.key);
    try std.testing.expectEqual(Events.Key.KeyB, slice[1].payload.key);
}

test "InputFrame clear" {
    var frame = InputFrame{};
    frame.add(Event.keyDown(.KeyA, 0, .LocalKeyboard));
    frame.add(Event.keyDown(.KeyB, 0, .LocalKeyboard));

    frame.clear();
    try std.testing.expectEqual(@as(u8, 0), frame.count);
    try std.testing.expectEqual(@as(usize, 0), frame.slice().len);
}

test "InputFrame max capacity" {
    var frame = InputFrame{};

    // Fill to capacity
    for (0..MAX_EVENTS_PER_FRAME) |_| {
        frame.add(Event.keyDown(.KeyA, 0, .LocalKeyboard));
    }
    try std.testing.expectEqual(@as(u8, MAX_EVENTS_PER_FRAME), frame.count);

    // Try to add one more - should be ignored
    frame.add(Event.keyDown(.KeyB, 0, .LocalKeyboard));
    try std.testing.expectEqual(@as(u8, MAX_EVENTS_PER_FRAME), frame.count);
}
