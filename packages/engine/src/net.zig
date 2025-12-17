const std = @import("std");
const Events = @import("events.zig");
pub const Packets = @import("packets.zig");
const rollback = @import("rollback.zig");
const InputBuffer = @import("input_buffer.zig");
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

    /// View window into InputBuffer for unacked frames
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

    /// Extend the unacked window to include a new frame.
    /// Events are already in InputBuffer from append_event - this just tracks the window.
    pub fn extendUnacked(self: *PeerNetState, match_frame: u16) void {
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
    /// Reference to canonical InputBuffer (for reading unacked events)
    input_buffer: ?*InputBuffer.InputBuffer = null,

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

    /// Extend unacked window for all connected peers.
    /// Events are already in InputBuffer from append_event - this just tracks the window.
    pub fn extendUnackedWindow(self: *NetState, match_frame: u16) void {
        for (&self.peer_states, 0..) |*peer, i| {
            if (peer.connected and i != self.local_peer_id) {
                peer.extendUnacked(match_frame);
            }
        }
    }

    /// Build outbound packet for a target peer.
    /// Reads events from InputBuffer via the unacked window.
    pub fn buildOutboundPacket(self: *NetState, target_peer: u8, current_match_frame: u16) !void {
        if (target_peer >= MAX_PEERS) return;
        const peer = &self.peer_states[target_peer];
        if (!peer.connected) {
            self.outbound_len = 0;
            return;
        }

        const ib = self.input_buffer orelse {
            self.outbound_len = 0;
            return;
        };

        // Count events across all unacked frames (reading from InputBuffer)
        var total_events: usize = 0;
        var frame = peer.unacked_start;
        while (frame < peer.unacked_end) : (frame += 1) {
            const events = ib.get(self.local_peer_id, frame);
            total_events += events.len;
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

        // Write events (reading from InputBuffer)
        var offset: usize = Packets.HEADER_SIZE;
        var events_written: usize = 0;
        frame = peer.unacked_start;
        outer: while (frame < peer.unacked_end) : (frame += 1) {
            const events = ib.get(self.local_peer_id, frame);
            for (events) |event| {
                if (events_written >= total_events) break :outer;
                const wire_event = Packets.WireEvent.fromEvent(event, frame);
                wire_event.encode(buf[offset .. offset + Packets.WIRE_EVENT_SIZE]);
                offset += Packets.WIRE_EVENT_SIZE;
                events_written += 1;
            }
        }

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

        // Decode and store events via RollbackState (which delegates to InputBuffer)
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
                // Use RollbackState's emitInputs which delegates to InputBuffer
                rb.emitInputs(header.peer_id, wire_event.frame, &[_]Event{event});
            }

            offset += Packets.WIRE_EVENT_SIZE;
        }

        // peer_confirmed is updated automatically by emitInputs -> InputBuffer.emit
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

test "PeerNetState extendUnacked" {
    var peer = PeerNetState{};

    try std.testing.expectEqual(@as(u16, 0), peer.unacked_start);
    try std.testing.expectEqual(@as(u16, 0), peer.unacked_end);

    peer.extendUnacked(5);

    try std.testing.expectEqual(@as(u16, 0), peer.unacked_start);
    try std.testing.expectEqual(@as(u16, 6), peer.unacked_end);
    try std.testing.expectEqual(@as(u16, 6), peer.unackedCount());
}

test "PeerNetState unackedCount" {
    var peer = PeerNetState{};

    try std.testing.expectEqual(@as(u16, 0), peer.unackedCount());

    peer.extendUnacked(0);
    try std.testing.expectEqual(@as(u16, 1), peer.unackedCount());

    peer.extendUnacked(1);
    peer.extendUnacked(2);
    try std.testing.expectEqual(@as(u16, 3), peer.unackedCount());
}

test "PeerNetState trimAcked" {
    var peer = PeerNetState{};

    // Extend to frames 0-4
    peer.extendUnacked(4);
    try std.testing.expectEqual(@as(u16, 5), peer.unackedCount());

    // Ack frame 2 (trims 0, 1, 2)
    peer.trimAcked(2);
    try std.testing.expectEqual(@as(u16, 3), peer.unacked_start);
    try std.testing.expectEqual(@as(u16, 2), peer.unackedCount());
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

test "NetState extendUnackedWindow" {
    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    net.setLocalPeer(0);
    net.connectPeer(1);
    net.connectPeer(2);

    // Extend window to frame 0
    net.extendUnackedWindow(0);

    // Should be extended for peer 1 and 2, not peer 0 (self)
    try std.testing.expectEqual(@as(u16, 0), net.peer_states[0].unackedCount());
    try std.testing.expectEqual(@as(u16, 1), net.peer_states[1].unackedCount());
    try std.testing.expectEqual(@as(u16, 1), net.peer_states[2].unackedCount());

    // Extend to more frames
    net.extendUnackedWindow(1);
    net.extendUnackedWindow(2);
    try std.testing.expectEqual(@as(u16, 3), net.peer_states[1].unackedCount());
}

test "NetState buildOutboundPacket" {
    // Create InputBuffer first
    const input_buffer = try std.testing.allocator.create(InputBuffer.InputBuffer);
    input_buffer.* = .{};
    input_buffer.init(2, 0);
    defer std.testing.allocator.destroy(input_buffer);

    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator, .input_buffer = input_buffer };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    net.setLocalPeer(0);
    net.connectPeer(1);

    // Emit events to InputBuffer (local peer = 0)
    const events = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
    input_buffer.emit(0, 0, &events);
    input_buffer.emit(0, 1, &events);

    // Extend unacked window for peer 1
    net.extendUnackedWindow(0);
    net.extendUnackedWindow(1);

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
    // Create InputBuffer for both RollbackState and NetState
    const input_buffer = try std.testing.allocator.create(InputBuffer.InputBuffer);
    input_buffer.* = .{};
    input_buffer.init(2, 0);
    defer std.testing.allocator.destroy(input_buffer);

    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator, .input_buffer = input_buffer };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    const rb = try std.testing.allocator.create(RollbackState);
    rb.* = .{
        .peer_count = 2,
        .input_buffer = input_buffer,
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

    // Extend unacked window for peer 1 (frames 0-4)
    net.peer_states[1].extendUnacked(4);
    try std.testing.expectEqual(@as(u16, 5), net.peer_states[1].unackedCount());

    // Receive the packet
    try net.receivePacket(&buf, rb);

    // Check seq/ack updated
    try std.testing.expectEqual(@as(u16, 5), net.peer_states[1].remote_seq);

    // Check unacked trimmed (frames 0-3 acked)
    try std.testing.expectEqual(@as(u16, 1), net.peer_states[1].unackedCount());

    // Check event stored in rollback (via InputBuffer)
    const stored = rb.getInputs(1, 5);
    try std.testing.expectEqual(@as(usize, 1), stored.len);
    try std.testing.expectEqual(Events.Key.KeyW, stored[0].payload.key);

    // Check peer confirmed frame updated (via InputBuffer)
    try std.testing.expectEqual(@as(u32, 5), rb.getPeerConfirmedFrame(1));
}
