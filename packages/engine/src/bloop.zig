// Imported from JS. Calls console.log
extern "env" fn console_log(ptr: [*]const u8, len: usize) void;

// Imported from JS. Calls the JS function by handle
extern "env" fn __cb(fn_handle: u32, ptr: u32, dt: u32) void;

var global_cb_handle: u32 = 0;
var accumulator: u32 = 0;

const hz = 1000 / 60;

pub export fn register_systems(cb_handle: u32) void {
    global_cb_handle = cb_handle;
}

pub export fn step(ms: u32) void {
    accumulator += ms;

    while (accumulator >= hz) {
        __cb(global_cb_handle, 0, hz);
        accumulator -= hz;
    }
    accumulator = @max(accumulator, 0);
}
