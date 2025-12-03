const std = @import("std");
const util = @import("util.zig");
const Ctx = @import("context.zig");
const Events = @import("events.zig");
const Tapes = @import("tapes.zig");
const Log = @import("log.zig");
const log = Log.log;

/// Log a message to the js console
/// @param ptr Pointer to the message string
/// @param len Length of the message string
extern "env" fn console_log(ptr: [*]const u8, len: usize) void;

/// Callback into JS to run registered systems
/// @param fn_handle The function handle to call
/// @param ptr Pointer to engine context and events data
extern "env" fn __cb(fn_handle: u32, ptr: u32, dt: u32) void;

/// Writes user data from js to the given snapshot pointer
/// @param ptr Pointer to the user data
/// @param len Expected length of the user data
extern "env" fn user_data_serialize(ptr: wasmPointer, len: u32) void;

/// Reads user data into js from the given snapshot pointer
/// @param ptr Pointer to the user data
/// @param len Length of the user data
extern "env" fn user_data_deserialize(ptr: wasmPointer, len: u32) void;

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

var tape: ?Tapes.Tape = null;

const Vcr = struct {
    is_recording: bool,
    is_replaying: bool,
};
var vcr: Vcr = .{
    .is_recording = false,
    .is_replaying = false,
};

pub fn panic(msg: []const u8, stack_trace: ?*std.builtin.StackTrace, ret_addr: ?usize) noreturn {
    _ = ret_addr;

    wasm_log(std.fmt.allocPrint(arena(), "{s}", .{msg}) catch {
        @trap();
    });

    _ = stack_trace;
    // https://github.com/ziglang/zig/issues/24285
    // https://github.com/ziglang/zig/issues/25856
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

pub export fn initialize() wasmPointer {
    Log.init(arena(), wasm_log);

    // Validate Event struct layout for js-side assumptions
    // See EVENT_PAYLOAD_SIZE and EVENT_PAYLOAD_ALIGN in inputs.ts
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

    return cb_ptr;
}

pub export fn alloc(size: usize) wasmPointer {
    const slice = wasm_alloc.alloc(u8, size) catch {
        wasm_log("Failed to allocate memory from engine");
        return 0;
    };

    const ptr = @intFromPtr(slice.ptr);
    if (size == 0) {
        @panic("Tried to allocate 0 bytes");
    }
    return ptr;
}

pub export fn free(ptr: wasmPointer, size: usize) void {
    const slice: [*]u8 = @ptrFromInt(ptr);
    wasm_alloc.free(slice[0..size]);
}

pub export fn start_recording(user_data_len: u32, max_events: u32) u8 {
    if (vcr.is_recording) {
        wasm_log("Already recording");
        return 2;
    }
    const snapshot: *Tapes.Snapshot = @ptrFromInt(take_snapshot(user_data_len));
    tape = Tapes.Tape.init(wasm_alloc, snapshot, max_events) catch {
        wasm_log("Failed to start recording: Out of memory");
        return 1;
    };
    vcr.is_recording = true;

    if (snapshot.time.frame != 0) {
        wasm_log("Untested: started recording from non-zero frame");
    }

    tape.?.start_frame() catch {
        wasm_log("Failed to start first tape frame");
        return 1;
    };
    return 0;
}

pub export fn stop_recording() u8 {
    if (!vcr.is_recording) {
        wasm_log("Not currently recording");
        return 2;
    }
    vcr.is_recording = false;
    return 0;
}

pub export fn is_recording() bool {
    return vcr.is_recording;
}

pub export fn is_replaying() bool {
    return vcr.is_replaying;
}

pub export fn get_tape_ptr() wasmPointer {
    if (tape == null) {
        wasm_log("No active tape");
        return 0;
    }
    const buf = tape.?.get_buffer();
    return @intFromPtr(buf.ptr);
}

pub export fn get_tape_len() u32 {
    if (tape == null) {
        wasm_log("No active tape");
        return 0;
    }
    const buf = tape.?.get_buffer();
    return @intCast(buf.len);
}

pub export fn load_tape(tape_ptr: wasmPointer, tape_len: u32) u8 {
    if (vcr.is_recording) {
        wasm_log("Cannot load tape while recording");
        return 2;
    }
    const tape_buf: [*]u8 = @ptrFromInt(tape_ptr);
    const tape_slice = tape_buf[0..tape_len];

    const copy: []u8 = wasm_alloc.alloc(u8, tape_len) catch {
        wasm_log("Failed to allocate memory for tape load");
        return 1;
    };
    @memcpy(copy[0..tape_len], tape_slice);
    tape = Tapes.Tape.load(copy) catch |e| {
        switch (e) {
            Tapes.TapeError.BadMagic => wasm_log("Failed to load tape: Bad magic number"),
            Tapes.TapeError.InvalidTape => wasm_log("Failed to load tape: Invalid tape format"),
            Tapes.TapeError.UnsupportedVersion => wasm_log("Failed to load tape: Unsupported tape version"),
        }
        return 1;
    };
    vcr.is_replaying = true;
    return 0;
}

pub export fn deinit() void {
    if (tape != null) {
        tape.?.free(wasm_alloc);
        tape = null;
    }
    if (arena_alloc != null) {
        arena_alloc.?.deinit();
        arena_alloc = null;
    }
}

pub export fn take_snapshot(user_data_len: u32) wasmPointer {
    const snap = Tapes.Snapshot.init(wasm_alloc, user_data_len) catch |e| {
        switch (e) {
            error.OutOfMemory => wasm_log("Snapshot allocation failed: Out of memory"),
        }
        return 0;
    };

    snap.write_time(time_ctx_ptr);
    snap.write_inputs(input_ctx_ptr);
    snap.write_events(events_ptr);

    if (snap.user_data_len > 0) {
        user_data_serialize(
            @intFromPtr(snap.user_data().ptr),
            snap.user_data_len,
        );
    }
    return @intFromPtr(snap);
}

pub export fn restore(snapshot_ptr: wasmPointer) void {
    const snap: *Tapes.Snapshot = @ptrFromInt(snapshot_ptr);

    const time_ctx: *TimeCtx = @ptrFromInt(time_ctx_ptr);
    @memcpy(std.mem.asBytes(time_ctx), std.mem.asBytes(&snap.time));

    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
    @memcpy(std.mem.asBytes(input_ctx), std.mem.asBytes(&snap.inputs));

    const events: *EventBuffer = @ptrFromInt(events_ptr);
    @memcpy(std.mem.asBytes(events), std.mem.asBytes(&snap.events));

    if (snap.user_data_len > 0) {
        user_data_deserialize(
            @intFromPtr(snap.user_data().ptr),
            snap.user_data_len,
        );
    }
}

pub export fn seek(frame: u32) void {
    if (tape == null) {
        logf("seek(frame: {})", .{frame});
        @panic("Tried to seek to frame without an active tape");
    }

    const snapshot = tape.?.closest_snapshot(frame);
    restore(@intFromPtr(snapshot));

    // Advance to the desired frame
    const time: *TimeCtx = @ptrFromInt(time_ctx_ptr);
    vcr.is_replaying = true;
    defer {
        vcr.is_replaying = false;
    }

    while (time.*.frame < frame) {
        const tape_events = tape.?.get_events(time.*.frame);
        const events: *EventBuffer = @ptrFromInt(events_ptr);
        // log_fmt("Replaying frame {} with {d} events", .{ time.*.frame, tape_events.len });

        events.*.count = std.math.cast(u8, tape_events.len) orelse {
            logf("Too many events in tape for event buffer: {}", .{tape_events.len});
            @panic("Too many events in tape for event buffer - must be 255 or fewer");
        };
        for (tape_events, 0..) |event, idx| {
            events.*.events[idx] = event;
        }
        const count = step(hz);
        if (count == 0) {
            @panic("Failed to advance frame during seek");
        }
    }
}

pub export fn register_systems(handle: cb_handle) void {
    global_cb_handle = handle;
}

pub export fn step(ms: u32) u32 {
    defer {
        if (arena_alloc != null) {
            _ = arena_alloc.?.reset(.retain_capacity);
        }
    }
    accumulator += ms;

    const time: *TimeCtx = @ptrFromInt(time_ctx_ptr);

    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);

    var step_count: u32 = 0;
    while (accumulator >= hz) {
        // Age input states at the start of each frame
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

        time.*.dt_ms = hz;
        time.*.total_ms += hz;
        if (vcr.is_replaying and time.*.frame < tape.?.frame_count() - 1) {
            use_tape_events();
        }
        process_events();
        __cb(global_cb_handle, cb_ptr, hz);
        step_count += 1;
        time.*.frame += 1;
        accumulator -= hz;
        flush_events();

        // Advance to the next frame
        if (vcr.is_recording and !vcr.is_replaying) {
            if (tape) |*t| {
                t.start_frame() catch {
                    @panic("Failed to advance tape frame");
                };
            }
        }
    }
    accumulator = @max(accumulator, 0);
    return step_count;
}

pub export fn emit_keydown(key_code: Events.Key) void {
    append_event(Event.keyDown(key_code));
}

pub export fn emit_keyup(key_code: Events.Key) void {
    append_event(Event.keyUp(key_code));
}

pub export fn emit_mousedown(button: Events.MouseButton) void {
    append_event(Event.mouseDown(button));
}

pub export fn emit_mouseup(button: Events.MouseButton) void {
    append_event(Event.mouseUp(button));
}

pub export fn emit_mousemove(x: f32, y: f32) void {
    append_event(Event.mouseMove(x, y));
}

pub export fn emit_mousewheel(delta_x: f32, delta_y: f32) void {
    append_event(Event.mouseWheel(delta_x, delta_y));
}

pub export fn get_time_ctx() wasmPointer {
    return time_ctx_ptr;
}

fn use_tape_events() void {
    if (vcr.is_replaying) {
        if (tape == null) {
            @panic("Replaying without an active tape");
        }
        const time: *TimeCtx = @ptrFromInt(time_ctx_ptr);
        if (time.*.frame > tape.?.frame_count()) {
            // No more events to replay
            return;
        }

        const tape_events = tape.?.get_events(time.*.frame);
        const events: *EventBuffer = @ptrFromInt(events_ptr);
        events.*.count = std.math.cast(u8, tape_events.len) orelse {
            logf("Too many events in tape for event buffer: {}", .{tape_events.len});
            @panic("Too many events in tape for event buffer - must be 255 or fewer");
        };
        for (tape_events, 0..) |event, idx| {
            events.*.events[idx] = event;
        }
    }
}

fn append_event(event: Event) void {
    if (vcr.is_recording) {
        tape.?.append_event(event) catch @panic("Failed to record event");
    }

    const events: *EventBuffer = @ptrFromInt(events_ptr);
    const idx = events.*.count;
    if (idx < 128) {
        events.*.count += 1;
        events.*.events[idx] = event;
    } else {
        @panic("Event buffer full. Have you called flush?");
    }
}

fn process_events() void {
    const events: *EventBuffer = @ptrFromInt(events_ptr);
    for (events.*.events[0..events.*.count]) |event| {
        const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
        input_ctx.*.process_event(event);
    }
}

fn flush_events() void {
    const events: *EventBuffer = @ptrFromInt(events_ptr);
    events.*.count = 0;
}

/// Logs a message to the console
/// @param msg The message to log
/// to log an allocated message, use the arena allocator, e.g.
fn logf(comptime fmt: []const u8, args: anytype) void {
    const msg = std.fmt.allocPrint(arena(), fmt, args) catch {
        wasm_log(fmt);
        @panic("Failed to allocate log message");
    };
    wasm_log(msg);
}

fn wasm_log(msg: []const u8) void {
    console_log(msg.ptr, msg.len);
}

fn arena() std.mem.Allocator {
    if (arena_alloc == null) {
        arena_alloc = std.heap.ArenaAllocator.init(wasm_alloc);
    }
    return arena_alloc.?.allocator();
}
