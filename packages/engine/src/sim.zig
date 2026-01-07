const std = @import("std");
const Ctx = @import("context.zig");
const Events = @import("events.zig");
const Tapes = @import("tapes/tapes.zig");
const IB = @import("input_buffer.zig");
const Log = @import("log.zig");

const TimeCtx = Ctx.TimeCtx;
const InputCtx = Ctx.InputCtx;
const NetCtx = Ctx.NetCtx;
const NetStatus = Ctx.NetStatus;
const Event = Events.Event;
const EventBuffer = Events.EventBuffer;
const EventType = Events.EventType;
const InputBuffer = IB.InputBuffer;

pub const hz = 1000 / 60;

/// Callbacks provided by the host (WASM or native test harness)
pub const Callbacks = struct {
    /// Called before each simulation frame
    before_frame: ?*const fn (frame: u32) void = null,
    /// Called to run game systems
    systems: ?*const fn (ctx_ptr: usize, dt: u32) void = null,
    /// Serialize user data into snapshot buffer
    user_serialize: ?*const fn (ptr: usize, len: u32) void = null,
    /// Deserialize user data from snapshot buffer
    user_deserialize: ?*const fn (ptr: usize, len: u32) void = null,
    /// Returns the current size of user data (dynamic, may change between frames)
    user_data_len: ?*const fn () u32 = null,
    /// Called when tape buffer fills up and recording stops
    on_tape_full: ?*const fn () void = null,
};

/// Tick lifecycle listeners for Engine coordination.
/// Engine registers these to intercept tick() calls for tape replay, VCR advancement, etc.
pub const TickListeners = struct {
    context: ?*anyopaque = null,
    before_tick: ?*const fn (ctx: *anyopaque) void = null,
    after_tick: ?*const fn (ctx: *anyopaque, is_resimulating: bool) void = null,
};

pub const Sim = struct {
    time: *TimeCtx,
    inputs: *InputCtx,
    events: *EventBuffer,
    callbacks: Callbacks = .{},
    allocator: std.mem.Allocator,
    /// Pointer to context data passed to callbacks (for JS interop)
    ctx_ptr: usize,
    /// Input buffer (owned by caller - Engine or tests)
    input_buffer: *InputBuffer,
    /// Network context exposed to game systems via DataView (Engine syncs this)
    net_ctx: *NetCtx,

    // ─────────────────────────────────────────────────────────────
    // Tick Listeners (for Engine coordination)
    // ─────────────────────────────────────────────────────────────
    listeners: TickListeners = .{},

    /// Initialize a new simulation with allocated contexts.
    /// The InputBuffer is passed in - caller (Engine or tests) owns its lifecycle.
    pub fn init(allocator: std.mem.Allocator, ctx_ptr: usize, input_buffer: *InputBuffer) !Sim {
        // Allocate TimeCtx
        const time = try allocator.create(TimeCtx);
        time.* = TimeCtx{ .frame = 0, .dt_ms = 0, .total_ms = 0 };

        // Allocate InputCtx
        const inputs = try allocator.create(InputCtx);
        @memset(std.mem.asBytes(inputs), 0);

        // Allocate EventBuffer
        const events = try allocator.create(EventBuffer);
        @memset(std.mem.asBytes(events), 0);

        // Allocate NetCtx (small struct exposed to game systems)
        const net_ctx = try allocator.create(NetCtx);
        net_ctx.* = .{
            .peer_count = input_buffer.peer_count,
            .local_peer_id = 0,
            .in_session = 0,
            .status = @intFromEnum(Ctx.NetStatus.local),
            .match_frame = 0,
            .session_start_frame = 0,
            .room_code = .{ 0, 0, 0, 0, 0, 0, 0, 0 },
        };

        return Sim{
            .time = time,
            .inputs = inputs,
            .events = events,
            .input_buffer = input_buffer,
            .net_ctx = net_ctx,
            .allocator = allocator,
            .ctx_ptr = ctx_ptr,
        };
    }

    /// Free all simulation resources (input_buffer is owned by caller)
    pub fn deinit(self: *Sim) void {
        self.allocator.destroy(self.time);
        self.allocator.destroy(self.inputs);
        self.allocator.destroy(self.events);
        self.allocator.destroy(self.net_ctx);
    }

    /// Get current user data length from callback (or 0 if no callback set)
    pub fn getUserDataLen(self: *const Sim) u32 {
        if (self.callbacks.user_data_len) |get_len| {
            return get_len();
        }
        return 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Core frame execution
    // ─────────────────────────────────────────────────────────────

    /// Run a single simulation frame.
    /// Reads match_frame and peer_count from net_ctx (synced by Engine before tick).
    /// @param is_resimulating: true if this is a resim frame during rollback
    pub fn tick(self: *Sim, is_resimulating: bool) void {
        Log.debug("Sim tick: frame={} resim={}", .{ self.time.frame, is_resimulating });

        // Set resimulating flag on TimeCtx for Engine to check
        self.time.is_resimulating = if (is_resimulating) 1 else 0;

        // Call before_tick listener (Engine syncs net_ctx here)
        if (self.listeners.before_tick) |before_tick| {
            before_tick(self.listeners.context.?);
        }

        // Age input states at the start of each frame (all players)
        self.inputs.age_all_states();

        self.time.dt_ms = hz;
        self.time.total_ms += hz;

        // Read match_frame and peer_count from contexts (synced by Engine)
        const match_frame = self.net_ctx.match_frame;
        const peer_count = self.net_ctx.peer_count;

        // Read events from InputBuffer for all peers
        for (0..peer_count) |peer_idx| {
            const peer: u8 = @intCast(peer_idx);
            const events = self.input_buffer.get(peer, match_frame);
            for (events) |event| {
                // Add to event buffer for processing
                const idx = self.events.count;
                if (idx < Events.MAX_EVENTS) {
                    self.events.count += 1;
                    self.events.events[idx] = event;
                }
            }
        }

        self.process_events();

        // Call game systems
        if (self.callbacks.systems) |systems| {
            systems(self.ctx_ptr, hz);
        }

        self.time.frame += 1;
        self.flush_events();

        // Call after_tick listener (Engine uses this for VCR frame advancement)
        if (self.listeners.after_tick) |after_tick| {
            after_tick(self.listeners.context.?, is_resimulating);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────

    fn process_events(self: *Sim) void {
        for (self.events.events[0..self.events.count]) |event| {
            // Skip net events - already processed by Engine in flushPendingNetEvents
            if (event.kind.isNetEvent()) continue;

            // Process input events
            self.inputs.process_event(event);
        }
    }

    fn flush_events(self: *Sim) void {
        self.events.count = 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Snapshots
    // ─────────────────────────────────────────────────────────────

    /// Take a snapshot of current state
    pub fn take_snapshot(self: *Sim, user_data_len: u32) !*Tapes.Snapshot {
        // Calculate input buffer snapshot size
        const current_match_frame = self.net_ctx.match_frame;
        const input_buffer_len = self.input_buffer.snapshotSize(current_match_frame);

        const snap = try Tapes.Snapshot.init(self.allocator, user_data_len, input_buffer_len);

        snap.write_time(@intFromPtr(self.time));
        snap.write_inputs(@intFromPtr(self.inputs));
        snap.write_events(@intFromPtr(self.events));
        snap.write_net(@intFromPtr(self.net_ctx));

        if (snap.user_data_len > 0) {
            if (self.callbacks.user_serialize) |serialize| {
                serialize(@intFromPtr(snap.user_data().ptr), snap.user_data_len);
            }
        }

        // Write input buffer snapshot data
        if (input_buffer_len > 0) {
            self.input_buffer.writeSnapshot(current_match_frame, snap.input_buffer_data());
        }

        return snap;
    }

    /// Restore state from a snapshot.
    /// Only restores basic Sim state (time, inputs, events, net_ctx).
    /// Session/rollback state is handled by Engine.
    /// If restore_input_buffer is false, input buffer state is NOT restored.
    /// This is used during rollback where we want to keep the current input buffer
    /// (which has inputs from packets that just arrived).
    pub fn restore(self: *Sim, snapshot: *Tapes.Snapshot, restore_input_buffer: bool) void {
        @memcpy(std.mem.asBytes(self.time), std.mem.asBytes(&snapshot.time));
        @memcpy(std.mem.asBytes(self.inputs), std.mem.asBytes(&snapshot.inputs));
        @memcpy(std.mem.asBytes(self.events), std.mem.asBytes(&snapshot.events));
        @memcpy(std.mem.asBytes(self.net_ctx), std.mem.asBytes(&snapshot.net));

        if (snapshot.user_data_len > 0) {
            if (self.callbacks.user_deserialize) |deserialize| {
                deserialize(@intFromPtr(snapshot.user_data().ptr), snapshot.user_data_len);
            }
        }

        // Restore input buffer state if present and requested
        if (restore_input_buffer and snapshot.input_buffer_len > 0) {
            self.input_buffer.restoreFromSnapshot(snapshot.input_buffer_data());
        }
    }
};

// ─────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────

/// Test helper that manages InputBuffer lifecycle and sets up listeners for standalone Sim tests.
const TestSimContext = struct {
    input_buffer: *InputBuffer,
    sim: Sim,
    allocator: std.mem.Allocator,

    /// Create a test Sim with properly configured InputBuffer and listeners
    fn init(allocator: std.mem.Allocator) !TestSimContext {
        const input_buffer = try allocator.create(InputBuffer);
        input_buffer.* = .{};
        input_buffer.init(1, 0); // Single peer for simple tests

        const sim = try Sim.init(allocator, 0, input_buffer);

        return TestSimContext{
            .input_buffer = input_buffer,
            .sim = sim,
            .allocator = allocator,
        };
    }

    /// Wire up listeners after TestSimContext is in a stable memory location
    fn wireListeners(self: *TestSimContext) void {
        self.sim.listeners = .{
            .context = @ptrCast(self),
            .before_tick = beforeTickListener,
            .after_tick = null,
        };
    }

    fn beforeTickListener(ctx_ptr: *anyopaque) void {
        const self: *TestSimContext = @ptrCast(@alignCast(ctx_ptr));
        // Sync net_ctx like Engine does
        self.sim.net_ctx.peer_count = self.input_buffer.peer_count;
        // match_frame = current elapsed frames (inputs at frame N go to match_frame N)
        self.sim.net_ctx.match_frame = self.sim.time.frame;
    }

    fn deinit(self: *TestSimContext) void {
        self.sim.deinit();
        self.allocator.destroy(self.input_buffer);
    }

    // Event emission helpers for tests (writes directly to input_buffer)
    fn emit_keydown(self: *TestSimContext, key: Events.Key, peer_id: u8) void {
        // Inputs at frame N go to match_frame N
        const match_frame = self.sim.time.frame;
        self.input_buffer.emit(peer_id, match_frame, &[_]Event{Event.keyDown(key, peer_id, .LocalKeyboard)});
    }

    fn emit_keyup(self: *TestSimContext, key: Events.Key, peer_id: u8) void {
        const match_frame = self.sim.time.frame;
        self.input_buffer.emit(peer_id, match_frame, &[_]Event{Event.keyUp(key, peer_id, .LocalKeyboard)});
    }

    fn emit_mousemove(self: *TestSimContext, x: f32, y: f32, peer_id: u8) void {
        const match_frame = self.sim.time.frame;
        self.input_buffer.emit(peer_id, match_frame, &[_]Event{Event.mouseMove(x, y, peer_id, .LocalMouse)});
    }
};

test "Sim init and deinit" {
    var ctx = try TestSimContext.init(std.testing.allocator);
    ctx.wireListeners();
    defer ctx.deinit();

    // Verify initial state
    try std.testing.expectEqual(0, ctx.sim.time.frame);
    try std.testing.expectEqual(0, ctx.sim.time.dt_ms);
    try std.testing.expectEqual(0, ctx.sim.time.total_ms);
    try std.testing.expectEqual(0, ctx.sim.events.count);
}

test "Sim contexts are zeroed" {
    var ctx = try TestSimContext.init(std.testing.allocator);
    ctx.wireListeners();
    defer ctx.deinit();

    // Verify inputs are zeroed
    for (ctx.sim.inputs.players) |player| {
        for (player.key_ctx.key_states) |state| {
            try std.testing.expectEqual(0, state);
        }
        for (player.mouse_ctx.button_states) |state| {
            try std.testing.expectEqual(0, state);
        }
        try std.testing.expectEqual(0, player.mouse_ctx.x);
        try std.testing.expectEqual(0, player.mouse_ctx.y);
    }
}

test "tick advances single frame" {
    var ctx = try TestSimContext.init(std.testing.allocator);
    ctx.wireListeners();
    defer ctx.deinit();

    try std.testing.expectEqual(0, ctx.sim.time.frame);
    try std.testing.expectEqual(0, ctx.sim.time.total_ms);

    ctx.sim.tick(false);
    try std.testing.expectEqual(1, ctx.sim.time.frame);
    try std.testing.expectEqual(hz, ctx.sim.time.dt_ms);
    try std.testing.expectEqual(hz, ctx.sim.time.total_ms);

    ctx.sim.tick(false);
    try std.testing.expectEqual(2, ctx.sim.time.frame);
    try std.testing.expectEqual(hz * 2, ctx.sim.time.total_ms);
}

test "tick calls systems callback" {
    const TestState = struct {
        var call_count: u32 = 0;
        var last_dt: u32 = 0;

        fn systems(_: usize, dt: u32) void {
            call_count += 1;
            last_dt = dt;
        }

        fn reset() void {
            call_count = 0;
            last_dt = 0;
        }
    };

    TestState.reset();

    var ctx = try TestSimContext.init(std.testing.allocator);
    ctx.wireListeners();
    defer ctx.deinit();
    ctx.sim.callbacks.systems = TestState.systems;

    ctx.sim.tick(false);
    try std.testing.expectEqual(1, TestState.call_count);
    try std.testing.expectEqual(hz, TestState.last_dt);

    ctx.sim.tick(false);
    try std.testing.expectEqual(2, TestState.call_count);
}

test "tick processes events and updates input state" {
    var ctx = try TestSimContext.init(std.testing.allocator);
    ctx.wireListeners();
    defer ctx.deinit();

    // Key should not be down initially
    try std.testing.expectEqual(0, ctx.sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)]);

    // Emit keydown and tick
    ctx.emit_keydown(.KeyA, 0);
    ctx.sim.tick(false);

    // Key should now be down (bit 0 set)
    try std.testing.expectEqual(1, ctx.sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);

    // Events should be flushed after tick
    try std.testing.expectEqual(0, ctx.sim.events.count);
}

test "tick ages input states" {
    var ctx = try TestSimContext.init(std.testing.allocator);
    ctx.wireListeners();
    defer ctx.deinit();

    // Press key and tick
    ctx.emit_keydown(.KeyA, 0);
    ctx.sim.tick(false);

    // Key state should be 0b1 (just pressed this frame)
    const state1 = ctx.sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)];
    try std.testing.expectEqual(0b1, state1);

    // Tick again (key still held - no new event, but held bit carries forward)
    ctx.sim.tick(false);

    // Key state should be 0b11 (held for 2 frames - aged once, still held)
    const state2 = ctx.sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)];
    try std.testing.expectEqual(0b11, state2);

    // Release key and tick
    ctx.emit_keyup(.KeyA, 0);
    ctx.sim.tick(false);

    // Key state should be 0b110 (was held for 2 frames, now released)
    const state3 = ctx.sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)];
    try std.testing.expectEqual(0b110, state3);
}

test "take_snapshot captures time state" {
    var ctx = try TestSimContext.init(std.testing.allocator);
    ctx.wireListeners();
    defer ctx.deinit();

    // Advance a few frames
    ctx.sim.tick(false);
    ctx.sim.tick(false);
    ctx.sim.tick(false);

    const snapshot = try ctx.sim.take_snapshot(0);
    defer snapshot.deinit(std.testing.allocator);

    try std.testing.expectEqual(3, snapshot.time.frame);
    try std.testing.expectEqual(hz * 3, snapshot.time.total_ms);
}

test "restore restores time state" {
    var ctx = try TestSimContext.init(std.testing.allocator);
    ctx.wireListeners();
    defer ctx.deinit();

    // Advance and snapshot
    ctx.sim.tick(false);
    ctx.sim.tick(false);
    const snapshot = try ctx.sim.take_snapshot(0);
    defer snapshot.deinit(std.testing.allocator);

    // Advance more
    ctx.sim.tick(false);
    ctx.sim.tick(false);
    ctx.sim.tick(false);
    try std.testing.expectEqual(5, ctx.sim.time.frame);

    // Restore
    ctx.sim.restore(snapshot, true);
    try std.testing.expectEqual(2, ctx.sim.time.frame);
    try std.testing.expectEqual(hz * 2, ctx.sim.time.total_ms);
}

test "snapshot preserves input state" {
    var ctx = try TestSimContext.init(std.testing.allocator);
    ctx.wireListeners();
    defer ctx.deinit();

    // Set up some input state
    ctx.emit_keydown(.KeyA, 0);
    ctx.emit_mousemove(100.0, 200.0, 0);
    ctx.sim.tick(false);

    const snapshot = try ctx.sim.take_snapshot(0);
    defer snapshot.deinit(std.testing.allocator);

    // Modify input state
    ctx.emit_keyup(.KeyA, 0);
    ctx.emit_mousemove(999.0, 999.0, 0);
    ctx.sim.tick(false);

    // Verify state changed
    try std.testing.expectEqual(0, ctx.sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);

    // Restore
    ctx.sim.restore(snapshot, true);

    // Verify input state restored
    try std.testing.expectEqual(1, ctx.sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);
    try std.testing.expectEqual(100.0, ctx.sim.inputs.players[0].mouse_ctx.x);
    try std.testing.expectEqual(200.0, ctx.sim.inputs.players[0].mouse_ctx.y);
}
