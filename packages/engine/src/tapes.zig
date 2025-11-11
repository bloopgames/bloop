const std = @import("std");
const builtin = @import("builtin");
const Ctx = @import("context.zig");
const Event = @import("events.zig").Event;
const EventBuffer = @import("events.zig").EventBuffer;

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
    // user_data: [*]u8,

    fn write_time(self: *Snapshot, time_ptr: EnginePointer) void {
        const out: [*]u8 = @ptrCast(self);
        const time_ctx: *const Ctx.TimeCtx = @ptrFromInt(time_ptr);
        const time_len_offset = @offsetOf(Snapshot, "time_len");
        const time_offset = @offsetOf(Snapshot, "time");
        const size = @sizeOf(Ctx.TimeCtx);

        std.mem.writeInt(u32, out[time_len_offset .. time_len_offset + 4], size, .little);
        @memcpy(out[time_offset .. time_offset + size], std.mem.asBytes(time_ctx));
    }

    fn write_inputs(self: *Snapshot, input_ptr: EnginePointer) void {
        const out: [*]u8 = @ptrCast(self);
        const input_ctx: *const Ctx.InputCtx = @ptrFromInt(input_ptr);
        const input_len_offset = @offsetOf(Snapshot, "input_len");
        const input_offset = @offsetOf(Snapshot, "inputs");
        const size = @sizeOf(Ctx.InputCtx);

        std.mem.writeInt(u32, out[input_len_offset .. input_len_offset + 4], size, .little);
        @memcpy(out[input_offset .. input_offset + size], std.mem.asBytes(input_ctx));
    }

    fn write_events(self: *Snapshot, events_ptr: EnginePointer) void {
        const out: [*]u8 = @ptrCast(self);
        const events_buffer: *const EventBuffer = @ptrFromInt(events_ptr);
        const events_len = @offsetOf(Snapshot, "events_len");
        const events_offset = @offsetOf(Snapshot, "events");
        const size = @sizeOf(EventBuffer);

        std.mem.writeInt(u32, out[events_len .. events_len + 4], size, .little);
        @memcpy(out[events_offset .. events_offset + size], std.mem.asBytes(events_buffer));
    }

    fn reserve_user_data(self: *Snapshot, size: u32) EnginePointer {
        const out: [*]u8 = @ptrFromInt(self);
        const user_data_len = @offsetOf(Snapshot, "user_data_len");
        // const user_data_offset = @offsetOf(Snapshot, "user_data");
        @memcpy(
            out[user_data_len .. user_data_len + 4],
            std.mem.asBytes(&size),
        );
        return 0;
        // return @intFromPtr(out[user_data_offset]);
    }
};

pub const Tape = extern struct { snapshot: *Snapshot, events: [*]Event };

pub fn start_snapshot(
    alloc: std.mem.Allocator,
    user_data_len: u32,
) !*Snapshot {
    const snapshot = try alloc.create(Snapshot);
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

    // try std.testing.expectEqual(16, snapshot.time.dt_ms);
    // try std.testing.expectEqual(42, snapshot.time.frame);
    // try std.testing.expectEqual(1_000, snapshot.time.total_ms);
}

// test "snapshot headers with user data" {
//     const snapshot = try start_snapshot(std.testing.allocator, 16);
//     defer std.testing.allocator.destroy(snapshot);
//     @panic("fail");
//     // const user_data_ptr = snapshot.reserve_user_data(16);
//     // try std.testing.expectEqual(16, snapshot.user_data_len);
//     // try std.testing.expectEqual(snapshot, @sizeOf(Snapshot) + 16);
//     // const user_data: [*]u8 = @ptrFromInt(user_data_ptr);
//     // try std.testing.expectEqual(16, @memFromPtr(user_data).len);
//     // try std.testing.expectEqual(16, @memFromPtr(user_data_ptr).len);
// }
