const std = @import("std");
const Tapes = @import("tapes.zig");
const Events = @import("events.zig");
pub const Packets = @import("packets.zig");
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

/// Per-peer network state for packet management
pub const PeerNetState = struct {
    /// Our latest frame sent to this peer (for outbound seq)
    local_seq: u16 = 0,
    /// Latest frame we received from this peer
    remote_seq: u16 = 0,
    /// Latest frame they acknowledged from us
    remote_ack: u16 = 0,
    /// Whether this peer is connected
    connected: bool = false,

    /// Unacked input buffer - frames we sent but haven't been acked
    /// Ring buffer indexed by frame % MAX_ROLLBACK_FRAMES
    unacked_frames: [MAX_ROLLBACK_FRAMES]InputFrame = [_]InputFrame{.{}} ** MAX_ROLLBACK_FRAMES,
    /// Oldest unacked frame (in match frame space)
    unacked_start: u16 = 0,
    /// Next frame to be added (in match frame space)
    unacked_end: u16 = 0,

    /// Reset state when peer disconnects or session ends
    pub fn reset(self: *PeerNetState) void {
        self.local_seq = 0;
        self.remote_seq = 0;
        self.remote_ack = 0;
        self.connected = false;
        self.unacked_start = 0;
        self.unacked_end = 0;
    }

    /// Add a frame's inputs to the unacked buffer
    pub fn addUnacked(self: *PeerNetState, match_frame: u16, events: []const Event) void {
        const slot = match_frame % MAX_ROLLBACK_FRAMES;
        var frame = &self.unacked_frames[slot];
        frame.clear();
        for (events) |event| {
            frame.add(event);
        }
        // Update end pointer
        if (match_frame >= self.unacked_end) {
            self.unacked_end = match_frame + 1;
        }
    }

    /// Trim unacked frames that have been acknowledged
    pub fn trimAcked(self: *PeerNetState, ack_frame: u16) void {
        // Advance start to one past the acked frame
        if (ack_frame >= self.unacked_start) {
            self.unacked_start = ack_frame + 1;
        }
    }

    /// Get the number of unacked frames
    pub fn unackedCount(self: *const PeerNetState) u16 {
        if (self.unacked_end <= self.unacked_start) return 0;
        return self.unacked_end - self.unacked_start;
    }

    /// Get events for a specific frame from unacked buffer
    pub fn getUnackedFrame(self: *const PeerNetState, match_frame: u16) ?[]const Event {
        if (match_frame < self.unacked_start or match_frame >= self.unacked_end) {
            return null;
        }
        const slot = match_frame % MAX_ROLLBACK_FRAMES;
        return self.unacked_frames[slot].slice();
    }
};

/// Network state for all peers in a session
pub const NetState = struct {
    /// Local peer ID for packet encoding
    local_peer_id: u8 = 0,
    /// Per-peer network state
    peer_states: [MAX_PEERS]PeerNetState = [_]PeerNetState{.{}} ** MAX_PEERS,
    /// Allocator for packet buffers
    allocator: std.mem.Allocator,
    /// Scratch buffer for outbound packets (reused across calls)
    outbound_buffer: ?[]u8 = null,
    /// Length of current outbound packet
    outbound_len: u32 = 0,

    pub fn deinit(self: *NetState) void {
        if (self.outbound_buffer) |buf| {
            self.allocator.free(buf);
            self.outbound_buffer = null;
        }
        self.outbound_len = 0;
    }

    /// Reset all peer states (for session end)
    pub fn reset(self: *NetState) void {
        for (&self.peer_states) |*peer| {
            peer.reset();
        }
        self.local_peer_id = 0;
        self.outbound_len = 0;
    }

    /// Set local peer ID
    pub fn setLocalPeer(self: *NetState, peer_id: u8) void {
        self.local_peer_id = peer_id;
    }

    /// Connect a peer
    pub fn connectPeer(self: *NetState, peer_id: u8) void {
        if (peer_id < MAX_PEERS) {
            self.peer_states[peer_id].connected = true;
        }
    }

    /// Disconnect a peer
    pub fn disconnectPeer(self: *NetState, peer_id: u8) void {
        if (peer_id < MAX_PEERS) {
            self.peer_states[peer_id].reset();
        }
    }

    /// Record local inputs to unacked buffers for all connected peers
    pub fn recordLocalInputs(self: *NetState, match_frame: u16, events: []const Event) void {
        for (&self.peer_states, 0..) |*peer, i| {
            if (peer.connected and i != self.local_peer_id) {
                peer.addUnacked(match_frame, events);
            }
        }
    }

    /// Build outbound packet for a target peer
    /// Returns pointer to internal buffer (valid until next call)
    pub fn buildOutboundPacket(self: *NetState, target_peer: u8, current_match_frame: u16) !void {
        if (target_peer >= MAX_PEERS) return;
        const peer = &self.peer_states[target_peer];
        if (!peer.connected) {
            self.outbound_len = 0;
            return;
        }

        // Count events across all unacked frames
        var total_events: usize = 0;
        var frame = peer.unacked_start;
        while (frame < peer.unacked_end) : (frame += 1) {
            if (peer.getUnackedFrame(frame)) |events| {
                total_events += events.len;
            }
        }

        // Clamp to max events per packet
        if (total_events > Packets.MAX_EVENTS_PER_PACKET) {
            total_events = Packets.MAX_EVENTS_PER_PACKET;
        }

        // Calculate required buffer size
        const required_size = Packets.packetSize(total_events);

        // Ensure buffer is large enough
        if (self.outbound_buffer == null or self.outbound_buffer.?.len < required_size) {
            if (self.outbound_buffer) |old| {
                self.allocator.free(old);
            }
            self.outbound_buffer = try self.allocator.alloc(u8, required_size);
        }

        const buf = self.outbound_buffer.?;

        // Write header
        const header = Packets.PacketHeader{
            .version = Packets.WIRE_VERSION,
            .peer_id = self.local_peer_id,
            .frame_ack = peer.remote_seq,
            .frame_seq = current_match_frame,
            .event_count = @intCast(total_events),
            .flags = 0,
        };
        header.encode(buf[0..Packets.HEADER_SIZE]);

        // Write events
        var offset: usize = Packets.HEADER_SIZE;
        var events_written: usize = 0;
        frame = peer.unacked_start;
        outer: while (frame < peer.unacked_end) : (frame += 1) {
            if (peer.getUnackedFrame(frame)) |events| {
                for (events) |event| {
                    if (events_written >= total_events) break :outer;
                    const wire_event = Packets.WireEvent.fromEvent(event, frame);
                    wire_event.encode(buf[offset .. offset + Packets.WIRE_EVENT_SIZE]);
                    offset += Packets.WIRE_EVENT_SIZE;
                    events_written += 1;
                }
            }
        }

        self.outbound_len = @intCast(offset);

        // Update local_seq for this peer
        peer.local_seq = current_match_frame;
    }

    /// Process a received packet, updating state and returning events
    pub fn receivePacket(self: *NetState, buf: []const u8, rollback: *RollbackState) Packets.DecodeError!void {
        const header = try Packets.PacketHeader.decode(buf);

        if (header.peer_id >= MAX_PEERS) return;
        const peer = &self.peer_states[header.peer_id];

        // Update seq/ack tracking
        if (header.frame_seq > peer.remote_seq) {
            peer.remote_seq = header.frame_seq;
        }

        // The packet's frame_ack tells us what frame they've received from us
        // Trim our unacked buffer up to that frame
        peer.trimAcked(header.frame_ack);

        // Decode and store events
        var offset: usize = Packets.HEADER_SIZE;
        var i: usize = 0;
        while (i < header.event_count) : (i += 1) {
            if (offset + Packets.WIRE_EVENT_SIZE > buf.len) {
                return Packets.DecodeError.BufferTooSmall;
            }
            const wire_event = try Packets.WireEvent.decode(buf[offset .. offset + Packets.WIRE_EVENT_SIZE]);
            const event = wire_event.toEvent();

            // Store in rollback state
            const slot = wire_event.frame % MAX_ROLLBACK_FRAMES;
            rollback.peer_inputs[header.peer_id][slot].add(event);

            offset += Packets.WIRE_EVENT_SIZE;
        }

        // Update peer confirmed frame in rollback state
        if (header.frame_seq > rollback.peer_confirmed_frame[header.peer_id]) {
            rollback.peer_confirmed_frame[header.peer_id] = header.frame_seq;
        }
    }
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

// ─────────────────────────────────────────────────────────────
// PeerNetState Tests
// ─────────────────────────────────────────────────────────────

test "PeerNetState init and reset" {
    var peer = PeerNetState{};

    try std.testing.expectEqual(@as(u16, 0), peer.local_seq);
    try std.testing.expectEqual(@as(u16, 0), peer.remote_seq);
    try std.testing.expectEqual(@as(u16, 0), peer.remote_ack);
    try std.testing.expectEqual(false, peer.connected);

    peer.connected = true;
    peer.local_seq = 100;
    peer.remote_seq = 50;

    peer.reset();

    try std.testing.expectEqual(@as(u16, 0), peer.local_seq);
    try std.testing.expectEqual(@as(u16, 0), peer.remote_seq);
    try std.testing.expectEqual(false, peer.connected);
}

test "PeerNetState addUnacked and getUnackedFrame" {
    var peer = PeerNetState{};

    const events = [_]Event{
        Event.keyDown(.KeyA, .LocalKeyboard),
        Event.keyDown(.KeyW, .LocalKeyboard),
    };

    peer.addUnacked(5, &events);

    try std.testing.expectEqual(@as(u16, 0), peer.unacked_start);
    try std.testing.expectEqual(@as(u16, 6), peer.unacked_end);

    const retrieved = peer.getUnackedFrame(5);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqual(@as(usize, 2), retrieved.?.len);
    try std.testing.expectEqual(Events.Key.KeyA, retrieved.?[0].payload.key);
}

test "PeerNetState unackedCount" {
    var peer = PeerNetState{};

    try std.testing.expectEqual(@as(u16, 0), peer.unackedCount());

    const events = [_]Event{Event.keyDown(.KeyA, .LocalKeyboard)};

    peer.addUnacked(0, &events);
    try std.testing.expectEqual(@as(u16, 1), peer.unackedCount());

    peer.addUnacked(1, &events);
    peer.addUnacked(2, &events);
    try std.testing.expectEqual(@as(u16, 3), peer.unackedCount());
}

test "PeerNetState trimAcked" {
    var peer = PeerNetState{};
    const events = [_]Event{Event.keyDown(.KeyA, .LocalKeyboard)};

    // Add frames 0-4
    for (0..5) |i| {
        peer.addUnacked(@intCast(i), &events);
    }
    try std.testing.expectEqual(@as(u16, 5), peer.unackedCount());

    // Ack frame 2 (trims 0, 1, 2)
    peer.trimAcked(2);
    try std.testing.expectEqual(@as(u16, 3), peer.unacked_start);
    try std.testing.expectEqual(@as(u16, 2), peer.unackedCount());

    // Frame 2 should no longer be accessible
    try std.testing.expectEqual(@as(?[]const Event, null), peer.getUnackedFrame(2));

    // Frame 3 should still be accessible
    try std.testing.expect(peer.getUnackedFrame(3) != null);
}

test "PeerNetState ring buffer wraparound" {
    var peer = PeerNetState{};
    const events = [_]Event{Event.keyDown(.KeyA, .LocalKeyboard)};

    // Add frames 0-29 (fills buffer)
    for (0..MAX_ROLLBACK_FRAMES) |i| {
        peer.addUnacked(@intCast(i), &events);
    }
    try std.testing.expectEqual(@as(u16, MAX_ROLLBACK_FRAMES), peer.unackedCount());

    // Ack all but last 5
    peer.trimAcked(24);
    try std.testing.expectEqual(@as(u16, 5), peer.unackedCount());

    // Add frame 30 (wraps to slot 0)
    const events30 = [_]Event{Event.keyDown(.KeyB, .LocalKeyboard)};
    peer.addUnacked(30, &events30);

    // Frame 30 should be accessible at slot 0
    const retrieved = peer.getUnackedFrame(30);
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqual(Events.Key.KeyB, retrieved.?[0].payload.key);
}

// ─────────────────────────────────────────────────────────────
// NetState Tests
// ─────────────────────────────────────────────────────────────

test "NetState init and deinit" {
    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    try std.testing.expectEqual(@as(u8, 0), net.local_peer_id);
    try std.testing.expectEqual(@as(?[]u8, null), net.outbound_buffer);
}

test "NetState setLocalPeer and connectPeer" {
    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    net.setLocalPeer(2);
    try std.testing.expectEqual(@as(u8, 2), net.local_peer_id);

    net.connectPeer(1);
    try std.testing.expectEqual(true, net.peer_states[1].connected);
    try std.testing.expectEqual(false, net.peer_states[0].connected);
}

test "NetState disconnectPeer" {
    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    net.connectPeer(1);
    net.peer_states[1].local_seq = 100;

    net.disconnectPeer(1);
    try std.testing.expectEqual(false, net.peer_states[1].connected);
    try std.testing.expectEqual(@as(u16, 0), net.peer_states[1].local_seq);
}

test "NetState recordLocalInputs" {
    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    net.setLocalPeer(0);
    net.connectPeer(1);
    net.connectPeer(2);

    // Add frames sequentially starting from 0
    const events = [_]Event{Event.keyDown(.KeyA, .LocalKeyboard)};
    net.recordLocalInputs(0, &events);

    // Should be recorded for peer 1 and 2, not peer 0 (self)
    try std.testing.expectEqual(@as(u16, 0), net.peer_states[0].unackedCount());
    try std.testing.expectEqual(@as(u16, 1), net.peer_states[1].unackedCount());
    try std.testing.expectEqual(@as(u16, 1), net.peer_states[2].unackedCount());

    // Add more frames
    net.recordLocalInputs(1, &events);
    net.recordLocalInputs(2, &events);
    try std.testing.expectEqual(@as(u16, 3), net.peer_states[1].unackedCount());
}

test "NetState buildOutboundPacket" {
    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    net.setLocalPeer(0);
    net.connectPeer(1);

    // Record some inputs
    const events = [_]Event{Event.keyDown(.KeyA, .LocalKeyboard)};
    net.recordLocalInputs(0, &events);
    net.recordLocalInputs(1, &events);

    // Build packet for peer 1
    try net.buildOutboundPacket(1, 5);

    try std.testing.expect(net.outbound_buffer != null);
    try std.testing.expect(net.outbound_len > 0);

    // Decode and verify header
    const header = try Packets.PacketHeader.decode(net.outbound_buffer.?[0..Packets.HEADER_SIZE]);
    try std.testing.expectEqual(@as(u8, 0), header.peer_id); // our local peer
    try std.testing.expectEqual(@as(u16, 5), header.frame_seq);
    try std.testing.expectEqual(@as(u8, 2), header.event_count); // 2 events (1 per frame)
}

test "NetState receivePacket" {
    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    const rollback = try std.testing.allocator.create(RollbackState);
    rollback.* = .{
        .peer_count = 2,
        .allocator = std.testing.allocator,
    };
    defer {
        rollback.deinit();
        std.testing.allocator.destroy(rollback);
    }

    net.connectPeer(1);

    // Build a packet manually
    var buf: [Packets.HEADER_SIZE + Packets.WIRE_EVENT_SIZE]u8 = undefined;

    const header = Packets.PacketHeader{
        .version = Packets.WIRE_VERSION,
        .peer_id = 1, // from peer 1
        .frame_ack = 3, // they acked our frame 3
        .frame_seq = 5, // they're at frame 5
        .event_count = 1,
        .flags = 0,
    };
    header.encode(buf[0..Packets.HEADER_SIZE]);

    const wire_event = Packets.WireEvent.fromEvent(Event.keyDown(.KeyW, .LocalKeyboard), 5);
    wire_event.encode(buf[Packets.HEADER_SIZE..]);

    // Add some unacked frames to peer 1 that will be trimmed
    const events = [_]Event{Event.keyDown(.KeyA, .LocalKeyboard)};
    net.peer_states[1].addUnacked(0, &events);
    net.peer_states[1].addUnacked(1, &events);
    net.peer_states[1].addUnacked(2, &events);
    net.peer_states[1].addUnacked(3, &events);
    net.peer_states[1].addUnacked(4, &events);
    try std.testing.expectEqual(@as(u16, 5), net.peer_states[1].unackedCount());

    // Receive the packet
    try net.receivePacket(&buf, rollback);

    // Check seq/ack updated
    try std.testing.expectEqual(@as(u16, 5), net.peer_states[1].remote_seq);

    // Check unacked trimmed (frames 0-3 acked)
    try std.testing.expectEqual(@as(u16, 1), net.peer_states[1].unackedCount());

    // Check event stored in rollback
    const stored = rollback.getInputs(1, 5);
    try std.testing.expectEqual(@as(usize, 1), stored.len);
    try std.testing.expectEqual(Events.Key.KeyW, stored[0].payload.key);

    // Check peer confirmed frame updated
    try std.testing.expectEqual(@as(u32, 5), rollback.peer_confirmed_frame[1]);
}
