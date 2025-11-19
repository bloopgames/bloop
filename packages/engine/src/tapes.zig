const std = @import("std");
const builtin = @import("builtin");
const Ctx = @import("context.zig");
const Event = @import("events.zig").Event;
const EventBuffer = @import("events.zig").EventBuffer;
const log = @import("log.zig").log;

const EnginePointer = if (builtin.target.cpu.arch.isWasm()) u32 else usize;

pub const Snapshot = extern struct {
    version: u32,
    user_data_len: u32,
    engine_data_len: u32,
    snapshot_len: u32,
    time_len: u32,
    input_len: u32,
    events_len: u32,
    reserved_2: u32,
    time: Ctx.TimeCtx,
    inputs: Ctx.InputCtx,
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
        snapshot.*.user_data_len = user_data_len;
        snapshot.*.engine_data_len = @sizeOf(Snapshot);

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

    pub fn user_data(self: *Snapshot) []u8 {
        const base = @as([*]u8, @ptrCast(self));
        const user_data_offset = @sizeOf(Snapshot);
        return base[user_data_offset .. user_data_offset + self.user_data_len];
    }
};

pub const TapeHeader = extern struct {
    magic: u32 = 0x54415045, // "TAPE" in ASCII
    reserved: u16 = 0,
    event_count: u16 = 0,
};

pub const Tape = struct {
    buf: []u8,
    /// Current offset to append new events
    offset: usize,
    frame_number: u32,
    max_events: u32,
    /// Offset where events start - dependent on the size of the user data
    events_offset: u32,

    pub fn init(gpa: std.mem.Allocator, snapshot: *Snapshot, max_events: u32) !Tape {
        // Calculate aligned offset for events to ensure proper Event alignment
        const header_and_snapshot_size = @sizeOf(TapeHeader) + @sizeOf(Snapshot) + snapshot.user_data_len;
        const event_alignment = @alignOf(Event);
        const events_offset = std.mem.alignForward(usize, header_and_snapshot_size, event_alignment);
        const total_size = events_offset + (@sizeOf(Event) * max_events);

        var tape_buf = try gpa.alloc(u8, total_size);
        var offset: u32 = 0;

        // Write the tape header
        const header = TapeHeader{};
        @memcpy(tape_buf[0..@sizeOf(TapeHeader)], std.mem.asBytes(&header));
        offset += @sizeOf(TapeHeader);

        // Write the snapshot
        const user_data_len = snapshot.user_data_len;
        @memcpy(tape_buf[offset .. offset + @sizeOf(Snapshot)], std.mem.asBytes(snapshot));
        offset += @sizeOf(Snapshot);

        // Write snapshot user data if any
        if (user_data_len > 0) {
            const base = @as([*]u8, @ptrCast(snapshot));
            const user_data_src = base[@sizeOf(Snapshot) .. @sizeOf(Snapshot) + user_data_len];
            const user_data_dst = tape_buf[offset .. offset + user_data_len];
            @memcpy(user_data_dst, user_data_src);
            offset += user_data_len;
        }

        // Add padding to align events
        offset += @intCast(events_offset - header_and_snapshot_size);

        return Tape{ .buf = tape_buf, .offset = offset, .frame_number = snapshot.time.frame, .max_events = max_events, .events_offset = @intCast(events_offset) };
    }

    pub fn closest_snapshot(self: *Tape, frame: u32) *Snapshot {
        _ = frame;
        const snapshot_offset = @sizeOf(TapeHeader);
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

    pub fn get_header(self: *const Tape) *TapeHeader {
        const header_slice = self.buf[0..@sizeOf(TapeHeader)];
        const header: *TapeHeader = @ptrCast(@alignCast(header_slice.ptr));
        return header;
    }

    pub fn append_event(self: *Tape, event: Event) !void {
        const header = self.get_header();
        if (header.event_count >= self.max_events) {
            return error.OutOfMemory;
        }
        const event_size = @sizeOf(Event);
        @memcpy(self.buf[self.offset .. self.offset + event_size], std.mem.asBytes(&event));
        self.offset += event_size;
        header.event_count += 1;
    }

    pub fn advance_frame(self: *Tape) !void {
        self.frame_number += 1;
        try self.append_event(Event.frameAdvance(self.frame_number));
    }

    fn get_event(self: *const Tape, index: usize) *const Event {
        const event_offset = self.events_offset + (@sizeOf(Event) * index);
        const event_slice = self.buf[event_offset .. event_offset + @sizeOf(Event)];
        const event: *const Event = @ptrCast(@alignCast(event_slice.ptr));
        return event;
    }

    pub fn get_events(self: *const Tape, frame: u32) []const Event {
        var current_frame: u32 = 0;
        var i: usize = 0;
        var frame_index: usize = 0;
        var frame_event_count: usize = 0;

        while (i < self.event_count()) : (i += 1) {
            const event = get_event(self, i);
            if (event.kind == .FrameAdvance) {
                if (frame == current_frame) {
                    // Found the end of the requested frame, return the events slice
                    const start_offset = self.events_offset + (@sizeOf(Event) * frame_index);
                    const events_ptr: [*]const Event = @ptrCast(@alignCast(&self.buf[start_offset]));
                    return events_ptr[0..frame_event_count];
                }

                // Set frame_index to the index of the event after FrameAdvance
                frame_index = i + 1;
                // Update current frame
                current_frame += 1;
                // Reset event count for the new frame
                frame_event_count = 0;
            } else {
                frame_event_count += 1;
            }
        }

        // If the last frame in the tape is the requested frame, return a slice of the frame index to the total event count
        if (current_frame == frame) {
            const start_offset = self.events_offset + (@sizeOf(Event) * frame_index);
            const events_count = self.event_count() - frame_index;
            if (events_count == 0) {
                return &[_]Event{};
            }
            const events_ptr: [*]const Event = @ptrCast(@alignCast(&self.buf[start_offset]));
            return events_ptr[0..events_count];
        }

        return &[_]Event{};
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
    // engine payload should be less than 4kb (we can optimize later)
    try std.testing.expect(snapshot.engine_data_len < 4_096);
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

    const input_ctx = Ctx.InputCtx{
        .key_ctx = Ctx.KeyCtx{
            .key_states = [_]u8{0} ** 256,
        },
        .mouse_ctx = Ctx.MouseCtx{
            .x = 100.0,
            .y = 200.0,
            .button_states = [_]u8{0} ** 8,
            .wheel_x = 3.0,
            .wheel_y = -3.0,
        },
    };
    const input_ptr = @intFromPtr(&input_ctx);
    snapshot.write_inputs(input_ptr);

    const empty_event = Event{ .kind = .None, .payload = .{ .key = .None } };
    const events_buffer = EventBuffer{ .count = 2, .events = [_]Event{empty_event} ** 128 };
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

    var tape = try Tape.init(std.testing.allocator, snapshot, 4);
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

    var tape = try Tape.init(std.testing.allocator, snapshot, 5);
    defer tape.free(std.testing.allocator);

    try tape.append_event(Event.keyDown(.KeyA));
    try tape.append_event(Event.mouseMove(150.0, 250.0));
    try tape.advance_frame();
    try tape.append_event(Event.keyUp(.KeyA));
    try tape.advance_frame();

    try std.testing.expectEqual(5, tape.event_count());

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

    var tape = try Tape.init(std.testing.allocator, snapshot, 4);
    defer tape.free(std.testing.allocator);

    try tape.advance_frame();
    try tape.advance_frame();
    const events = tape.get_events(1);

    try std.testing.expectEqual(0, events.len);
}

test "tape header is updated with event count" {
    const snapshot = try Snapshot.init(std.testing.allocator, 0);
    defer snapshot.deinit(std.testing.allocator);

    var tape = try Tape.init(std.testing.allocator, snapshot, 3);
    defer tape.free(std.testing.allocator);

    try tape.append_event(Event.keyDown(.KeyA));
    try tape.append_event(Event.keyUp(.KeyA));

    const header_slice = tape.buf[0..@sizeOf(TapeHeader)];
    const header: *const TapeHeader = @ptrCast(@alignCast(header_slice.ptr));

    try std.testing.expectEqual(2, header.event_count);
}
