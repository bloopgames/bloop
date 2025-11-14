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
    reserved_1: u32,
    time_len: u32,
    input_len: u32,
    events_len: u32,
    reserved_2: u32,
    time: Ctx.TimeCtx,
    inputs: Ctx.InputCtx,
    events: EventBuffer,

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
};

pub const TapeHeader = extern struct {
    magic: u32 = 0x54415045, // "TAPE" in ASCII
    reserved: u16 = 0,
    event_count: u16 = 0,
};

pub const Tape = struct {
    buf: []u8,
    offset: usize,
    frame_number: u32,
    max_events: u32,
    event_count: u32 = 0,

    pub fn init(gpa: std.mem.Allocator, snapshot: *Snapshot, max_events: u32) !Tape {
        const total_size = @sizeOf(TapeHeader) + @sizeOf(Snapshot) + snapshot.user_data_len + (@sizeOf(Event) * max_events);
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
            log("Not recording user data", .{});

            // const user_data_src = @intFromPtr(&snapshot) + @sizeOf(Snapshot);
            // const user_data_dst = tape_buf[offset .. offset + user_data_len];
            // @memcpy(user_data_dst, user_data_src);
            // offset += user_data_len;
        }

        return Tape{ .buf = tape_buf, .offset = offset, .frame_number = snapshot.time.frame, .max_events = max_events };
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

    pub fn append_event(self: *Tape, event: Event) !void {
        if (self.event_count >= self.max_events) {
            return error.OutOfMemory;
        }
        const event_size = @sizeOf(Event);
        @memcpy(self.buf[self.offset .. self.offset + event_size], std.mem.asBytes(&event));
        self.offset += event_size;
        self.event_count += 1;
    }

    pub fn advance_frame(self: *Tape) !void {
        self.frame_number += 1;
        try self.append_event(Event.frameAdvance(self.frame_number));
    }

    pub fn get_events(self: *const Tape, frame: u32) []const Event {
        const header_size = @sizeOf(TapeHeader);
        const snapshot_size = @sizeOf(Snapshot);
        const snapshot: *const Snapshot = @ptrCast(@alignCast(self.buf[header_size .. header_size + snapshot_size]));
        const user_data_len = snapshot.user_data_len;
        const events_start = header_size + snapshot_size + user_data_len;

        var current_frame: u32 = 0;
        var frame_start_idx: usize = 0;
        var i: usize = 0;

        while (i < self.event_count) : (i += 1) {
            const event_offset = events_start + (i * @sizeOf(Event));
            const event: *const Event = @ptrCast(@alignCast(self.buf[event_offset .. event_offset + @sizeOf(Event)]));

            if (event.kind == .FrameAdvance) {
                if (current_frame == frame) {
                    // Found the end of the requested frame
                    const count = i - frame_start_idx;
                    const start_offset = events_start + (frame_start_idx * @sizeOf(Event));
                    const events_slice: []const Event = @as([*]const Event, @ptrCast(@alignCast(&self.buf[start_offset])))[0..count];
                    return events_slice;
                }
                current_frame += 1;
                frame_start_idx = i + 1;
            }
        }

        // If we're looking for the current frame and haven't found a FrameAdvance yet
        if (current_frame == frame) {
            const count = i - frame_start_idx;
            const start_offset = events_start + (frame_start_idx * @sizeOf(Event));
            const events_slice: []const Event = @as([*]const Event, @ptrCast(@alignCast(&self.buf[start_offset])))[0..count];
            return events_slice;
        }

        return &[_]Event{};
    }
};

pub fn start_snapshot(
    alloc: std.mem.Allocator,
    user_data_len: u32,
) !*Snapshot {
    const alignment = comptime std.mem.Alignment.fromByteUnits(@alignOf(Snapshot));
    const bytes = try alloc.alignedAlloc(u8, alignment, @sizeOf(Snapshot) + @as(usize, user_data_len));
    const snapshot: *Snapshot = std.mem.bytesAsValue(Snapshot, bytes[0..@sizeOf(Snapshot)]);
    snapshot.*.version = 1;
    snapshot.*.time_len = @sizeOf(Ctx.TimeCtx);
    snapshot.*.input_len = @sizeOf(Ctx.InputCtx);
    snapshot.*.events_len = @sizeOf(EventBuffer);
    snapshot.*.user_data_len = user_data_len;
    snapshot.*.engine_data_len = snapshot.*.time_len +
        snapshot.*.input_len +
        snapshot.*.events_len;
    return snapshot;
}

test "snapshot headers with no user data" {
    const snapshot = try start_snapshot(std.testing.allocator, 0);
    defer std.testing.allocator.destroy(snapshot);
    try std.testing.expectEqual(1, snapshot.version);
    try std.testing.expectEqual(@sizeOf(Ctx.TimeCtx), snapshot.time_len);
    try std.testing.expectEqual(@sizeOf(Ctx.InputCtx), snapshot.input_len);
    try std.testing.expectEqual(@sizeOf(EventBuffer), snapshot.events_len);
    try std.testing.expectEqual(@sizeOf(Ctx.TimeCtx) + @sizeOf(Ctx.InputCtx) + @sizeOf(EventBuffer), snapshot.engine_data_len);
    // engine payload should be less than 4kb (we can optimize later)
    try std.testing.expect(snapshot.engine_data_len < 4_096);
    try std.testing.expectEqual(0, snapshot.user_data_len);
}

test "snapshot engine data" {
    const snapshot = try start_snapshot(std.testing.allocator, 0);
    defer std.testing.allocator.destroy(snapshot);

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

test "tape can replay events" {
    const snapshot = try start_snapshot(std.testing.allocator, 0);
    defer std.testing.allocator.destroy(snapshot);

    var tape = try Tape.init(std.testing.allocator, snapshot, 4);
    defer tape.free(std.testing.allocator);

    try tape.append_event(Event.keyDown(.KeyA));
    try tape.append_event(Event.mouseMove(150.0, 250.0));
    try tape.advance_frame();
    try tape.append_event(Event.keyUp(.KeyA));

    try std.testing.expectEqual(4, tape.event_count);

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
