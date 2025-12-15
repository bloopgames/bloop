const std = @import("std");
const builtin = @import("builtin");
const Ctx = @import("context.zig");
const Events = @import("events.zig");
const Event = Events.Event;
const EventBuffer = Events.EventBuffer;
const MAX_EVENTS = Events.MAX_EVENTS;
const log = @import("log.zig").log;

const EnginePointer = if (builtin.target.cpu.arch.isWasm()) u32 else usize;

pub const Snapshot = extern struct {
    version: u32,
    user_data_len: u32,
    engine_data_len: u32,
    snapshot_len: u32,
    time_len: u32,
    input_len: u32,
    net_len: u32,
    events_len: u32,
    time: Ctx.TimeCtx,
    inputs: Ctx.InputCtx,
    net: Ctx.NetCtx,
    events: EventBuffer,

    pub fn init(
        alloc: std.mem.Allocator,
        user_data_len: u32,
    ) !*Snapshot {
        const alignment = comptime std.mem.Alignment.fromByteUnits(@alignOf(Snapshot));
        const bytes = try alloc.alignedAlloc(u8, alignment, @sizeOf(Snapshot) + @as(usize, user_data_len));

        const snapshot: *Snapshot = @ptrCast(bytes.ptr);
        snapshot.*.version = 1;
        snapshot.*.time_len = @sizeOf(Ctx.TimeCtx);
        snapshot.*.input_len = @sizeOf(Ctx.InputCtx);
        snapshot.*.events_len = @sizeOf(EventBuffer);
        snapshot.*.net_len = @sizeOf(Ctx.NetCtx);
        snapshot.*.user_data_len = user_data_len;
        snapshot.*.engine_data_len = @sizeOf(Snapshot);
        snapshot.*.time = Ctx.TimeCtx{ .frame = 0, .dt_ms = 0, .total_ms = 0 };
        snapshot.*.net = Ctx.NetCtx{ .peer_count = 0, .match_frame = 0, .session_start_frame = 0 };

        return snapshot;
    }

    pub fn deinit(self: *Snapshot, alloc: std.mem.Allocator) void {
        const total_size = @sizeOf(Snapshot) + @as(usize, self.user_data_len);
        const base_ptr: [*]align(@alignOf(Snapshot)) u8 = @ptrCast(self);
        const bytes = @as([*]align(@alignOf(Snapshot)) u8, base_ptr)[0..total_size];
        alloc.free(bytes);
    }

    pub fn write_time(self: *Snapshot, time_ptr: EnginePointer) void {
        const out: [*]u8 = @ptrCast(self);
        const time_ctx: *const Ctx.TimeCtx = @ptrFromInt(time_ptr);
        const time_len_offset = @offsetOf(Snapshot, "time_len");
        const time_offset = @offsetOf(Snapshot, "time");
        const size = @sizeOf(Ctx.TimeCtx);

        std.mem.writeInt(u32, out[time_len_offset .. time_len_offset + 4], size, .little);
        @memcpy(out[time_offset .. time_offset + size], std.mem.asBytes(time_ctx));
    }

    pub fn write_inputs(self: *Snapshot, input_ptr: EnginePointer) void {
        const out: [*]u8 = @ptrCast(self);
        const input_ctx: *const Ctx.InputCtx = @ptrFromInt(input_ptr);
        const input_len_offset = @offsetOf(Snapshot, "input_len");
        const input_offset = @offsetOf(Snapshot, "inputs");
        const size = @sizeOf(Ctx.InputCtx);

        std.mem.writeInt(u32, out[input_len_offset .. input_len_offset + 4], size, .little);
        @memcpy(out[input_offset .. input_offset + size], std.mem.asBytes(input_ctx));
    }

    pub fn write_events(self: *Snapshot, events_ptr: EnginePointer) void {
        const out: [*]u8 = @ptrCast(self);
        const events_buffer: *const EventBuffer = @ptrFromInt(events_ptr);
        const events_len = @offsetOf(Snapshot, "events_len");
        const events_offset = @offsetOf(Snapshot, "events");
        const size = @sizeOf(EventBuffer);

        std.mem.writeInt(u32, out[events_len .. events_len + 4], size, .little);
        @memcpy(out[events_offset .. events_offset + size], std.mem.asBytes(events_buffer));
    }

    pub fn write_net(self: *Snapshot, net_ptr: EnginePointer) void {
        const out: [*]u8 = @ptrCast(self);
        const net_ctx: *const Ctx.NetCtx = @ptrFromInt(net_ptr);
        const net_len_offset = @offsetOf(Snapshot, "net_len");
        const net_offset = @offsetOf(Snapshot, "net");
        const size = @sizeOf(Ctx.NetCtx);

        std.mem.writeInt(u32, out[net_len_offset .. net_len_offset + 4], size, .little);
        @memcpy(out[net_offset .. net_offset + size], std.mem.asBytes(net_ctx));
    }

    pub fn user_data(self: *Snapshot) []u8 {
        const base = @as([*]u8, @ptrCast(self));
        const user_data_offset = @sizeOf(Snapshot);
        return base[user_data_offset .. user_data_offset + self.user_data_len];
    }
};

pub const TapeHeader = extern struct {
    // magic numbers
    magic: u32 = 0x54415045, // "TAPE" in ASCII
    version: u16 = 1, // v1: packet support
    reserved: u16 = 0,

    // frame and event data
    start_frame: u32 = 0,
    frame_count: u16 = 0,
    event_count: u16 = 0,
    max_events: u32 = 0,

    // offsets for events
    snapshot_offset: u32 = @sizeOf(TapeHeader),
    user_data_offset: u32 = 0,
    event_start_offset: u32 = 0,
    event_end_offset: u32 = 0,

    // packet storage (v1)
    packet_start_offset: u32 = 0,
    packet_end_offset: u32 = 0,
    packet_count: u32 = 0,
    max_packet_bytes: u32 = 0,
};

/// A network packet recorded at a specific frame
/// Fixed-size header followed by variable-length data
pub const PacketRecord = packed struct {
    frame: u32,
    peer_id: u8,
    len: u16,
    _pad: u8 = 0,
    // data follows immediately after (variable length)

    pub const HEADER_SIZE: u32 = 8;

    comptime {
        if (@sizeOf(PacketRecord) != HEADER_SIZE) {
            @compileError("PacketRecord size mismatch");
        }
    }
};

pub const TapeError = error{
    InvalidTape,
    BadMagic,
    UnsupportedVersion,
    PacketBufferFull,
};

pub const Tape = struct {
    buf: []u8,

    /// Default packet buffer size (2mb for network sessions, override with 0 for local recordings if desired)
    pub const DEFAULT_MAX_PACKET_BYTES: u32 = 2 * 1024 * 1024;

    pub fn init(gpa: std.mem.Allocator, snapshot: *Snapshot, max_events: u32, max_packet_bytes: u32) !Tape {
        // Calculate aligned offsets and sizes
        const header_offset = 0;
        const header_size = @sizeOf(TapeHeader);

        const snapshot_offset = std.mem.alignForward(usize, header_size, @alignOf(Snapshot));
        const snapshot_size = @sizeOf(Snapshot);

        const user_data_offset = snapshot_offset + snapshot_size;
        const user_data_size = snapshot.user_data_len;

        const events_offset = std.mem.alignForward(usize, user_data_offset + user_data_size, @alignOf(Event));
        const events_size = @sizeOf(Event) * max_events;

        // Packet storage comes after events
        const packets_offset = std.mem.alignForward(usize, events_offset + events_size, 4);
        const packets_size = max_packet_bytes;

        var tape_buf = try gpa.alloc(u8, packets_offset + packets_size);

        // Write the tape header
        const header = TapeHeader{
            .event_count = 0,
            .max_events = max_events,
            .start_frame = snapshot.time.frame,
            .frame_count = 0,
            .snapshot_offset = @intCast(snapshot_offset),
            .user_data_offset = @intCast(user_data_offset),
            .event_start_offset = @intCast(events_offset),
            .event_end_offset = @intCast(events_offset),
            .packet_start_offset = @intCast(packets_offset),
            .packet_end_offset = @intCast(packets_offset),
            .packet_count = 0,
            .max_packet_bytes = max_packet_bytes,
        };
        @memcpy(tape_buf[header_offset..header_size], std.mem.asBytes(&header));

        // Write the snapshot
        @memcpy(tape_buf[snapshot_offset .. snapshot_offset + snapshot_size], std.mem.asBytes(snapshot));

        // Write snapshot user data if any
        if (user_data_size > 0) {
            const base = @as([*]u8, @ptrCast(snapshot));
            const user_data_src = base[@sizeOf(Snapshot) .. @sizeOf(Snapshot) + user_data_size];
            const user_data_dst = tape_buf[user_data_offset .. user_data_offset + user_data_size];
            @memcpy(user_data_dst, user_data_src);
        }

        return Tape{ .buf = tape_buf };
    }

    pub fn load(buf: []u8) TapeError!Tape {
        const header_slice = buf[0..@sizeOf(TapeHeader)];
        const header: *TapeHeader = @ptrCast(@alignCast(header_slice.ptr));
        if (header.magic != 0x54415045) {
            return TapeError.InvalidTape;
        }
        // Support v0 (no packets) and v1 (with packets)
        if (header.version > 1) {
            return TapeError.UnsupportedVersion;
        }
        // Upgrade v0 tapes to have empty packet section
        if (header.version == 0) {
            header.packet_start_offset = 0;
            header.packet_end_offset = 0;
            header.packet_count = 0;
            header.max_packet_bytes = 0;
        }
        return Tape{ .buf = buf };
    }

    pub fn get_buffer(self: *Tape) []u8 {
        return self.buf;
    }

    pub fn closest_snapshot(self: *Tape, frame: u32) *Snapshot {
        _ = frame;
        const header = self.get_header();
        const snapshot_offset = header.snapshot_offset;
        const snapshot_slice = self.buf[snapshot_offset .. snapshot_offset + @sizeOf(Snapshot)];
        const snapshot: *Snapshot = @ptrCast(@alignCast(snapshot_slice.ptr));
        return snapshot;
    }

    pub fn free(self: *Tape, gpa: std.mem.Allocator) void {
        gpa.free(self.buf);
    }

    pub fn event_count(self: *const Tape) u32 {
        const header = self.get_header();
        return header.event_count;
    }

    pub fn frame_count(self: *const Tape) u32 {
        const header = self.get_header();
        return header.start_frame + header.frame_count;
    }

    pub fn get_header(self: *const Tape) *TapeHeader {
        const header_slice = self.buf[0..@sizeOf(TapeHeader)];
        const header: *TapeHeader = @ptrCast(@alignCast(header_slice.ptr));
        return header;
    }

    pub fn append_event(self: *Tape, event: Event) !void {
        const header = self.get_header();
        if (header.event_count >= header.max_events) {
            return error.OutOfMemory;
        }
        const event_size = @sizeOf(Event);
        @memcpy(self.buf[header.event_end_offset .. header.event_end_offset + event_size], std.mem.asBytes(&event));
        header.event_end_offset += event_size;
        header.event_count += 1;
    }

    pub fn start_frame(self: *Tape) !void {
        const header = self.get_header();
        try self.append_event(Event.frameStart(self.frame_count()));
        header.frame_count += 1;
    }

    fn get_event(self: *const Tape, index: usize) *const Event {
        const header = self.get_header();
        const event_offset = header.event_start_offset + (@sizeOf(Event) * index);
        const event_slice = self.buf[event_offset .. event_offset + @sizeOf(Event)];
        const event: *const Event = @ptrCast(@alignCast(event_slice.ptr));
        return event;
    }

    pub fn get_events(self: *const Tape, requested_frame: u32) []const Event {
        const header = self.get_header();
        const total_events = header.event_count;

        var current_frame: u32 = 0;
        var frame_index: usize = 0;
        var frame_event_count: usize = 0;

        var i: usize = 0;
        while (i < total_events) : (i += 1) {
            const event = get_event(self, i);

            switch (event.kind) {
                .FrameStart => {
                    // If the current frame is the requested frame and we're advancing past it, break
                    // For frame 0, we need to guard against a false positive on the initial state of current_frame == 0
                    if (current_frame == requested_frame and event.payload.frame_number == current_frame + 1) {
                        break;
                    }

                    current_frame = event.payload.frame_number;
                    // frame events start after this event
                    frame_index = i + 1;
                    // reset event count for the frame
                    frame_event_count = 0;
                },
                else => {
                    frame_event_count += 1;
                },
            }
        }

        // We'll end on the requested frame
        // if the while loop breaks or if we've reached the end of the tape
        // in either case, return events for the frame if there are any
        if (current_frame == requested_frame and frame_event_count > 0) {
            const start_offset = header.event_start_offset + (@sizeOf(Event) * frame_index);
            const events_ptr: [*]const Event = @ptrCast(@alignCast(&self.buf[start_offset]));
            return events_ptr[0..frame_event_count];
        }

        return &[_]Event{};
    }

    /// Append a network packet to the tape
    /// Returns PacketBufferFull if there's not enough space
    pub fn append_packet(self: *Tape, frame: u32, peer_id: u8, data: []const u8) TapeError!void {
        const header = self.get_header();

        // Check if tape has packet storage
        if (header.max_packet_bytes == 0) {
            return TapeError.PacketBufferFull;
        }

        const record_size = PacketRecord.HEADER_SIZE + data.len;
        const max_end_offset = header.packet_start_offset + header.max_packet_bytes;
        const new_end_offset = header.packet_end_offset + record_size;

        if (new_end_offset > max_end_offset) {
            return TapeError.PacketBufferFull;
        }

        // Write the packet record header
        const record = PacketRecord{
            .frame = frame,
            .peer_id = peer_id,
            .len = @intCast(data.len),
        };
        const record_offset = header.packet_end_offset;
        @memcpy(self.buf[record_offset .. record_offset + PacketRecord.HEADER_SIZE], std.mem.asBytes(&record));

        // Write the packet data
        const data_offset = record_offset + PacketRecord.HEADER_SIZE;
        @memcpy(self.buf[data_offset .. data_offset + data.len], data);

        // Update header
        header.packet_end_offset = @intCast(new_end_offset);
        header.packet_count += 1;
    }

    /// Iterator for packets at a specific frame
    pub const PacketIterator = struct {
        tape: *const Tape,
        frame: u32,
        current_offset: u32,
        end_offset: u32,

        pub fn next(self: *PacketIterator) ?struct { peer_id: u8, data: []const u8 } {
            while (self.current_offset < self.end_offset) {
                // Read packet header fields directly (avoid alignment issues)
                const offset = self.current_offset;
                const frame_bytes = self.tape.buf[offset .. offset + 4];
                const record_frame = std.mem.readInt(u32, frame_bytes[0..4], .little);
                const peer_id = self.tape.buf[offset + 4];
                const len_bytes = self.tape.buf[offset + 5 .. offset + 7];
                const data_len: u32 = std.mem.readInt(u16, len_bytes[0..2], .little);

                const data_offset = offset + PacketRecord.HEADER_SIZE;
                const record_size = PacketRecord.HEADER_SIZE + data_len;

                // Move past this record for next iteration
                self.current_offset += record_size;

                // Return if frame matches
                if (record_frame == self.frame) {
                    return .{
                        .peer_id = peer_id,
                        .data = self.tape.buf[data_offset .. data_offset + data_len],
                    };
                }
            }
            return null;
        }
    };

    /// Get an iterator over packets recorded at a specific frame
    pub fn get_packets_for_frame(self: *const Tape, frame: u32) PacketIterator {
        const header = self.get_header();
        return PacketIterator{
            .tape = self,
            .frame = frame,
            .current_offset = header.packet_start_offset,
            .end_offset = header.packet_end_offset,
        };
    }

    /// Returns the number of packets recorded
    pub fn packet_count(self: *const Tape) u32 {
        return self.get_header().packet_count;
    }
};

test "snapshot headers with no user data" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer std.testing.allocator.destroy(snapshot);
    try std.testing.expectEqual(1, snapshot.version);
    try std.testing.expectEqual(@sizeOf(Ctx.TimeCtx), snapshot.time_len);
    try std.testing.expectEqual(@sizeOf(Ctx.InputCtx), snapshot.input_len);
    try std.testing.expectEqual(@sizeOf(EventBuffer), snapshot.events_len);
    try std.testing.expectEqual(@sizeOf(Snapshot), snapshot.engine_data_len);
    // engine payload should be less than 16kb (12 players + MAX_EVENTS events)
    try std.testing.expect(snapshot.engine_data_len < 16_384);
    try std.testing.expectEqual(0, snapshot.user_data_len);
}

test "snapshot engine data" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer snapshot.deinit(std.testing.allocator);

    const time_ctx = Ctx.TimeCtx{
        .dt_ms = 16,
        .frame = 42,
        .total_ms = 1_000,
    };
    const time_ptr = @intFromPtr(&time_ctx);
    snapshot.write_time(time_ptr);

    var input_ctx: Ctx.InputCtx = undefined;
    @memset(std.mem.asBytes(&input_ctx), 0);
    input_ctx.players[0].mouse_ctx.x = 100.0;
    input_ctx.players[0].mouse_ctx.y = 200.0;
    input_ctx.players[0].mouse_ctx.wheel_x = 3.0;
    input_ctx.players[0].mouse_ctx.wheel_y = -3.0;
    const input_ptr = @intFromPtr(&input_ctx);
    snapshot.write_inputs(input_ptr);

    const empty_event = Event{ .kind = .None, .device = .None, .payload = .{ .key = .None } };
    const events_buffer = EventBuffer{ .count = 2, .events = [_]Event{empty_event} ** MAX_EVENTS };
    const events_ptr = @intFromPtr(&events_buffer);
    snapshot.write_events(events_ptr);

    try std.testing.expectEqual(16, snapshot.time.dt_ms);
    try std.testing.expectEqual(42, snapshot.time.frame);
    try std.testing.expectEqual(1_000, snapshot.time.total_ms);
}

test "snapshot user data" {
    const user_data = [4]u8{ 0xDE, 0xAD, 0xBE, 0xEF };
    const user_data_len = user_data.len;
    const snapshot = try Snapshot.init(std.testing.allocator, user_data_len);
    defer snapshot.deinit(std.testing.allocator);

    const user_data_offset = @sizeOf(Snapshot);
    const base = @as([*]u8, @ptrCast(snapshot));
    const user_data_slice = base[user_data_offset .. user_data_offset + user_data_len];
    user_data_slice[0] = 0xDE;
    user_data_slice[1] = 0xAD;
    user_data_slice[2] = 0xBE;
    user_data_slice[3] = 0xEF;

    try std.testing.expectEqual(snapshot.user_data()[0], 0xDE);
    try std.testing.expectEqual(snapshot.user_data()[1], 0xAD);
    try std.testing.expectEqual(snapshot.user_data()[2], 0xBE);
    try std.testing.expectEqual(snapshot.user_data()[3], 0xEF);
}

test "tape can store user data" {
    const user_data = [4]u8{ 0xDE, 0xAD, 0xBE, 0xEF };
    const user_data_len = user_data.len;
    const snapshot = try Snapshot.init(std.testing.allocator, user_data_len);

    @memcpy(snapshot.user_data(), user_data[0..]);
    defer snapshot.deinit(std.testing.allocator);

    var tape = try Tape.init(std.testing.allocator, snapshot, 4, 0);
    defer tape.free(std.testing.allocator);

    const snap = tape.closest_snapshot(0);
    const tape_user_data = snap.user_data();
    try std.testing.expectEqual(tape_user_data[0], 0xDE);
    try std.testing.expectEqual(tape_user_data[1], 0xAD);
    try std.testing.expectEqual(tape_user_data[2], 0xBE);
    try std.testing.expectEqual(tape_user_data[3], 0xEF);
}

test "tape can index events by frame" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer snapshot.deinit(std.testing.allocator);

    var tape = try Tape.init(std.testing.allocator, snapshot, 5, 0);
    defer tape.free(std.testing.allocator);

    try tape.start_frame();
    try tape.append_event(Event.keyDown(.KeyA, Events.LOCAL_PEER, .LocalKeyboard));
    try tape.append_event(Event.mouseMove(150.0, 250.0, Events.LOCAL_PEER, .LocalMouse));

    try tape.start_frame();
    try tape.append_event(Event.keyUp(.KeyA, Events.LOCAL_PEER, .LocalKeyboard));

    try std.testing.expectEqual(5, tape.event_count());

    {
        const event = tape.get_event(0);
        try std.testing.expectEqual(.FrameStart, event.kind);
        try std.testing.expectEqual(0, event.payload.frame_number);
    }
    {
        const event = tape.get_event(1);
        try std.testing.expectEqual(.KeyDown, event.kind);
        try std.testing.expectEqual(.KeyA, event.payload.key);
    }
    {
        const event = tape.get_event(2);
        try std.testing.expectEqual(.MouseMove, event.kind);
        try std.testing.expectEqual(150.0, event.payload.mouse_move.x);
        try std.testing.expectEqual(250.0, event.payload.mouse_move.y);
    }
    {
        const event = tape.get_event(3);
        try std.testing.expectEqual(.FrameStart, event.kind);
        try std.testing.expectEqual(1, event.payload.frame_number);
    }
    {
        const event = tape.get_event(4);
        try std.testing.expectEqual(.KeyUp, event.kind);
        try std.testing.expectEqual(.KeyA, event.payload.key);
    }

    const events = tape.get_events(0);
    try std.testing.expectEqual(2, events.len);
    try std.testing.expectEqual(.KeyDown, events[0].kind);
    try std.testing.expectEqual(.KeyA, events[0].payload.key);
    try std.testing.expectEqual(.MouseMove, events[1].kind);
    try std.testing.expectEqual(150.0, events[1].payload.mouse_move.x);
    try std.testing.expectEqual(250.0, events[1].payload.mouse_move.y);

    const events_frame_1 = tape.get_events(1);
    try std.testing.expectEqual(1, events_frame_1.len);
    try std.testing.expectEqual(.KeyUp, events_frame_1[0].kind);
    try std.testing.expectEqual(.KeyA, events_frame_1[0].payload.key);
}

test "tape can index events by frame with unaligned user data" {
    const snapshot = try Snapshot.init(std.testing.allocator, 2);
    defer snapshot.deinit(std.testing.allocator);

    var tape = try Tape.init(std.testing.allocator, snapshot, 4, 0);
    defer tape.free(std.testing.allocator);

    try tape.start_frame();
    try tape.start_frame();
    const events = tape.get_events(1);

    try std.testing.expectEqual(0, events.len);
}

test "tape header is updated with event count" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer snapshot.deinit(std.testing.allocator);

    var tape = try Tape.init(std.testing.allocator, snapshot, 3, 0);
    defer tape.free(std.testing.allocator);

    try tape.append_event(Event.keyDown(.KeyA, Events.LOCAL_PEER, .LocalKeyboard));
    try tape.append_event(Event.keyUp(.KeyA, Events.LOCAL_PEER, .LocalKeyboard));

    const header_slice = tape.buf[0..@sizeOf(TapeHeader)];
    const header: *const TapeHeader = @ptrCast(@alignCast(header_slice.ptr));

    try std.testing.expectEqual(2, header.event_count);
}

test "tape can be serialized and deserialized" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer snapshot.deinit(std.testing.allocator);

    var tape = try Tape.init(std.testing.allocator, snapshot, 5, 0);
    defer tape.free(std.testing.allocator);

    try tape.start_frame();
    try tape.append_event(Event.keyDown(.KeyA, Events.LOCAL_PEER, .LocalKeyboard));
    try tape.append_event(Event.mouseMove(150.0, 250.0, Events.LOCAL_PEER, .LocalMouse));
    try tape.start_frame();
    try tape.append_event(Event.keyUp(.KeyA, Events.LOCAL_PEER, .LocalKeyboard));

    // Simulate serialization by copying the tape buffer
    const len = tape.buf.len;
    const ptr = tape.buf.ptr;
    const serialized_buf = try std.testing.allocator.alloc(u8, len);
    defer std.testing.allocator.free(serialized_buf);
    @memcpy(serialized_buf, ptr[0..len]);

    // Simulate deserialization by creating a new Tape from the serialized buffer
    var deserialized_tape = try Tape.load(serialized_buf);

    const header_a = tape.get_header();
    const header_b = deserialized_tape.get_header();
    try std.testing.expectEqual(header_a.event_count, header_b.event_count);
    try std.testing.expectEqual(header_a.frame_count, header_b.frame_count);
    try std.testing.expectEqual(header_a.max_events, header_b.max_events);
    try std.testing.expectEqual(header_a.event_start_offset, header_b.event_start_offset);
    try std.testing.expectEqual(header_a.event_end_offset, header_b.event_end_offset);

    const events = deserialized_tape.get_events(0);
    try std.testing.expectEqual(2, events.len);
    try std.testing.expectEqual(.KeyDown, events[0].kind);
    try std.testing.expectEqual(.KeyA, events[0].payload.key);
    try std.testing.expectEqual(.MouseMove, events[1].kind);
    try std.testing.expectEqual(150.0, events[1].payload.mouse_move.x);
    try std.testing.expectEqual(250.0, events[1].payload.mouse_move.y);

    const events_frame_1 = deserialized_tape.get_events(1);
    try std.testing.expectEqual(1, events_frame_1.len);
    try std.testing.expectEqual(.KeyUp, events_frame_1[0].kind);
    try std.testing.expectEqual(.KeyA, events_frame_1[0].payload.key);
}

test "append_packet stores data correctly" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer snapshot.deinit(std.testing.allocator);

    // Small packet buffer for testing
    var tape = try Tape.init(std.testing.allocator, snapshot, 4, 256);
    defer tape.free(std.testing.allocator);

    const packet_data = [_]u8{ 0x01, 0x02, 0x03, 0x04, 0x05 };
    try tape.append_packet(5, 1, &packet_data);

    try std.testing.expectEqual(1, tape.packet_count());

    // Verify header was updated
    const header = tape.get_header();
    try std.testing.expect(header.packet_end_offset > header.packet_start_offset);
}

test "get_packets_for_frame returns correct packets" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer snapshot.deinit(std.testing.allocator);

    var tape = try Tape.init(std.testing.allocator, snapshot, 4, 256);
    defer tape.free(std.testing.allocator);

    // Add packets for different frames
    const packet1 = [_]u8{ 0xAA, 0xBB };
    const packet2 = [_]u8{ 0xCC, 0xDD, 0xEE };
    const packet3 = [_]u8{0xFF};

    try tape.append_packet(3, 1, &packet1); // frame 3, peer 1
    try tape.append_packet(5, 2, &packet2); // frame 5, peer 2
    try tape.append_packet(3, 0, &packet3); // frame 3, peer 0

    try std.testing.expectEqual(3, tape.packet_count());

    // Get packets for frame 3
    var iter = tape.get_packets_for_frame(3);

    // First packet for frame 3
    const p1 = iter.next();
    try std.testing.expect(p1 != null);
    try std.testing.expectEqual(1, p1.?.peer_id);
    try std.testing.expectEqual(2, p1.?.data.len);
    try std.testing.expectEqual(0xAA, p1.?.data[0]);
    try std.testing.expectEqual(0xBB, p1.?.data[1]);

    // Second packet for frame 3
    const p2 = iter.next();
    try std.testing.expect(p2 != null);
    try std.testing.expectEqual(0, p2.?.peer_id);
    try std.testing.expectEqual(1, p2.?.data.len);
    try std.testing.expectEqual(0xFF, p2.?.data[0]);

    // No more packets for frame 3
    try std.testing.expectEqual(null, iter.next());

    // Get packets for frame 5
    var iter5 = tape.get_packets_for_frame(5);
    const p5 = iter5.next();
    try std.testing.expect(p5 != null);
    try std.testing.expectEqual(2, p5.?.peer_id);
    try std.testing.expectEqual(3, p5.?.data.len);
    try std.testing.expectEqual(0xCC, p5.?.data[0]);
    try std.testing.expectEqual(null, iter5.next());

    // Get packets for frame with no packets
    var iter0 = tape.get_packets_for_frame(0);
    try std.testing.expectEqual(null, iter0.next());
}

test "packet buffer overflow returns error" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer snapshot.deinit(std.testing.allocator);

    // Very small buffer: only room for one small packet
    var tape = try Tape.init(std.testing.allocator, snapshot, 4, 16);
    defer tape.free(std.testing.allocator);

    // First packet should fit (8 byte header + 4 byte data = 12 bytes)
    const small_packet = [_]u8{ 0x01, 0x02, 0x03, 0x04 };
    try tape.append_packet(0, 0, &small_packet);

    // Second packet should fail (not enough space)
    const err = tape.append_packet(1, 0, &small_packet);
    try std.testing.expectError(TapeError.PacketBufferFull, err);
}

test "tape with packets can be serialized and deserialized" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer snapshot.deinit(std.testing.allocator);

    var tape = try Tape.init(std.testing.allocator, snapshot, 4, 256);
    defer tape.free(std.testing.allocator);

    try tape.start_frame();
    const packet_data = [_]u8{ 0xDE, 0xAD, 0xBE, 0xEF };
    try tape.append_packet(0, 2, &packet_data);

    // Serialize
    const len = tape.buf.len;
    const serialized_buf = try std.testing.allocator.alloc(u8, len);
    defer std.testing.allocator.free(serialized_buf);
    @memcpy(serialized_buf, tape.buf);

    // Deserialize
    var deserialized_tape = try Tape.load(serialized_buf);

    // Check packet count matches
    try std.testing.expectEqual(1, deserialized_tape.packet_count());

    // Check packet data
    var iter = deserialized_tape.get_packets_for_frame(0);
    const p = iter.next();
    try std.testing.expect(p != null);
    try std.testing.expectEqual(2, p.?.peer_id);
    try std.testing.expectEqual(4, p.?.data.len);
    try std.testing.expectEqual(0xDE, p.?.data[0]);
    try std.testing.expectEqual(0xAD, p.?.data[1]);
    try std.testing.expectEqual(0xBE, p.?.data[2]);
    try std.testing.expectEqual(0xEF, p.?.data[3]);
}

test "multiple packets per frame are all stored and retrieved" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer snapshot.deinit(std.testing.allocator);

    var tape = try Tape.init(std.testing.allocator, snapshot, 4, 256);
    defer tape.free(std.testing.allocator);

    // Add 3 packets for the same frame
    try tape.append_packet(7, 0, &[_]u8{0x11});
    try tape.append_packet(7, 1, &[_]u8{0x22});
    try tape.append_packet(7, 2, &[_]u8{0x33});

    try std.testing.expectEqual(3, tape.packet_count());

    // Iterate and count
    var iter = tape.get_packets_for_frame(7);
    var count: u32 = 0;
    while (iter.next()) |_| {
        count += 1;
    }
    try std.testing.expectEqual(3, count);
}
