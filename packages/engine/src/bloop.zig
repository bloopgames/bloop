const std = @import("std");

var wasm_alloc = std.heap.wasm_allocator;

// Imported from JS. Calls console.log
extern "env" fn console_log(ptr: [*]const u8, len: usize) void;

// Imported from JS. Calls the JS function by handle
extern "env" fn __cb(fn_handle: u32, ptr: u32, dt: u32) void;

var global_cb_handle: u32 = 0;
var accumulator: u32 = 0;

const hz = 1000 / 60;
const enginePointer = u32;

pub const TimeCtx = extern struct { frame: u32, dt_ms: u32, total_ms: u64 };

var time_ctx_ptr: enginePointer = 0;

pub export fn initialize() void {
    const ptr = alloc(@sizeOf(TimeCtx));
    const ctx: *TimeCtx = @ptrFromInt(ptr);
    ctx.*.dt_ms = 0;
    ctx.*.frame = 66;
    ctx.*.total_ms = 0;
    time_ctx_ptr = ptr;
}

pub export fn time_ctx() enginePointer {
    return time_ctx_ptr;
}

pub export fn register_systems(cb_handle: u32) void {
    global_cb_handle = cb_handle;
}

pub export fn alloc(size: usize) enginePointer {
    const slice = wasm_alloc.alloc(u8, size) catch return 0;
    return @intFromPtr(slice.ptr);
}

pub export fn write_byte(ptr: u32) void {
    const p: [*]u8 = @ptrFromInt(ptr);
    p[0] = 123;
}

pub export fn step(ms: u32) void {
    accumulator += ms;

    while (accumulator >= hz) {
        __cb(global_cb_handle, 0, hz);
        accumulator -= hz;
    }
    accumulator = @max(accumulator, 0);
}
