const std = @import("std");
const Events = @import("events.zig");
pub const Packets = @import("packets.zig");
const rollback = @import("rollback.zig");
const Event = Events.Event;
const Log = @import("log.zig");

// Re-export from rollback for convenience
pub const MAX_ROLLBACK_FRAMES = rollback.MAX_ROLLBACK_FRAMES;
pub const MAX_PEERS = rollback.MAX_PEERS;
pub const InputFrame = rollback.InputFrame;
pub const RollbackState = rollback.RollbackState;

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
        var input_frame = &self.unacked_frames[slot];
        // Only clear if this slot was for a different frame (preserves multiple events per frame)
        if (input_frame.frame != match_frame) {
            input_frame.clear();
            input_frame.setFrame(match_frame);
        }
        for (events) |event| {
            input_frame.add(event);
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
            Log.log("PeerNetState.trimAcked: ack_frame={}, old_unacked_start={}", .{
                ack_frame,
                self.unacked_start,
            });
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
        const input_frame = &self.unacked_frames[slot];

        if (input_frame.frame != match_frame) {
            return null;
        }
        return input_frame.slice();
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

        Log.log("Built outbound packet for peer {}: unacked_start={}, unacked_end={}, events_written={}", .{
            target_peer,
            peer.unacked_start,
            peer.unacked_end,
            events_written,
        });

        self.outbound_len = @intCast(offset);

        // Update local_seq for this peer
        peer.local_seq = current_match_frame;
    }

    /// Process a received packet, updating state and storing events in rollback state
    pub fn receivePacket(self: *NetState, buf: []const u8, rb: *RollbackState) Packets.DecodeError!void {
        const header = try Packets.PacketHeader.decode(buf);

        if (header.peer_id >= MAX_PEERS) return;
        const peer = &self.peer_states[header.peer_id];

        // Capture old remote_seq before updating to filter duplicate events
        const old_remote_seq = peer.remote_seq;

        // Update seq/ack tracking
        if (header.frame_seq > peer.remote_seq) {
            peer.remote_seq = header.frame_seq;
        }

        // Update remote_ack - what frame they've received from us
        if (header.frame_ack > peer.remote_ack) {
            peer.remote_ack = header.frame_ack;
        }

        // Trim our unacked buffer up to the acked frame
        peer.trimAcked(header.frame_ack);

        // Decode and store events
        var offset: usize = Packets.HEADER_SIZE;
        var i: usize = 0;
        while (i < header.event_count) : (i += 1) {
            if (offset + Packets.WIRE_EVENT_SIZE > buf.len) {
                return Packets.DecodeError.BufferTooSmall;
            }
            const wire_event = try Packets.WireEvent.decode(buf[offset .. offset + Packets.WIRE_EVENT_SIZE]);
            var event = wire_event.toEvent();
            // Set peer_id from packet header so events are routed to correct player
            event.peer_id = header.peer_id;

            // Only add events for frames we haven't received yet.
            // Each packet retransmits all unacked events, so we filter duplicates
            // by only accepting events for frames > our last received frame.
            if (wire_event.frame > old_remote_seq) {
                const slot = wire_event.frame % MAX_ROLLBACK_FRAMES;
                var input_frame = &rb.peer_inputs[header.peer_id][slot];

                // If this slot was for a different frame, clear it first
                if (input_frame.frame != wire_event.frame) {
                    input_frame.clear();
                    input_frame.setFrame(wire_event.frame);
                }
                input_frame.add(event);
            }

            offset += Packets.WIRE_EVENT_SIZE;
        }

        // Update peer confirmed frame in rollback state
        if (header.frame_seq > rb.peer_confirmed_frame[header.peer_id]) {
            rb.peer_confirmed_frame[header.peer_id] = header.frame_seq;
        }
    }
};

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
        Event.keyDown(.KeyA, 0, .LocalKeyboard),
        Event.keyDown(.KeyW, 0, .LocalKeyboard),
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

    const events = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};

    peer.addUnacked(0, &events);
    try std.testing.expectEqual(@as(u16, 1), peer.unackedCount());

    peer.addUnacked(1, &events);
    peer.addUnacked(2, &events);
    try std.testing.expectEqual(@as(u16, 3), peer.unackedCount());
}

test "PeerNetState trimAcked" {
    var peer = PeerNetState{};
    const events = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};

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
    const events = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};

    // Add frames 0 to MAX_ROLLBACK_FRAMES-1 (fills buffer)
    for (0..MAX_ROLLBACK_FRAMES) |i| {
        peer.addUnacked(@intCast(i), &events);
    }
    try std.testing.expectEqual(@as(u16, MAX_ROLLBACK_FRAMES), peer.unackedCount());

    // Ack all but last 5
    peer.trimAcked(@intCast(MAX_ROLLBACK_FRAMES - 6));
    try std.testing.expectEqual(@as(u16, 5), peer.unackedCount());

    // Add frame MAX_ROLLBACK_FRAMES (wraps to slot 0)
    const eventsWrap = [_]Event{Event.keyDown(.KeyB, 0, .LocalKeyboard)};
    peer.addUnacked(@intCast(MAX_ROLLBACK_FRAMES), &eventsWrap);

    // Frame MAX_ROLLBACK_FRAMES should be accessible at slot 0
    const retrieved = peer.getUnackedFrame(@intCast(MAX_ROLLBACK_FRAMES));
    try std.testing.expect(retrieved != null);
    try std.testing.expectEqual(Events.Key.KeyB, retrieved.?[0].payload.key);
}

test "PeerNetState getUnackedFrame rejects stale data after wraparound" {
    var peer = PeerNetState{};
    const events = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
    peer.addUnacked(5, &events);
    peer.trimAcked(4);

    const events35 = [_]Event{Event.keyDown(.KeyB, 0, .LocalKeyboard)};
    peer.addUnacked(35, &events35);

    // Frame 5 should return null (stale data - slot reused by frame 35)
    try std.testing.expectEqual(@as(?[]const Event, null), peer.getUnackedFrame(5));
    // Frame 35 should return data
    const retrieved = peer.getUnackedFrame(35);
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
    const events = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
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
    const events = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
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

    const rb = try std.testing.allocator.create(RollbackState);
    rb.* = .{
        .peer_count = 2,
        .allocator = std.testing.allocator,
    };
    defer {
        rb.deinit();
        std.testing.allocator.destroy(rb);
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

    const wire_event = Packets.WireEvent.fromEvent(Event.keyDown(.KeyW, 0, .LocalKeyboard), 5);
    wire_event.encode(buf[Packets.HEADER_SIZE..]);

    // Add some unacked frames to peer 1 that will be trimmed
    const events = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
    net.peer_states[1].addUnacked(0, &events);
    net.peer_states[1].addUnacked(1, &events);
    net.peer_states[1].addUnacked(2, &events);
    net.peer_states[1].addUnacked(3, &events);
    net.peer_states[1].addUnacked(4, &events);
    try std.testing.expectEqual(@as(u16, 5), net.peer_states[1].unackedCount());

    // Receive the packet
    try net.receivePacket(&buf, rb);

    // Check seq/ack updated
    try std.testing.expectEqual(@as(u16, 5), net.peer_states[1].remote_seq);

    // Check unacked trimmed (frames 0-3 acked)
    try std.testing.expectEqual(@as(u16, 1), net.peer_states[1].unackedCount());

    // Check event stored in rollback
    const stored = rb.getInputs(1, 5);
    try std.testing.expectEqual(@as(usize, 1), stored.len);
    try std.testing.expectEqual(Events.Key.KeyW, stored[0].payload.key);

    // Check peer confirmed frame updated
    try std.testing.expectEqual(@as(u32, 5), rb.peer_confirmed_frame[1]);
}
