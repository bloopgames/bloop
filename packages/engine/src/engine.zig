const std = @import("std");
const Events = @import("events.zig");
const Tapes = @import("tapes.zig");
const Log = @import("log.zig");
const Sim = @import("sim.zig").Sim;

// ─────────────────────────────────────────────────────────────
// WASM externs
// ─────────────────────────────────────────────────────────────

/// Log a message to the js console
extern "env" fn console_log(ptr: [*]const u8, len: usize) void;

/// Callback into JS to run registered systems
extern "env" fn __systems(fn_handle: u32, ptr: u32, dt: u32) void;

/// Callback into JS before each simulation step
extern "env" fn __before_frame(frame: u32) void;

/// Returns the current size of user data for snapshots
extern "env" fn user_data_len() u32;

/// Writes user data from js to the given snapshot pointer
extern "env" fn user_data_serialize(ptr: wasmPointer, len: u32) void;

/// Reads user data into js from the given snapshot pointer
extern "env" fn user_data_deserialize(ptr: wasmPointer, len: u32) void;

// ─────────────────────────────────────────────────────────────
// Types and constants
// ─────────────────────────────────────────────────────────────

const wasmPointer = u32;
const cb_handle = u32;

var wasm_alloc = std.heap.wasm_allocator;
var arena_alloc: ?std.heap.ArenaAllocator = null;

var cb_ptr: wasmPointer = 0;

var global_cb_handle: cb_handle = 0;
var global_snapshot_handle: cb_handle = 0;
var global_restore_handle: cb_handle = 0;

var sim: ?Sim = null;

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

    // Allocate the callback pointer struct first (we need to pass it to Sim.init)
    // the callback pointer injects:
    // 0 - pointer to time context
    // 1 - pointer to input context
    // 2 - pointer to events buffer
    cb_ptr = alloc(@sizeOf(u32) * 3);

    // Initialize the Sim
    sim = Sim.init(wasm_alloc, cb_ptr) catch {
        @panic("Failed to initialize simulation");
    };

    // Wire up the callback pointer with Sim's context pointers
    const cb_data: [*]u32 = @ptrFromInt(cb_ptr);
    cb_data[0] = @intFromPtr(sim.?.time);
    cb_data[1] = @intFromPtr(sim.?.inputs);
    cb_data[2] = @intFromPtr(sim.?.events);

    // Wire up WASM callbacks
    sim.?.callbacks = .{
        .before_frame = wasm_before_frame,
        .systems = wasm_systems_callback,
        .user_serialize = wasm_user_serialize,
        .user_deserialize = wasm_user_deserialize,
        .user_data_len = wasm_user_data_len,
    };

    return cb_ptr;
}

fn wasm_before_frame(frame: u32) void {
    __before_frame(frame);
}

fn wasm_systems_callback(ctx_ptr: usize, dt: u32) void {
    _ = ctx_ptr;
    __systems(global_cb_handle, cb_ptr, dt);
}

fn wasm_user_serialize(ptr: usize, len: u32) void {
    user_data_serialize(@intCast(ptr), len);
}

fn wasm_user_deserialize(ptr: usize, len: u32) void {
    user_data_deserialize(@intCast(ptr), len);
}

fn wasm_user_data_len() u32 {
    return user_data_len();
}

pub export fn alloc(size: usize) wasmPointer {
    const slice = wasm_alloc.alloc(u8, size) catch {
        @panic("Failed to allocate memory from engine");
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

pub export fn start_recording(data_len: u32, max_events: u32) u8 {
    sim.?.start_recording(data_len, max_events) catch |e| {
        switch (e) {
            Sim.RecordingError.AlreadyRecording => {
                wasm_log("Already recording");
                return 2;
            },
            Sim.RecordingError.OutOfMemory => {
                wasm_log("Failed to start recording: Out of memory");
                return 1;
            },
            Sim.RecordingError.TapeError => {
                wasm_log("Failed to start first tape frame");
                return 1;
            },
        }
    };

    if (sim.?.time.frame != 0) {
        wasm_log("Untested: started recording from non-zero frame");
    }

    return 0;
}

pub export fn stop_recording() u8 {
    if (!sim.?.is_recording) {
        wasm_log("Not currently recording");
        return 2;
    }
    sim.?.stop_recording();
    return 0;
}

pub export fn is_recording() bool {
    return sim.?.is_recording;
}

pub export fn is_replaying() bool {
    return sim.?.is_replaying;
}

pub export fn get_tape_ptr() wasmPointer {
    const buf = sim.?.get_tape_buffer() orelse @panic("No active tape");
    return @intFromPtr(buf.ptr);
}

pub export fn get_tape_len() u32 {
    const buf = sim.?.get_tape_buffer() orelse @panic("No active tape");
    return @intCast(buf.len);
}

pub export fn load_tape(tape_ptr: wasmPointer, tape_len: u32) u8 {
    const tape_buf: [*]u8 = @ptrFromInt(tape_ptr);
    const tape_slice = tape_buf[0..tape_len];

    sim.?.load_tape(tape_slice) catch |e| {
        switch (e) {
            error.CurrentlyRecording => {
                wasm_log("Cannot load tape while recording");
                return 2;
            },
            error.OutOfMemory => {
                wasm_log("Failed to allocate memory for tape load");
                return 1;
            },
            Tapes.TapeError.BadMagic => {
                wasm_log("Failed to load tape: Bad magic number");
                return 1;
            },
            Tapes.TapeError.InvalidTape => {
                wasm_log("Failed to load tape: Invalid tape format");
                return 1;
            },
            Tapes.TapeError.UnsupportedVersion => {
                wasm_log("Failed to load tape: Unsupported tape version");
                return 1;
            },
        }
    };
    return 0;
}

pub export fn deinit() void {
    if (sim != null) {
        sim.?.deinit();
        sim = null;
    }
    if (arena_alloc != null) {
        arena_alloc.?.deinit();
        arena_alloc = null;
    }
}

pub export fn take_snapshot(data_len: u32) wasmPointer {
    const snap = sim.?.take_snapshot(data_len) catch {
        @panic("Snapshot allocation failed: Out of memory");
    };
    return @intFromPtr(snap);
}

pub export fn restore(snapshot_ptr: wasmPointer) void {
    const snap: *Tapes.Snapshot = @ptrFromInt(snapshot_ptr);
    sim.?.restore(snap);
}

pub export fn seek(frame: u32) void {
    sim.?.seek(frame);
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
    return sim.?.step(ms);
}

/// Run a single simulation frame without accumulator management.
/// Use this for rollback resimulation to avoid re-entrancy issues with step().
pub export fn tick() void {
    sim.?.tick();
}

pub export fn emit_keydown(key_code: Events.Key, source: Events.InputSource) void {
    sim.?.emit_keydown(key_code, source);
}

pub export fn emit_keyup(key_code: Events.Key, source: Events.InputSource) void {
    sim.?.emit_keyup(key_code, source);
}

pub export fn emit_mousedown(button: Events.MouseButton, source: Events.InputSource) void {
    sim.?.emit_mousedown(button, source);
}

pub export fn emit_mouseup(button: Events.MouseButton, source: Events.InputSource) void {
    sim.?.emit_mouseup(button, source);
}

pub export fn emit_mousemove(x: f32, y: f32, source: Events.InputSource) void {
    sim.?.emit_mousemove(x, y, source);
}

pub export fn emit_mousewheel(delta_x: f32, delta_y: f32, source: Events.InputSource) void {
    sim.?.emit_mousewheel(delta_x, delta_y, source);
}

pub export fn get_time_ctx() wasmPointer {
    return @intFromPtr(sim.?.time);
}

pub export fn get_events_ptr() wasmPointer {
    return @intFromPtr(sim.?.events);
}

// ─────────────────────────────────────────────────────────────
// Session / Rollback exports
// ─────────────────────────────────────────────────────────────

/// Initialize a multiplayer session with rollback support
/// Captures current frame as session_start_frame
pub export fn session_init(peer_count: u8, data_len: u32) u8 {
    sim.?.sessionInit(peer_count, data_len) catch {
        wasm_log("Failed to initialize session: Out of memory");
        return 1;
    };
    return 0;
}

/// End the current session
pub export fn session_end() void {
    sim.?.sessionEnd();
}

/// Emit inputs for a peer at a given match frame
/// events_ptr points to an array of Event structs
/// events_len is the number of events (not bytes)
pub export fn session_emit_inputs(peer: u8, match_frame: u32, events_ptr: wasmPointer, events_len: u32) void {
    const events: [*]const Events.Event = @ptrFromInt(events_ptr);
    const events_slice = events[0..events_len];
    sim.?.sessionEmitInputs(peer, match_frame, events_slice);
}

/// Get current match frame (0 if no session)
pub export fn get_match_frame() u32 {
    return sim.?.getMatchFrame();
}

/// Get confirmed frame (0 if no session)
pub export fn get_confirmed_frame() u32 {
    return sim.?.getConfirmedFrame();
}

/// Get confirmed frame for a specific peer
pub export fn get_peer_frame(peer: u8) u32 {
    return sim.?.getPeerFrame(peer);
}

/// Get rollback depth (match_frame - confirmed_frame)
pub export fn get_rollback_depth() u32 {
    return sim.?.getRollbackDepth();
}

// ─────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────

fn wasm_log(msg: []const u8) void {
    console_log(msg.ptr, msg.len);
}

fn arena() std.mem.Allocator {
    if (arena_alloc == null) {
        arena_alloc = std.heap.ArenaAllocator.init(wasm_alloc);
    }
    return arena_alloc.?.allocator();
}
