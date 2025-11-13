const std = @import("std");
const util = @import("util.zig");
const Ctx = @import("context.zig");
const Events = @import("events.zig");
const Tapes = @import("tapes.zig");

// Imported from JS. Calls console.log
extern "env" fn console_log(ptr: [*]const u8, len: usize) void;

// Imported from JS. Calls the JS function by handle
extern "env" fn __cb(fn_handle: u32, ptr: u32, dt: u32) void;

const wasmPointer = u32;
const cb_handle = u32;
const hz = 1000 / 60;

const TimeCtx = Ctx.TimeCtx;
const InputCtx = Ctx.InputCtx;

const Event = Events.Event;
const EventBuffer = Events.EventBuffer;

var wasm_alloc = std.heap.wasm_allocator;
var arena_alloc: ?std.heap.ArenaAllocator = null;
var accumulator: u32 = 0;

var cb_ptr: wasmPointer = 0;
var time_ctx_ptr: wasmPointer = 0;
var input_ctx_ptr: wasmPointer = 0;
var events_ptr: wasmPointer = 0;

var global_cb_handle: cb_handle = 0;
var global_snapshot_handle: cb_handle = 0;
var global_restore_handle: cb_handle = 0;

pub fn panic(msg: []const u8, stack_trace: ?*std.builtin.StackTrace, ret_addr: ?usize) noreturn {
    _ = ret_addr;

    const bytes = std.fmt.allocPrint(arena(), "{s}", .{msg}) catch {
        @trap();
    };
    log_fmt("Panictastic: {s}\n", .{bytes}) catch {
        @trap();
    };

    _ = stack_trace;
    // if (stack_trace) |trace| {
    //     const buf = arena().alloc(u8, 1024) catch {
    //         log("Panic: failed to allocate stack trace buffer");
    //         @trap();
    //     };

    //     const src = @src();
    //     log(" at {s}:{d}\n", .{ src.file, src.line }) catch {
    //         @trap();
    //     };
    //     var writer: std.Io.Writer = .fixed(buf);
    //     const tty_config = std.Io.tty.Config.no_color;
    //     // this line causes the errors
    //     std.debug.writeStackTrace(trace, &writer, tty_config);
    //     writer.flush() catch {
    //         log("Panic: failed to flush stack trace buffer");
    //         @trap();
    //     };
    //     log(buf[0..writer.end]);
    // }

    @trap();
}

pub export fn initialize() void {
    // Validate Event struct layout for js-side assumptions
    std.debug.assert(@sizeOf(Events.EventPayload) == 8);
    std.debug.assert(@alignOf(Events.EventPayload) == 4);

    // Allocate the time context and 0 it out
    time_ctx_ptr = alloc(@sizeOf(TimeCtx));
    const ctx: *TimeCtx = @ptrFromInt(time_ctx_ptr);
    ctx.*.dt_ms = 0;
    ctx.*.frame = 0;
    ctx.*.total_ms = 0;

    // Allocate the input context and 0 it out
    input_ctx_ptr = alloc(@sizeOf(InputCtx));
    var input_data: [*]u8 = @ptrFromInt(input_ctx_ptr);
    @memset(input_data[0..@sizeOf(InputCtx)], 0);

    // Allocate the events buffer and 0 it out
    events_ptr = alloc(@sizeOf(EventBuffer));
    var events_data: [*]u8 = @ptrFromInt(events_ptr);
    @memset(events_data[0..@sizeOf(EventBuffer)], 0);

    // the callback pointer injects:
    // 0 - pointer to time context
    // 1 - pointer to input context
    // 2 - pointer to events buffer
    cb_ptr = alloc(@sizeOf(u32) * 3);
    const cb_data: [*]u32 = @ptrFromInt(cb_ptr);
    cb_data[0] = time_ctx_ptr;
    cb_data[1] = input_ctx_ptr;
    cb_data[2] = events_ptr;
}

pub export fn alloc(size: usize) wasmPointer {
    const slice = wasm_alloc.alloc(u8, size) catch return 0;
    return @intFromPtr(slice.ptr);
}

pub export fn free(ptr: wasmPointer, size: usize) void {
    const slice: [*]u8 = @ptrFromInt(ptr);
    wasm_alloc.free(slice[0..size]);
}

pub export fn snapshot(user_data_len: u32) wasmPointer {
    const snap = Tapes.start_snapshot(wasm_alloc, user_data_len) catch |e| {
        switch (e) {
            error.OutOfMemory => log("Snapshot allocation failed: Out of memory"),
        }
        return 0;
    };

    snap.write_time(time_ctx_ptr);
    snap.write_inputs(input_ctx_ptr);
    snap.write_events(events_ptr);
    return @intFromPtr(snap);
}

pub export fn snapshot_user_data_offset() u32 {
    return @sizeOf(Tapes.Snapshot);
}

pub export fn restore(snapshot_ptr: wasmPointer) void {
    const snap: *Tapes.Snapshot = @ptrFromInt(snapshot_ptr);

    const time_ctx: *TimeCtx = @ptrFromInt(time_ctx_ptr);
    @memcpy(std.mem.asBytes(time_ctx), std.mem.asBytes(&snap.time));

    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
    @memcpy(std.mem.asBytes(input_ctx), std.mem.asBytes(&snap.inputs));

    const events: *EventBuffer = @ptrFromInt(events_ptr);
    @memcpy(std.mem.asBytes(events), std.mem.asBytes(&snap.events));
}

pub export fn register_systems(handle: cb_handle) void {
    global_cb_handle = handle;
}

pub export fn step(ms: u32) void {
    defer {
        if (arena_alloc != null) {
            _ = arena_alloc.?.reset(.retain_capacity);
        }
    }
    accumulator += ms;

    const time: *TimeCtx = @ptrFromInt(time_ctx_ptr);

    while (accumulator >= hz) {
        time.*.dt_ms = hz;
        time.*.total_ms += hz;
        __cb(global_cb_handle, cb_ptr, hz);
        time.*.frame += 1;
        accumulator -= hz;
        flush_events();
    }

    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
    for (&input_ctx.*.key_ctx.key_states) |*key_state| {
        // Shift left by 1 to age the state, keep the current value
        const is_held = key_state.* & 1;
        key_state.* = key_state.* << 1;
        key_state.* |= is_held;
    }
    for (&input_ctx.*.mouse_ctx.button_states) |*button_state| {
        const is_held = button_state.* & 1;
        button_state.* = button_state.* << 1;
        button_state.* |= is_held;
    }
    accumulator = @max(accumulator, 0);
}

pub export fn emit_keydown(key_code: Events.Key) void {
    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
    input_ctx.*.key_ctx.key_states[@intFromEnum(key_code)] |= 1;

    append_event(Event.keyDown(key_code));
}

pub export fn emit_keyup(key_code: Events.Key) void {
    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
    input_ctx.*.key_ctx.key_states[@intFromEnum(key_code)] &= 0b11111110;

    append_event(Event.keyUp(key_code));
}

pub export fn emit_mousedown(button: Events.MouseButton) void {
    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
    input_ctx.*.mouse_ctx.button_states[@intFromEnum(button)] |= 1;

    append_event(Event.mouseDown(button));
}

pub export fn emit_mouseup(button: Events.MouseButton) void {
    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
    input_ctx.*.mouse_ctx.button_states[@intFromEnum(button)] &= 0b11111110;

    append_event(Event.mouseUp(button));
}

pub export fn emit_mousemove(x: f32, y: f32) void {
    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
    input_ctx.*.mouse_ctx.x = x;
    input_ctx.*.mouse_ctx.y = y;

    append_event(Event.mouseMove(x, y));
}

pub export fn emit_mousewheel(delta_x: f32, delta_y: f32) void {
    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
    input_ctx.*.mouse_ctx.wheel_x += delta_x;
    input_ctx.*.mouse_ctx.wheel_y += delta_y;

    append_event(Event.mouseWheel(delta_x, delta_y));
}

pub export fn get_time_ctx() wasmPointer {
    return time_ctx_ptr;
}

fn append_event(event: Event) void {
    const events: *EventBuffer = @ptrFromInt(events_ptr);
    const idx = events.*.count;
    if (idx < 256) {
        events.*.count += 1;
        events.*.events[idx] = event;
    } else {
        @panic("Event buffer full");
    }
}

fn flush_events() void {
    const events: *EventBuffer = @ptrFromInt(events_ptr);
    events.*.count = 0;
}

/// Logs a message to the console
/// @param msg The message to log
/// to log an allocated message, use the arena allocator, e.g.
fn log_fmt(comptime fmt: []const u8, args: anytype) !void {
    const msg = try std.fmt.allocPrint(arena(), fmt, args);
    log(msg);
}

fn log(msg: []const u8) void {
    console_log(msg.ptr, msg.len);
}

fn arena() std.mem.Allocator {
    if (arena_alloc == null) {
        arena_alloc = std.heap.ArenaAllocator.init(wasm_alloc);
    }
    return arena_alloc.?.allocator();
}
