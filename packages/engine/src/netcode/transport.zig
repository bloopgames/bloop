const std = @import("std");
const Events = @import("../events.zig");
const IB = @import("../input_buffer.zig");
const Log = @import("../log.zig");
const Ctx = @import("../context.zig");
const Event = Events.Event;
const EventType = Events.EventType;
const InputSource = Events.InputSource;
const Key = Events.Key;
const MouseButton = Events.MouseButton;

// Re-export from input_buffer for convenience
pub const MAX_ROLLBACK_FRAMES = IB.MAX_FRAMES;
pub const MAX_PEERS = IB.MAX_PEERS;

// ─────────────────────────────────────────────────────────────
// Wire Format
// ─────────────────────────────────────────────────────────────

/// Wire format version
pub const WIRE_VERSION: u8 = 1;

/// Packet header size in bytes
pub const HEADER_SIZE: usize = 8;

/// Wire event size in bytes
pub const WIRE_EVENT_SIZE: usize = 9;

/// Maximum events per packet (255 fits in u8 event_count)
pub const MAX_EVENTS_PER_PACKET: usize = 255;

pub const DecodeError = error{
    BufferTooSmall,
    UnsupportedVersion,
    InvalidEventCount,
};

/// Packet header (8 bytes)
/// Layout:
///   [0]    version      - Wire format version
///   [1]    peer_id      - Sender's peer ID (0-11)
///   [2-3]  frame_ack    - Highest frame received from recipient (little-endian)
///   [4-5]  frame_seq    - Sender's current match frame (little-endian)
///   [6]    event_count  - Number of events in packet
///   [7]    flags        - Reserved for future use
pub const PacketHeader = struct {
    version: u8,
    peer_id: u8,
    frame_ack: u16,
    frame_seq: u16,
    event_count: u8,
    flags: u8,

    pub fn encode(self: PacketHeader, buf: []u8) void {
        std.debug.assert(buf.len >= HEADER_SIZE);
        buf[0] = self.version;
        buf[1] = self.peer_id;
        std.mem.writeInt(u16, buf[2..4], self.frame_ack, .little);
        std.mem.writeInt(u16, buf[4..6], self.frame_seq, .little);
        buf[6] = self.event_count;
        buf[7] = self.flags;
    }

    pub fn decode(buf: []const u8) DecodeError!PacketHeader {
        if (buf.len < HEADER_SIZE) return DecodeError.BufferTooSmall;
        const version = buf[0];
        if (version != WIRE_VERSION) return DecodeError.UnsupportedVersion;
        return PacketHeader{
            .version = version,
            .peer_id = buf[1],
            .frame_ack = std.mem.readInt(u16, buf[2..4], .little),
            .frame_seq = std.mem.readInt(u16, buf[4..6], .little),
            .event_count = buf[6],
            .flags = buf[7],
        };
    }
};

/// Wire event (9 bytes, packed)
/// Layout:
///   [0-1]  frame        - Match frame this event occurred (little-endian)
///   [2]    kind         - EventType enum
///   [3]    device       - InputSource enum (device that generated the input)
///   [4-8]  payload      - Compact payload (5 bytes)
///
/// Note: peer_id is not stored per event - it comes from the packet header.
/// The receiver sets peer_id based on who sent the packet.
///
/// Payload formats:
///   KeyDown/KeyUp:    [u8 key_code][4 unused]
///   MouseDown/Up:     [u8 button][4 unused]
///   MouseMove:        [i16 x][i16 y][1 unused]
///   MouseWheel:       [i16 dx][i16 dy][1 unused]
pub const WireEvent = struct {
    frame: u16,
    kind: EventType,
    device: InputSource,
    payload: [5]u8,

    pub fn encode(self: WireEvent, buf: []u8) void {
        std.debug.assert(buf.len >= WIRE_EVENT_SIZE);
        std.mem.writeInt(u16, buf[0..2], self.frame, .little);
        buf[2] = @intFromEnum(self.kind);
        buf[3] = @intFromEnum(self.device);
        @memcpy(buf[4..9], &self.payload);
    }

    pub fn decode(buf: []const u8) DecodeError!WireEvent {
        if (buf.len < WIRE_EVENT_SIZE) return DecodeError.BufferTooSmall;
        return WireEvent{
            .frame = std.mem.readInt(u16, buf[0..2], .little),
            .kind = @enumFromInt(buf[2]),
            .device = @enumFromInt(buf[3]),
            .payload = buf[4..9].*,
        };
    }

    /// Create a WireEvent from an engine Event at a given frame
    pub fn fromEvent(event: Event, frame: u16) WireEvent {
        var payload: [5]u8 = .{ 0, 0, 0, 0, 0 };

        switch (event.kind) {
            .KeyDown, .KeyUp => {
                payload[0] = @intFromEnum(event.payload.key);
            },
            .MouseDown, .MouseUp => {
                payload[0] = @intFromEnum(event.payload.mouse_button);
            },
            .MouseMove => {
                // Compress f32 to i16 (assuming screen coords fit in i16 range)
                const x: i16 = @intFromFloat(std.math.clamp(event.payload.mouse_move.x, -32768.0, 32767.0));
                const y: i16 = @intFromFloat(std.math.clamp(event.payload.mouse_move.y, -32768.0, 32767.0));
                std.mem.writeInt(i16, payload[0..2], x, .little);
                std.mem.writeInt(i16, payload[2..4], y, .little);
            },
            .MouseWheel => {
                const dx: i16 = @intFromFloat(std.math.clamp(event.payload.delta.delta_x, -32768.0, 32767.0));
                const dy: i16 = @intFromFloat(std.math.clamp(event.payload.delta.delta_y, -32768.0, 32767.0));
                std.mem.writeInt(i16, payload[0..2], dx, .little);
                std.mem.writeInt(i16, payload[2..4], dy, .little);
            },
            else => {},
        }

        return WireEvent{
            .frame = frame,
            .kind = event.kind,
            .device = event.device,
            .payload = payload,
        };
    }

    /// Convert back to an engine Event (peer_id will be LOCAL_PEER; caller should set it)
    pub fn toEvent(self: WireEvent) Event {
        var event = Event{
            .kind = self.kind,
            .device = self.device,
            .payload = undefined,
        };

        switch (self.kind) {
            .KeyDown, .KeyUp => {
                event.payload = .{ .key = @enumFromInt(self.payload[0]) };
            },
            .MouseDown, .MouseUp => {
                event.payload = .{ .mouse_button = @enumFromInt(self.payload[0]) };
            },
            .MouseMove => {
                const x = std.mem.readInt(i16, self.payload[0..2], .little);
                const y = std.mem.readInt(i16, self.payload[2..4], .little);
                event.payload = .{ .mouse_move = .{
                    .x = @floatFromInt(x),
                    .y = @floatFromInt(y),
                } };
            },
            .MouseWheel => {
                const dx = std.mem.readInt(i16, self.payload[0..2], .little);
                const dy = std.mem.readInt(i16, self.payload[2..4], .little);
                event.payload = .{ .delta = .{
                    .delta_x = @floatFromInt(dx),
                    .delta_y = @floatFromInt(dy),
                } };
            },
            else => {
                event.payload = .{ .key = .None };
            },
        }

        return event;
    }
};

/// Calculate the packet size for a given number of events
pub fn packetSize(event_count: usize) usize {
    return HEADER_SIZE + (event_count * WIRE_EVENT_SIZE);
}

// ─────────────────────────────────────────────────────────────
// Peer State
// ─────────────────────────────────────────────────────────────

/// Per-peer unacked window tracking (transient state for packet building)
/// Connection state (seq, ack, connected) now lives in NetCtx
pub const PeerUnackedWindow = struct {
    /// Oldest unacked frame (in match frame space)
    unacked_start: u16 = 0,
    /// Next frame to be added (in match frame space)
    unacked_end: u16 = 0,

    /// Reset window when peer disconnects or session ends
    pub fn reset(self: *PeerUnackedWindow) void {
        self.unacked_start = 0;
        self.unacked_end = 0;
    }

    /// Extend the unacked window to include a new frame.
    /// Events are already in InputBuffer from append_event - this just tracks the window.
    pub fn extendUnacked(self: *PeerUnackedWindow, match_frame: u16) void {
        if (match_frame >= self.unacked_end) {
            self.unacked_end = match_frame + 1;
        }
    }

    /// Trim unacked frames that have been acknowledged
    pub fn trimAcked(self: *PeerUnackedWindow, ack_frame: u16) void {
        // Advance start to one past the acked frame
        if (ack_frame >= self.unacked_start) {
            self.unacked_start = ack_frame + 1;
        }
    }

    /// Get the number of unacked frames
    pub fn unackedCount(self: *const PeerUnackedWindow) u16 {
        if (self.unacked_end <= self.unacked_start) return 0;
        return self.unacked_end - self.unacked_start;
    }
};

// ─────────────────────────────────────────────────────────────
// Network State
// ─────────────────────────────────────────────────────────────

/// Network state for all peers in a session
/// Connection state (seq, ack, connected) lives in NetCtx - this is just for packet building
pub const NetState = struct {
    /// Allocator for packet buffers
    allocator: std.mem.Allocator,
    /// Scratch buffer for outbound packets (reused across calls)
    outbound_buffer: ?[]u8 = null,
    /// Length of current outbound packet
    outbound_len: u32 = 0,
    /// Reference to canonical InputBuffer (for reading unacked events)
    input_buffer: ?*IB.InputBuffer = null,
    /// Reference to NetCtx (single source of truth for peer state)
    net_ctx: ?*Ctx.NetCtx = null,
    /// Per-peer unacked window tracking (transient state for packet building)
    peer_unacked: [MAX_PEERS]PeerUnackedWindow = [_]PeerUnackedWindow{.{}} ** MAX_PEERS,

    pub fn deinit(self: *NetState) void {
        if (self.outbound_buffer) |buf| {
            self.allocator.free(buf);
            self.outbound_buffer = null;
        }
        self.outbound_len = 0;
    }

    /// Reset all unacked windows (for session end)
    pub fn reset(self: *NetState) void {
        for (&self.peer_unacked) |*peer| {
            peer.reset();
        }
        self.outbound_len = 0;
    }

    /// Disconnect a peer (reset unacked window only)
    pub fn disconnectPeer(self: *NetState, peer_id: u8) void {
        if (peer_id < MAX_PEERS) {
            self.peer_unacked[peer_id].reset();
        }
    }

    /// Extend unacked window for all connected peers.
    /// Events are already in InputBuffer from append_event - this just tracks the window.
    pub fn extendUnackedWindow(self: *NetState, match_frame: u16) void {
        const net_ctx = self.net_ctx orelse return;
        const local_peer_id = net_ctx.local_peer_id;

        for (&self.peer_unacked, 0..) |*peer, i| {
            const connected = net_ctx.peer_connected[i] == 1;
            if (connected and i != local_peer_id) {
                peer.extendUnacked(match_frame);
            }
        }
    }

    /// Build outbound packet for a target peer.
    /// Reads events from InputBuffer via the unacked window.
    pub fn buildOutboundPacket(self: *NetState, target_peer: u8, current_match_frame: u16) !void {
        if (target_peer >= MAX_PEERS) {
            Log.log("buildOutboundPacket: target_peer {} >= MAX_PEERS", .{target_peer});
            @panic("buildOutboundPacket: target_peer >= MAX_PEERS");
        }

        const net_ctx = self.net_ctx orelse {
            Log.log("buildOutboundPacket: net_ctx is null", .{});
            @panic("buildOutboundPacket: net_ctx is null");
        };

        // Read peer state from NetCtx (single source of truth)
        const connected = net_ctx.peer_connected[target_peer] == 1;
        if (!connected) {
            Log.log("buildOutboundPacket: peer {} not connected (peer_count={}, local_peer_id={})", .{ target_peer, net_ctx.peer_count, net_ctx.local_peer_id });
            @panic("buildOutboundPacket: peer not connected");
        }

        const ib = self.input_buffer orelse {
            Log.log("buildOutboundPacket: input_buffer is null", .{});
            @panic("buildOutboundPacket: input_buffer is null");
        };

        const peer_window = &self.peer_unacked[target_peer];
        const local_peer_id = net_ctx.local_peer_id;
        const remote_seq = net_ctx.peer_remote_seq[target_peer];

        // Count events across all unacked frames (reading from InputBuffer)
        var total_events: usize = 0;
        var frame = peer_window.unacked_start;
        while (frame < peer_window.unacked_end) : (frame += 1) {
            const events = ib.get(local_peer_id, frame);
            total_events += events.len;
        }

        // Clamp to max events per packet
        if (total_events > MAX_EVENTS_PER_PACKET) {
            total_events = MAX_EVENTS_PER_PACKET;
        }

        // Calculate required buffer size
        const required_size = packetSize(total_events);

        // Ensure buffer is large enough
        if (self.outbound_buffer == null or self.outbound_buffer.?.len < required_size) {
            if (self.outbound_buffer) |old| {
                self.allocator.free(old);
            }
            self.outbound_buffer = try self.allocator.alloc(u8, required_size);
        }

        const buf = self.outbound_buffer.?;

        // Write header using NetCtx values
        const header = PacketHeader{
            .version = WIRE_VERSION,
            .peer_id = local_peer_id,
            .frame_ack = remote_seq,
            .frame_seq = current_match_frame,
            .event_count = @intCast(total_events),
            .flags = 0,
        };
        header.encode(buf[0..HEADER_SIZE]);

        // Write events (reading from InputBuffer)
        var offset: usize = HEADER_SIZE;
        var events_written: usize = 0;
        frame = peer_window.unacked_start;
        outer: while (frame < peer_window.unacked_end) : (frame += 1) {
            const events = ib.get(local_peer_id, frame);
            for (events) |event| {
                if (events_written >= total_events) break :outer;
                const wire_event = WireEvent.fromEvent(event, frame);
                wire_event.encode(buf[offset .. offset + WIRE_EVENT_SIZE]);
                offset += WIRE_EVENT_SIZE;
                events_written += 1;
            }
        }

        self.outbound_len = @intCast(offset);

        // Update local_seq in NetCtx
        net_ctx.peer_local_seq[target_peer] = current_match_frame;
    }

};

// ─────────────────────────────────────────────────────────────
// Wire Format Tests
// ─────────────────────────────────────────────────────────────

test "PacketHeader encode/decode round-trip" {
    const header = PacketHeader{
        .version = WIRE_VERSION,
        .peer_id = 3,
        .frame_ack = 1234,
        .frame_seq = 5678,
        .event_count = 42,
        .flags = 0,
    };

    var buf: [HEADER_SIZE]u8 = undefined;
    header.encode(&buf);

    const decoded = try PacketHeader.decode(&buf);
    try std.testing.expectEqual(header.version, decoded.version);
    try std.testing.expectEqual(header.peer_id, decoded.peer_id);
    try std.testing.expectEqual(header.frame_ack, decoded.frame_ack);
    try std.testing.expectEqual(header.frame_seq, decoded.frame_seq);
    try std.testing.expectEqual(header.event_count, decoded.event_count);
    try std.testing.expectEqual(header.flags, decoded.flags);
}

test "PacketHeader decode rejects wrong version" {
    var buf: [HEADER_SIZE]u8 = .{ 99, 0, 0, 0, 0, 0, 0, 0 }; // version 99
    try std.testing.expectError(DecodeError.UnsupportedVersion, PacketHeader.decode(&buf));
}

test "PacketHeader decode rejects small buffer" {
    var buf: [4]u8 = undefined;
    try std.testing.expectError(DecodeError.BufferTooSmall, PacketHeader.decode(&buf));
}

test "WireEvent encode/decode round-trip" {
    const wire_event = WireEvent{
        .frame = 12345,
        .kind = .KeyDown,
        .device = .LocalKeyboard,
        .payload = .{ 42, 1, 2, 3, 4 },
    };

    var buf: [WIRE_EVENT_SIZE]u8 = undefined;
    wire_event.encode(&buf);

    const decoded = try WireEvent.decode(&buf);
    try std.testing.expectEqual(wire_event.frame, decoded.frame);
    try std.testing.expectEqual(wire_event.kind, decoded.kind);
    try std.testing.expectEqual(wire_event.device, decoded.device);
    try std.testing.expectEqualSlices(u8, &wire_event.payload, &decoded.payload);
}

test "WireEvent fromEvent/toEvent round-trip: KeyDown" {
    const event = Event.keyDown(.KeyA, 0, .LocalKeyboard);
    const wire = WireEvent.fromEvent(event, 100);
    const back = wire.toEvent();

    try std.testing.expectEqual(event.kind, back.kind);
    try std.testing.expectEqual(event.device, back.device);
    try std.testing.expectEqual(event.payload.key, back.payload.key);
    try std.testing.expectEqual(@as(u16, 100), wire.frame);
}

test "WireEvent fromEvent/toEvent round-trip: KeyUp" {
    const event = Event.keyUp(.Space, 0, .LocalKeyboard);
    const wire = WireEvent.fromEvent(event, 200);
    const back = wire.toEvent();

    try std.testing.expectEqual(event.kind, back.kind);
    try std.testing.expectEqual(event.device, back.device);
    try std.testing.expectEqual(event.payload.key, back.payload.key);
}

test "WireEvent fromEvent/toEvent round-trip: MouseDown" {
    const event = Event.mouseDown(.Left, 0, .LocalMouse);
    const wire = WireEvent.fromEvent(event, 50);
    const back = wire.toEvent();

    try std.testing.expectEqual(event.kind, back.kind);
    try std.testing.expectEqual(event.device, back.device);
    try std.testing.expectEqual(event.payload.mouse_button, back.payload.mouse_button);
}

test "WireEvent fromEvent/toEvent round-trip: MouseUp" {
    const event = Event.mouseUp(.Right, 0, .LocalMouse);
    const wire = WireEvent.fromEvent(event, 75);
    const back = wire.toEvent();

    try std.testing.expectEqual(event.kind, back.kind);
    try std.testing.expectEqual(event.device, back.device);
    try std.testing.expectEqual(event.payload.mouse_button, back.payload.mouse_button);
}

test "WireEvent fromEvent/toEvent round-trip: MouseMove" {
    const event = Event.mouseMove(123.0, -456.0, 0, .LocalMouse);
    const wire = WireEvent.fromEvent(event, 300);
    const back = wire.toEvent();

    try std.testing.expectEqual(event.kind, back.kind);
    try std.testing.expectEqual(event.device, back.device);
    // f32 -> i16 -> f32 loses precision, but should be exact for integers
    try std.testing.expectEqual(@as(f32, 123.0), back.payload.mouse_move.x);
    try std.testing.expectEqual(@as(f32, -456.0), back.payload.mouse_move.y);
}

test "WireEvent fromEvent/toEvent round-trip: MouseWheel" {
    const event = Event.mouseWheel(10.0, -20.0, 0, .LocalMouse);
    const wire = WireEvent.fromEvent(event, 400);
    const back = wire.toEvent();

    try std.testing.expectEqual(event.kind, back.kind);
    try std.testing.expectEqual(event.device, back.device);
    try std.testing.expectEqual(@as(f32, 10.0), back.payload.delta.delta_x);
    try std.testing.expectEqual(@as(f32, -20.0), back.payload.delta.delta_y);
}

test "WireEvent MouseMove clamps extreme values" {
    // Test positive overflow
    const event_big = Event.mouseMove(50000.0, 50000.0, 0, .LocalMouse);
    const wire_big = WireEvent.fromEvent(event_big, 0);
    const back_big = wire_big.toEvent();
    try std.testing.expectEqual(@as(f32, 32767.0), back_big.payload.mouse_move.x);
    try std.testing.expectEqual(@as(f32, 32767.0), back_big.payload.mouse_move.y);

    // Test negative overflow
    const event_small = Event.mouseMove(-50000.0, -50000.0, 0, .LocalMouse);
    const wire_small = WireEvent.fromEvent(event_small, 0);
    const back_small = wire_small.toEvent();
    try std.testing.expectEqual(@as(f32, -32768.0), back_small.payload.mouse_move.x);
    try std.testing.expectEqual(@as(f32, -32768.0), back_small.payload.mouse_move.y);
}

test "packetSize calculation" {
    try std.testing.expectEqual(@as(usize, 8), packetSize(0)); // header only
    try std.testing.expectEqual(@as(usize, 17), packetSize(1)); // 8 + 9
    try std.testing.expectEqual(@as(usize, 548), packetSize(60)); // 8 + 540
    try std.testing.expectEqual(@as(usize, 2303), packetSize(255)); // 8 + 2295
}

// ─────────────────────────────────────────────────────────────
// PeerUnackedWindow Tests
// ─────────────────────────────────────────────────────────────

test "PeerUnackedWindow init and reset" {
    var peer = PeerUnackedWindow{};

    try std.testing.expectEqual(@as(u16, 0), peer.unacked_start);
    try std.testing.expectEqual(@as(u16, 0), peer.unacked_end);

    peer.unacked_start = 10;
    peer.unacked_end = 20;

    peer.reset();

    try std.testing.expectEqual(@as(u16, 0), peer.unacked_start);
    try std.testing.expectEqual(@as(u16, 0), peer.unacked_end);
}

test "PeerUnackedWindow extendUnacked" {
    var peer = PeerUnackedWindow{};

    try std.testing.expectEqual(@as(u16, 0), peer.unacked_start);
    try std.testing.expectEqual(@as(u16, 0), peer.unacked_end);

    peer.extendUnacked(5);

    try std.testing.expectEqual(@as(u16, 0), peer.unacked_start);
    try std.testing.expectEqual(@as(u16, 6), peer.unacked_end);
    try std.testing.expectEqual(@as(u16, 6), peer.unackedCount());
}

test "PeerUnackedWindow unackedCount" {
    var peer = PeerUnackedWindow{};

    try std.testing.expectEqual(@as(u16, 0), peer.unackedCount());

    peer.extendUnacked(0);
    try std.testing.expectEqual(@as(u16, 1), peer.unackedCount());

    peer.extendUnacked(1);
    peer.extendUnacked(2);
    try std.testing.expectEqual(@as(u16, 3), peer.unackedCount());
}

test "PeerUnackedWindow trimAcked" {
    var peer = PeerUnackedWindow{};

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
    var net_ctx = Ctx.NetCtx{
        .peer_count = 0,
        .match_frame = 0,
    };

    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator, .net_ctx = &net_ctx };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    try std.testing.expectEqual(@as(?[]u8, null), net.outbound_buffer);
}

test "NetState disconnectPeer resets unacked window" {
    var net_ctx = Ctx.NetCtx{
        .peer_count = 2,
        .match_frame = 0,
    };

    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator, .net_ctx = &net_ctx };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    // Set up unacked window for peer 1
    net.peer_unacked[1].extendUnacked(10);
    try std.testing.expectEqual(@as(u16, 11), net.peer_unacked[1].unacked_end);

    // Disconnect peer 1
    net.disconnectPeer(1);

    // Unacked window should be reset
    try std.testing.expectEqual(@as(u16, 0), net.peer_unacked[1].unacked_start);
    try std.testing.expectEqual(@as(u16, 0), net.peer_unacked[1].unacked_end);
}

test "NetState extendUnackedWindow" {
    var net_ctx = Ctx.NetCtx{
        .peer_count = 3,
        .local_peer_id = 0,
        .match_frame = 0,
    };
    // Mark peers 1 and 2 as connected
    net_ctx.peer_connected[1] = 1;
    net_ctx.peer_connected[2] = 1;

    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator, .net_ctx = &net_ctx };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

    // Extend window to frame 0
    net.extendUnackedWindow(0);

    // Should be extended for peer 1 and 2, not peer 0 (self)
    try std.testing.expectEqual(@as(u16, 0), net.peer_unacked[0].unackedCount());
    try std.testing.expectEqual(@as(u16, 1), net.peer_unacked[1].unackedCount());
    try std.testing.expectEqual(@as(u16, 1), net.peer_unacked[2].unackedCount());

    // Extend to more frames
    net.extendUnackedWindow(1);
    net.extendUnackedWindow(2);
    try std.testing.expectEqual(@as(u16, 3), net.peer_unacked[1].unackedCount());
}

test "NetState buildOutboundPacket reads from NetCtx" {
    // Create InputBuffer first
    const input_buffer = try std.testing.allocator.create(IB.InputBuffer);
    input_buffer.* = .{};
    input_buffer.init(2, 0);
    defer std.testing.allocator.destroy(input_buffer);

    var net_ctx = Ctx.NetCtx{
        .peer_count = 2,
        .local_peer_id = 0,
        .match_frame = 0,
    };
    // Mark peer 1 as connected
    net_ctx.peer_connected[1] = 1;

    const net = try std.testing.allocator.create(NetState);
    net.* = .{ .allocator = std.testing.allocator, .input_buffer = input_buffer, .net_ctx = &net_ctx };
    defer {
        net.deinit();
        std.testing.allocator.destroy(net);
    }

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
    const header = try PacketHeader.decode(net.outbound_buffer.?[0..HEADER_SIZE]);
    try std.testing.expectEqual(@as(u8, 0), header.peer_id); // our local peer
    try std.testing.expectEqual(@as(u16, 5), header.frame_seq);
    try std.testing.expectEqual(@as(u8, 2), header.event_count); // 2 events (1 per frame)

    // Verify local_seq updated in NetCtx
    try std.testing.expectEqual(@as(u16, 5), net_ctx.peer_local_seq[1]);
}

// Note: receivePacket test removed - logic moved to Engine.processPacketEvent
