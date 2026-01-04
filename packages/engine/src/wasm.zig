const std = @import("std");
const Events = @import("events.zig");
const Tapes = @import("tapes/tapes.zig");
const Log = @import("log.zig");
const root = @import("root.zig");
const Engine = root.Engine;

// ─────────────────────────────────────────────────────────────
// WASM externs
// ─────────────────────────────────────────────────────────────

/// Log a message to the js console
extern "env" fn console_log(ptr: [*]const u8, len: usize) void;

/// Callback into JS to run registered systems
extern "env" fn __systems(fn_handle: u32, ptr: u32, dt: u32) void;

/// Callback into JS before each simulation step
extern "env" fn __before_frame(ctx_ptr: usize, frame: u32) void;

/// Returns the current size of user data for snapshots
extern "env" fn __user_data_len() u32;

/// Callback into JS when tape buffer fills up
extern "env" fn __on_tape_full(ctx_ptr: u32) void;

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

var ctx_ptr: wasmPointer = 0;

var global_cb_handle: cb_handle = 0;
var global_snapshot_handle: cb_handle = 0;
var global_restore_handle: cb_handle = 0;

var engine: ?Engine = null;

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

    // Allocate the callback pointer struct first (we need to pass it to Engine.init)
    // the callback pointer injects:
    // 0 - pointer to time context
    // 1 - pointer to input context
    // 2 - pointer to events buffer
    // 3 - pointer to network context
    ctx_ptr = alloc(@sizeOf(u32) * 4);

    // Initialize the Engine (which creates and owns Sim)
    engine = Engine.init(wasm_alloc, ctx_ptr) catch {
        @panic("Failed to initialize engine");
    };

    // Wire up tick listeners now that Engine is in its final location
    engine.?.wireListeners();

    // Wire up the callback pointer with Sim's context pointers
    const sim = engine.?.sim;
    const cb_data: [*]u32 = @ptrFromInt(ctx_ptr);
    cb_data[0] = @intFromPtr(sim.time);
    cb_data[1] = @intFromPtr(sim.inputs);
    cb_data[2] = @intFromPtr(sim.events);
    cb_data[3] = @intFromPtr(sim.net_ctx);

    // Wire up WASM callbacks
    sim.callbacks = .{
        .before_frame = wasm_before_frame,
        .systems = wasm_systems_callback,
        .user_serialize = wasm_user_serialize,
        .user_deserialize = wasm_user_deserialize,
        .user_data_len = wasm_user_data_len,
        .on_tape_full = wasm_on_tape_full,
    };

    return ctx_ptr;
}

fn wasm_before_frame(frame: u32) void {
    __before_frame(ctx_ptr, frame);
}

fn wasm_systems_callback(_: usize, dt: u32) void {
    __systems(global_cb_handle, ctx_ptr, dt);
}

fn wasm_user_serialize(ptr: usize, len: u32) void {
    user_data_serialize(@intCast(ptr), len);
}

fn wasm_user_deserialize(ptr: usize, len: u32) void {
    user_data_deserialize(@intCast(ptr), len);
}

fn wasm_user_data_len() u32 {
    return __user_data_len();
}

fn wasm_on_tape_full() void {
    __on_tape_full(ctx_ptr);
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

pub export fn start_recording(user_data_len: u32, max_events: u32, max_packet_bytes: u32) u8 {
    engine.?.startRecording(user_data_len, max_events, max_packet_bytes) catch |e| {
        switch (e) {
            Engine.RecordingError.AlreadyRecording => {
                wasm_log("Already recording");
                return 2;
            },
            Engine.RecordingError.OutOfMemory => {
                wasm_log("Failed to start recording: Out of memory");
                return 1;
            },
            Engine.RecordingError.TapeError => {
                wasm_log("Failed to start first tape frame");
                return 1;
            },
        }
    };

    return 0;
}

pub export fn stop_recording() u8 {
    if (!engine.?.isRecording()) {
        wasm_log("Tried to stop recording but we are not currently recording");
        return 2;
    }
    engine.?.stopRecording();
    return 0;
}

pub export fn is_recording() bool {
    return engine.?.isRecording();
}

pub export fn is_replaying() bool {
    return engine.?.isReplaying();
}

pub export fn get_tape_ptr() wasmPointer {
    const buf = engine.?.getTapeBuffer() orelse @panic("No active tape");
    return @intFromPtr(buf.ptr);
}

pub export fn get_tape_len() u32 {
    const buf = engine.?.getTapeBuffer() orelse @panic("No active tape");
    return @intCast(buf.len);
}

pub export fn load_tape(tape_ptr: wasmPointer, tape_len: u32) u8 {
    const tape_buf: [*]u8 = @ptrFromInt(tape_ptr);
    const tape_slice = tape_buf[0..tape_len];

    engine.?.loadTape(tape_slice) catch |e| {
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
            Tapes.TapeError.PacketBufferFull => {
                // This error can't happen during tape loading, but we need exhaustive handling
                wasm_log("Failed to load tape: Packet buffer full");
                return 1;
            },
        }
    };
    return 0;
}

pub export fn deinit() void {
    if (engine != null) {
        engine.?.deinit();
        engine = null;
    }
    if (arena_alloc != null) {
        arena_alloc.?.deinit();
        arena_alloc = null;
    }
}

pub export fn take_snapshot(user_data_len: u32) wasmPointer {
    const snap = engine.?.sim.take_snapshot(user_data_len) catch {
        @panic("Snapshot allocation failed: Out of memory");
    };
    return @intFromPtr(snap);
}

pub export fn restore(snapshot_ptr: wasmPointer) void {
    const snap: *Tapes.Snapshot = @ptrFromInt(snapshot_ptr);
    engine.?.sim.restore(snap);
}

pub export fn seek(frame: u32) void {
    engine.?.seek(frame);
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
    return engine.?.advance(ms);
}

/// Run a single simulation frame without accumulator management.
/// Use this for rollback resimulation to avoid re-entrancy issues with step().
/// During resimulation, frames are confirmed (we're replaying known inputs).
pub export fn tick(is_resimulating: bool) void {
    engine.?.sim.tick(is_resimulating);
}

pub export fn emit_keydown(key_code: Events.Key, peer_id: u8) void {
    engine.?.emit_keydown(key_code, peer_id);
}

pub export fn emit_keyup(key_code: Events.Key, peer_id: u8) void {
    engine.?.emit_keyup(key_code, peer_id);
}

pub export fn emit_mousedown(button: Events.MouseButton, peer_id: u8) void {
    engine.?.emit_mousedown(button, peer_id);
}

pub export fn emit_mouseup(button: Events.MouseButton, peer_id: u8) void {
    engine.?.emit_mouseup(button, peer_id);
}

pub export fn emit_mousemove(x: f32, y: f32, peer_id: u8) void {
    engine.?.emit_mousemove(x, y, peer_id);
}

pub export fn emit_mousewheel(delta_x: f32, delta_y: f32, peer_id: u8) void {
    engine.?.emit_mousewheel(delta_x, delta_y, peer_id);
}

pub export fn get_time_ctx() wasmPointer {
    return @intFromPtr(engine.?.sim.time);
}

pub export fn get_events_ptr() wasmPointer {
    return @intFromPtr(engine.?.sim.events);
}

// ─────────────────────────────────────────────────────────────
// Session / Rollback exports
// ─────────────────────────────────────────────────────────────

/// End the current session
pub export fn session_end() void {
    engine.?.sessionEnd();
}

/// Get pointer to net context struct
pub export fn get_net_ctx() usize {
    return @intFromPtr(engine.?.sim.net_ctx);
}

// ─────────────────────────────────────────────────────────────
// Network / Packet exports
// ─────────────────────────────────────────────────────────────

/// Initialize a session (derives peer count/local ID from prior events)
pub export fn emit_net_session_init() void {
    engine.?.emitNetSessionInit();
}

/// End the current session (emits disconnect events for all peers)
pub export fn emit_net_session_end() void {
    engine.?.emitNetSessionEnd();
}

/// Build an outbound packet for a target peer
/// Call get_outbound_packet to get the pointer
/// Call get_outbound_packet_len to get the length
pub export fn build_outbound_packet(target_peer: u8) void {
    engine.?.buildOutboundPacket(target_peer);
}

/// Get pointer to the outbound packet buffer
pub export fn get_outbound_packet() wasmPointer {
    return @intCast(engine.?.getOutboundPacketPtr());
}

/// Get length of the outbound packet
pub export fn get_outbound_packet_len() u32 {
    return engine.?.getOutboundPacketLen();
}

/// Queue a received packet for processing in the next tick
/// Returns 0 on success, error code otherwise
pub export fn emit_receive_packet(ptr: wasmPointer, len: u32) u8 {
    return engine.?.emit_receive_packet(ptr, len);
}

// ─────────────────────────────────────────────────────────────
// Network event exports
// ─────────────────────────────────────────────────────────────

/// Emit NetJoinOk event - successfully joined a room
/// room_code_ptr points to a UTF-8 string, len is the byte length (max 8)
pub export fn emit_net_join_ok(room_code_ptr: [*]const u8, len: u32) void {
    var room_code: [8]u8 = .{ 0, 0, 0, 0, 0, 0, 0, 0 };
    const copy_len = @min(len, 8);
    @memcpy(room_code[0..copy_len], room_code_ptr[0..copy_len]);
    engine.?.emit_net_join_ok(room_code);
}

/// Emit NetJoinFail event - failed to join a room
/// reason is a NetJoinFailReason enum value (0=unknown, 1=timeout, etc.)
pub export fn emit_net_join_fail(reason: u8) void {
    engine.?.emit_net_join_fail(@enumFromInt(reason));
}

/// Emit NetPeerJoin event - a peer joined the room
pub export fn emit_net_peer_join(peer_id: u8) void {
    engine.?.emit_net_peer_join(peer_id);
}

/// Emit NetPeerLeave event - a peer left the room
pub export fn emit_net_peer_leave(peer_id: u8) void {
    engine.?.emit_net_peer_leave(peer_id);
}

/// Assign local peer ID (for session setup)
pub export fn emit_net_peer_assign_local_id(peer_id: u8) void {
    engine.?.emit_net_peer_assign_local_id(peer_id);
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
