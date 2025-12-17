const std = @import("std");
const Tapes = @import("tapes.zig");
const Events = @import("events.zig");
const Event = Events.Event;
const Log = @import("log.zig");
const InputBuffer = @import("input_buffer.zig");

pub const MAX_ROLLBACK_FRAMES = InputBuffer.MAX_FRAMES;
pub const MAX_PEERS = InputBuffer.MAX_PEERS;
pub const MAX_EVENTS_PER_FRAME = InputBuffer.MAX_EVENTS_PER_FRAME;

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

    // Canonical input buffer - single source of truth for all inputs
    // Replaces the old peer_inputs ring buffer
    input_buffer: *InputBuffer.InputBuffer,

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

    /// Emit inputs for a peer at a given match frame.
    /// Delegates to canonical InputBuffer.
    pub fn emitInputs(self: *RollbackState, peer: u8, match_frame: u32, events: []const Event) void {
        self.input_buffer.emit(peer, match_frame, events);
    }

    /// Get inputs for a peer at a given match frame.
    /// Delegates to canonical InputBuffer.
    pub fn getInputs(self: *const RollbackState, peer: u8, match_frame: u32) []const Event {
        return self.input_buffer.get(peer, match_frame);
    }

    /// Calculate the next confirmable frame (minimum across all peers).
    /// Delegates to canonical InputBuffer.
    pub fn calculateNextConfirmFrame(self: *const RollbackState, current_match_frame: u32) u32 {
        return self.input_buffer.calculateNextConfirmFrame(current_match_frame);
    }

    /// Check if rollback is needed (new confirmed frames available)
    pub fn needsRollback(self: *const RollbackState, current_match_frame: u32) bool {
        const next_confirm = self.calculateNextConfirmFrame(current_match_frame);
        return next_confirm > self.confirmed_frame;
    }

    /// Get peer confirmed frame (from InputBuffer)
    pub fn getPeerConfirmedFrame(self: *const RollbackState, peer: u8) u32 {
        if (peer >= MAX_PEERS) return 0;
        return self.input_buffer.peer_confirmed[peer];
    }

    /// Get stats for introspection
    pub fn getStats(self: *const RollbackState) RollbackStats {
        return self.stats;
    }
};

// Tests
// Note: Tests use heap allocation to mirror production usage and avoid stack issues

/// Helper to create RollbackState with InputBuffer for tests
fn createTestState(peer_count: u8, session_start_frame: u32) !struct { state: *RollbackState, buffer: *InputBuffer.InputBuffer } {
    const buffer = try std.testing.allocator.create(InputBuffer.InputBuffer);
    buffer.* = .{};
    buffer.init(peer_count, session_start_frame);

    const state = try std.testing.allocator.create(RollbackState);
    state.* = .{
        .session_start_frame = session_start_frame,
        .peer_count = peer_count,
        .input_buffer = buffer,
        .allocator = std.testing.allocator,
    };
    return .{ .state = state, .buffer = buffer };
}

fn destroyTestState(state: *RollbackState, buffer: *InputBuffer.InputBuffer) void {
    state.deinit();
    std.testing.allocator.destroy(state);
    std.testing.allocator.destroy(buffer);
}

test "RollbackState init and deinit" {
    const result = try createTestState(2, 100);
    defer destroyTestState(result.state, result.buffer);

    try std.testing.expectEqual(@as(u32, 100), result.state.session_start_frame);
    try std.testing.expectEqual(@as(u32, 0), result.state.confirmed_frame);
    try std.testing.expectEqual(@as(u8, 2), result.state.peer_count);
    try std.testing.expectEqual(@as(?*Tapes.Snapshot, null), result.state.confirmed_snapshot);
}

test "RollbackState getMatchFrame" {
    const result = try createTestState(2, 100);
    defer destroyTestState(result.state, result.buffer);

    try std.testing.expectEqual(@as(u32, 0), result.state.getMatchFrame(100));
    try std.testing.expectEqual(@as(u32, 5), result.state.getMatchFrame(105));
    try std.testing.expectEqual(@as(u32, 30), result.state.getMatchFrame(130));
}

test "RollbackState emitInputs and getInputs" {
    const result = try createTestState(2, 0);
    defer destroyTestState(result.state, result.buffer);

    // Emit some inputs for peer 0 at frame 5
    const events = [_]Event{
        Event.keyDown(.KeyA, 0, .LocalKeyboard),
        Event.keyDown(.KeyW, 0, .LocalKeyboard),
    };
    result.state.emitInputs(0, 5, &events);

    // Verify we can retrieve them
    const retrieved = result.state.getInputs(0, 5);
    try std.testing.expectEqual(@as(usize, 2), retrieved.len);
    try std.testing.expectEqual(Events.Key.KeyA, retrieved[0].payload.key);
    try std.testing.expectEqual(Events.Key.KeyW, retrieved[1].payload.key);

    // Verify peer_confirmed was updated (via InputBuffer)
    try std.testing.expectEqual(@as(u32, 5), result.state.getPeerConfirmedFrame(0));
}

test "RollbackState ring buffer wraparound" {
    const result = try createTestState(1, 0);
    defer destroyTestState(result.state, result.buffer);

    // Emit at frame 0
    const events0 = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
    result.state.emitInputs(0, 0, &events0);

    // Emit at frame MAX_FRAMES (should wrap to same slot)
    const eventsWrap = [_]Event{Event.keyDown(.KeyB, 0, .LocalKeyboard)};
    result.state.emitInputs(0, MAX_ROLLBACK_FRAMES, &eventsWrap);

    // Frame 0's slot should now have frame MAX_FRAMES's data
    const retrieved = result.state.getInputs(0, MAX_ROLLBACK_FRAMES);
    try std.testing.expectEqual(@as(usize, 1), retrieved.len);
    try std.testing.expectEqual(Events.Key.KeyB, retrieved[0].payload.key);
}

test "RollbackState getInputs returns empty for frames without events" {
    const result = try createTestState(2, 0);
    defer destroyTestState(result.state, result.buffer);

    // Emit event for peer 1 at frame 109
    const events = [_]Event{Event.mouseDown(.Left, 1, .LocalMouse)};
    result.state.emitInputs(1, 109, &events);

    // Should get the event for frame 109
    const retrieved109 = result.state.getInputs(1, 109);
    try std.testing.expectEqual(@as(usize, 1), retrieved109.len);

    // Frame 109 + MAX_FRAMES maps to same slot
    // But we never emitted events for that frame, so should get empty
    const retrievedWrap = result.state.getInputs(1, 109 + MAX_ROLLBACK_FRAMES);
    try std.testing.expectEqual(@as(usize, 0), retrievedWrap.len);

    // Frame 110 also has no events
    const retrieved110 = result.state.getInputs(1, 110);
    try std.testing.expectEqual(@as(usize, 0), retrieved110.len);
}

test "RollbackState calculateNextConfirmFrame" {
    const result = try createTestState(3, 0);
    defer destroyTestState(result.state, result.buffer);

    // All peers at frame 0 initially
    try std.testing.expectEqual(@as(u32, 0), result.state.calculateNextConfirmFrame(10));

    // Peer 0 advances to frame 5 (emit events to update peer_confirmed)
    const events = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
    result.state.emitInputs(0, 5, &events);
    try std.testing.expectEqual(@as(u32, 0), result.state.calculateNextConfirmFrame(10));

    // Peer 1 advances to frame 3
    result.state.emitInputs(1, 3, &events);
    try std.testing.expectEqual(@as(u32, 0), result.state.calculateNextConfirmFrame(10));

    // Peer 2 advances to frame 7 - now min is 3
    result.state.emitInputs(2, 7, &events);
    try std.testing.expectEqual(@as(u32, 3), result.state.calculateNextConfirmFrame(10));
}

test "RollbackState needsRollback" {
    const result = try createTestState(2, 0);
    defer destroyTestState(result.state, result.buffer);
    const events = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};

    // Initially no rollback needed (both peers at 0, confirmed at 0)
    try std.testing.expectEqual(false, result.state.needsRollback(5));

    // Peer 0 advances to frame 3
    result.state.emitInputs(0, 3, &events);
    try std.testing.expectEqual(false, result.state.needsRollback(5)); // peer 1 still at 0

    // Peer 1 advances to frame 2 - now min is 2, which is > confirmed (0)
    result.state.emitInputs(1, 2, &events);
    try std.testing.expectEqual(true, result.state.needsRollback(5));

    // Update confirmed frame
    result.state.confirmed_frame = 2;
    try std.testing.expectEqual(false, result.state.needsRollback(5));
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
