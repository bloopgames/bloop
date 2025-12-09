const std = @import("std");
const Events = @import("events.zig");
const Event = Events.Event;
const EventType = Events.EventType;
const InputSource = Events.InputSource;
const Key = Events.Key;
const MouseButton = Events.MouseButton;

/// Wire format version
pub const WIRE_VERSION: u8 = 1;

/// Packet header size in bytes
pub const HEADER_SIZE: usize = 8;

/// Wire event size in bytes
pub const WIRE_EVENT_SIZE: usize = 9;

/// Maximum events per packet (255 fits in u8 event_count)
pub const MAX_EVENTS_PER_PACKET: usize = 255;

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

pub const DecodeError = error{
    BufferTooSmall,
    UnsupportedVersion,
    InvalidEventCount,
};

/// Calculate the packet size for a given number of events
pub fn packetSize(event_count: usize) usize {
    return HEADER_SIZE + (event_count * WIRE_EVENT_SIZE);
}

// ─────────────────────────────────────────────────────────────
// Tests
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
