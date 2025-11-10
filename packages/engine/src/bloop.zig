const std = @import("std");

// Imported from JS. Calls console.log
extern "env" fn console_log(ptr: [*]const u8, len: usize) void;

// Imported from JS. Calls the JS function by handle
extern "env" fn __cb(fn_handle: u32, ptr: u32, dt: u32) void;

const wasmPointer = u32;
const hz = 1000 / 60;

pub const Events = @import("events.zig");
const Event = Events.Event;
const EventBuffer = extern struct {
    count: u8,
    events: [256]Event,
};

var wasm_alloc = std.heap.wasm_allocator;
var arena_alloc: ?std.heap.ArenaAllocator = null;
var global_cb_handle: u32 = 0;
var accumulator: u32 = 0;

var cb_ptr: wasmPointer = 0;
var time_ctx_ptr: wasmPointer = 0;
var input_ctx_ptr: wasmPointer = 0;
var events_ptr: wasmPointer = 0;

pub const TimeCtx = extern struct { frame: u32, dt_ms: u32, total_ms: u64 };

pub const InputCtx = extern struct {
    key_ctx: KeyCtx,
    mouse_ctx: MouseCtx,
};

pub const KeyCtx = extern struct {
    /// Each byte represents last 8 frames of input
    key_states: [256]u8,
};

pub const MouseCtx = extern struct {
    x: f32,
    y: f32,
    wheel_x: f32,
    wheel_y: f32,
    /// Each byte represents last 8 frames of input
    button_states: [8]u8,
};

pub const Snapshot = extern struct {
    len: u32,
    time: TimeCtx,
    // inputs: InputCtx,
    extra: [4]u8,
};

pub export fn alloc(size: usize) wasmPointer {
    const slice = wasm_alloc.alloc(u8, size) catch return 0;
    return @intFromPtr(slice.ptr);
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
    @memset(input_data[0..@sizeOf(InputCtx)], 99);

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

fn get_arena() std.mem.Allocator {
    if (arena_alloc == null) {
        arena_alloc = std.heap.ArenaAllocator.init(wasm_alloc);
    }
    return arena_alloc.?.allocator();
}

pub export fn snapshot() wasmPointer {
    // Get a slice of bytes for the TimeCtx pointer
    const time_size = @sizeOf(TimeCtx);
    const time_bytes = std.mem.asBytes(@as(*const TimeCtx, @ptrFromInt(time_ctx())));

    // this is a stand-in for other structs I'll want to serialize
    const extra = &[4]u8{ 0xDE, 0xAD, 0xBE, 0xEF };

    // Allocate memory for the snapshot
    const size: u32 = @sizeOf(u32) + time_bytes.len + extra.len;
    const ptr = alloc(size);
    const out: [*]u8 = @ptrFromInt(ptr);

    // Copy data into the snapshot buffer
    var offset: u32 = 0;
    @memcpy(out[offset .. offset + 4], std.mem.asBytes(&size));
    offset += 4;
    @memcpy(out[offset .. offset + time_size], time_bytes);
    offset += time_size;
    @memcpy(out[offset..size], extra);
    return ptr;
}

pub export fn restore(ptr: u32, len: u32) void {
    const src: [*]const u8 = @ptrFromInt(ptr);
    const time_size = @sizeOf(TimeCtx);

    // Expect TimeCtx + 4 extra bytes
    if (len < time_size + 4) @panic("nope");

    // Copy TimeCtx back into live context
    const ctx: *TimeCtx = @ptrFromInt(time_ctx());
    const dst = std.mem.asBytes(ctx);
    @memcpy(dst[0..time_size], src[0..time_size]);

    // Validate the trailing marker
    const extra = src[time_size .. time_size + 4];
    if (extra[0] != 0xDE or extra[1] != 0xAD or extra[2] != 0xBE or extra[3] != 0xEF)
        @panic("Invalid snapshot data");
}

pub export fn time_ctx() wasmPointer {
    return time_ctx_ptr;
}

pub export fn register_systems(cb_handle: u32) void {
    global_cb_handle = cb_handle;
}

pub export fn emit_keydown(key_code: Events.Key) void {
    const input_ctx: *InputCtx = @ptrFromInt(input_ctx_ptr);
    // todo - bit shift
    input_ctx.*.key_ctx.key_states[@intFromEnum(key_code)] = 1;

    const events: *EventBuffer = @ptrFromInt(events_ptr);
    const idx = events.*.count;
    if (idx < 256) {
        events.*.count += 1;
        events.*.events[idx] = Event.keyDown(key_code);
    } else {
        @panic("Event buffer full");
    }
}

fn log(msg: []const u8) void {
    console_log(msg.ptr, msg.len);
}

pub export fn flush_events() void {
    const events: *EventBuffer = @ptrFromInt(events_ptr);
    events.*.count = 0;
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
    }
    accumulator = @max(accumulator, 0);
}
