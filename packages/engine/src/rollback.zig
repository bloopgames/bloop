const std = @import("std");
const Tapes = @import("tapes.zig");
const Events = @import("events.zig");
const Event = Events.Event;

pub const MAX_ROLLBACK_FRAMES = 30;
pub const MAX_PEERS = 12;
pub const MAX_EVENTS_PER_FRAME = 16;

/// Stores events for a single frame from a single peer
pub const InputFrame = struct {
    events: [MAX_EVENTS_PER_FRAME]Event = undefined,
    count: u8 = 0,

    pub fn add(self: *InputFrame, event: Event) void {
        if (self.count < MAX_EVENTS_PER_FRAME) {
            self.events[self.count] = event;
            self.count += 1;
        }
    }

    pub fn clear(self: *InputFrame) void {
        self.count = 0;
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
    session_start_frame: u32,
    confirmed_frame: u32, // In match_frame space (0-indexed from session start)
    peer_count: u8,

    // Confirmed state snapshot (engine allocates/manages)
    confirmed_snapshot: ?*Tapes.Snapshot,

    // Input history ring buffers - indexed by frame % MAX_ROLLBACK_FRAMES
    // peer_inputs[peer][f % 30] = inputs for frame f from that peer
    peer_inputs: [MAX_PEERS][MAX_ROLLBACK_FRAMES]InputFrame,

    // Highest confirmed frame per peer (inputs received up to this frame)
    peer_confirmed_frame: [MAX_PEERS]u32,

    // Stats for introspection
    stats: RollbackStats,

    // Allocator for snapshot management
    allocator: std.mem.Allocator,

    /// Initialize rollback state for a new session
    /// Captures current frame as session_start_frame
    pub fn init(allocator: std.mem.Allocator, current_frame: u32, peer_count: u8) RollbackState {
        var state = RollbackState{
            .session_start_frame = current_frame,
            .confirmed_frame = 0,
            .peer_count = peer_count,
            .confirmed_snapshot = null,
            .peer_inputs = undefined,
            .peer_confirmed_frame = [_]u32{0} ** MAX_PEERS,
            .stats = .{},
            .allocator = allocator,
        };

        // Initialize all input frames
        for (&state.peer_inputs) |*peer| {
            for (peer) |*frame| {
                frame.* = InputFrame{};
            }
        }

        return state;
    }

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
        var frame = &self.peer_inputs[peer][slot];

        // Clear and add new events
        frame.clear();
        for (events) |event| {
            frame.add(event);
        }

        // Update confirmed frame for this peer
        if (match_frame > self.peer_confirmed_frame[peer]) {
            self.peer_confirmed_frame[peer] = match_frame;
        }
    }

    /// Get inputs for a peer at a given match frame
    pub fn getInputs(self: *const RollbackState, peer: u8, match_frame: u32) []const Event {
        if (peer >= self.peer_count) return &[_]Event{};

        const slot = match_frame % MAX_ROLLBACK_FRAMES;
        return self.peer_inputs[peer][slot].slice();
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
test "RollbackState init and deinit" {
    var state = RollbackState.init(std.testing.allocator, 100, 2);
    defer state.deinit();

    try std.testing.expectEqual(@as(u32, 100), state.session_start_frame);
    try std.testing.expectEqual(@as(u32, 0), state.confirmed_frame);
    try std.testing.expectEqual(@as(u8, 2), state.peer_count);
    try std.testing.expectEqual(@as(?*Tapes.Snapshot, null), state.confirmed_snapshot);
}

test "RollbackState getMatchFrame" {
    var state = RollbackState.init(std.testing.allocator, 100, 2);
    defer state.deinit();

    try std.testing.expectEqual(@as(u32, 0), state.getMatchFrame(100));
    try std.testing.expectEqual(@as(u32, 5), state.getMatchFrame(105));
    try std.testing.expectEqual(@as(u32, 30), state.getMatchFrame(130));
}

test "RollbackState emitInputs and getInputs" {
    var state = RollbackState.init(std.testing.allocator, 0, 2);
    defer state.deinit();

    // Emit some inputs for peer 0 at frame 5
    const events = [_]Event{
        Event.keyDown(.KeyA, .LocalKeyboard),
        Event.keyDown(.KeyW, .LocalKeyboard),
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
    var state = RollbackState.init(std.testing.allocator, 0, 1);
    defer state.deinit();

    // Emit at frame 0
    const events0 = [_]Event{Event.keyDown(.KeyA, .LocalKeyboard)};
    state.emitInputs(0, 0, &events0);

    // Emit at frame 30 (should wrap to same slot)
    const events30 = [_]Event{Event.keyDown(.KeyB, .LocalKeyboard)};
    state.emitInputs(0, 30, &events30);

    // Frame 0's slot should now have frame 30's data
    const retrieved = state.getInputs(0, 30);
    try std.testing.expectEqual(@as(usize, 1), retrieved.len);
    try std.testing.expectEqual(Events.Key.KeyB, retrieved[0].payload.key);
}

test "RollbackState calculateNextConfirmFrame" {
    var state = RollbackState.init(std.testing.allocator, 0, 3);
    defer state.deinit();

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
    var state = RollbackState.init(std.testing.allocator, 0, 2);
    defer state.deinit();

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

    frame.add(Event.keyDown(.KeyA, .LocalKeyboard));
    frame.add(Event.keyDown(.KeyB, .LocalKeyboard));

    try std.testing.expectEqual(@as(u8, 2), frame.count);

    const slice = frame.slice();
    try std.testing.expectEqual(@as(usize, 2), slice.len);
    try std.testing.expectEqual(Events.Key.KeyA, slice[0].payload.key);
    try std.testing.expectEqual(Events.Key.KeyB, slice[1].payload.key);
}

test "InputFrame clear" {
    var frame = InputFrame{};
    frame.add(Event.keyDown(.KeyA, .LocalKeyboard));
    frame.add(Event.keyDown(.KeyB, .LocalKeyboard));

    frame.clear();
    try std.testing.expectEqual(@as(u8, 0), frame.count);
    try std.testing.expectEqual(@as(usize, 0), frame.slice().len);
}

test "InputFrame max capacity" {
    var frame = InputFrame{};

    // Fill to capacity
    for (0..MAX_EVENTS_PER_FRAME) |_| {
        frame.add(Event.keyDown(.KeyA, .LocalKeyboard));
    }
    try std.testing.expectEqual(@as(u8, MAX_EVENTS_PER_FRAME), frame.count);

    // Try to add one more - should be ignored
    frame.add(Event.keyDown(.KeyB, .LocalKeyboard));
    try std.testing.expectEqual(@as(u8, MAX_EVENTS_PER_FRAME), frame.count);
}
