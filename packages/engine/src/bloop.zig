const std = @import("std");

// Imported from JS. Calls console.log
extern "env" fn console_log(ptr: [*]const u8, len: usize) void;

// Imported from JS. Calls the JS function by handle
extern "env" fn __cb(fn_handle: u32, ptr: u32, dt: u32) void;

const wasmPointer = u32;
const hz = 1000 / 60;

var wasm_alloc = std.heap.wasm_allocator;
var global_cb_handle: u32 = 0;
var accumulator: u32 = 0;
var time_ctx_ptr: wasmPointer = 0;

pub export fn alloc(size: usize) wasmPointer {
    const slice = wasm_alloc.alloc(u8, size) catch return 0;
    return @intFromPtr(slice.ptr);
}

pub export fn initialize() void {
    const ptr = alloc(@sizeOf(TimeCtx));
    const ctx: *TimeCtx = @ptrFromInt(ptr);
    ctx.*.dt_ms = 0;
    ctx.*.frame = 0;
    ctx.*.total_ms = 0;
    time_ctx_ptr = ptr;
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

pub export fn write_byte(ptr: u32) void {
    const p: [*]u8 = @ptrFromInt(ptr);
    p[0] = 123;
}

pub export fn step(ms: u32) void {
    accumulator += ms;

    const time: *TimeCtx = @ptrFromInt(time_ctx_ptr);

    while (accumulator >= hz) {
        time.*.dt_ms = hz;
        time.*.total_ms += hz;
        __cb(global_cb_handle, 0, hz);
        time.*.frame += 1;
        accumulator -= hz;
    }
    accumulator = @max(accumulator, 0);
}

pub const TimeCtx = extern struct { frame: u32, dt_ms: u32, total_ms: u64 };

pub const Snapshot = extern struct {
    len: u32,
    time: TimeCtx,
    extra: [4]u8,
};
