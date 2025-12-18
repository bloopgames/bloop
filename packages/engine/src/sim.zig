const std = @import("std");
const Ctx = @import("context.zig");
const Events = @import("events.zig");
const Tapes = @import("tapes/tapes.zig");
const IB = @import("input_buffer.zig");
const Ses = @import("netcode/session.zig");

const TimeCtx = Ctx.TimeCtx;
const InputCtx = Ctx.InputCtx;
const NetCtx = Ctx.NetCtx;
const Event = Events.Event;
const EventBuffer = Events.EventBuffer;
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

// Re-export RollbackStats for external access
pub const RollbackStats = Ses.RollbackStats;

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
    /// Canonical input buffer for standalone Sim tests (Engine has its own)
    input_buffer: *InputBuffer,
    /// Network context exposed to game systems via DataView (Engine syncs this)
    net_ctx: *NetCtx,

    // ─────────────────────────────────────────────────────────────
    // Tick Listeners (for Engine coordination)
    // ─────────────────────────────────────────────────────────────
    listeners: TickListeners = .{},

    /// Initialize a new simulation with allocated contexts.
    /// Note: When used with Engine, Engine allocates its own InputBuffer and syncs net_ctx.
    /// This version allocates its own InputBuffer for standalone Sim tests.
    pub fn init(allocator: std.mem.Allocator, ctx_ptr: usize) !Sim {
        // Allocate TimeCtx
        const time = try allocator.create(TimeCtx);
        time.* = TimeCtx{ .frame = 0, .dt_ms = 0, .total_ms = 0 };

        // Allocate InputCtx
        const inputs = try allocator.create(InputCtx);
        @memset(std.mem.asBytes(inputs), 0);

        // Allocate EventBuffer
        const events = try allocator.create(EventBuffer);
        @memset(std.mem.asBytes(events), 0);

        // Allocate InputBuffer for standalone tests (Engine has its own)
        const input_buffer = try allocator.create(InputBuffer);
        input_buffer.* = .{};
        // Default: single peer for simple tests
        input_buffer.init(1, 0);

        // Allocate NetCtx (small struct exposed to game systems)
        const net_ctx = try allocator.create(NetCtx);
        net_ctx.* = .{ .peer_count = 0, .match_frame = 0 };

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

    /// Free all simulation resources
    pub fn deinit(self: *Sim) void {
        self.allocator.destroy(self.input_buffer);
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

    /// Run a single simulation frame without accumulator management.
    /// This is the core frame execution - receives dependencies from Engine.
    /// @param input_buffer: The input buffer to read events from
    /// @param session_active: Whether a session is active
    /// @param match_frame: The match frame to process (pre-calculated by Engine)
    /// @param peer_count: Number of peers to process inputs for
    /// @param is_resimulating: true if this is a resim frame during rollback
    pub fn tickWithDeps(
        self: *Sim,
        input_buffer: *InputBuffer,
        session_active: bool,
        match_frame: u32,
        peer_count: u8,
        is_resimulating: bool,
    ) void {
        // session_active is passed for future use; Engine handles session logic
        _ = session_active;

        // Call before_tick listener (Engine uses this for net_ctx sync)
        if (self.listeners.before_tick) |before_tick| {
            before_tick(self.listeners.context.?);
        }

        // Age input states at the start of each frame (all players)
        self.inputs.age_all_states();

        self.time.dt_ms = hz;
        self.time.total_ms += hz;

        // Read events from InputBuffer for all peers
        for (0..peer_count) |peer_idx| {
            const peer: u8 = @intCast(peer_idx);
            const events = input_buffer.get(peer, match_frame);
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

        // Note: net_ctx is updated by Engine.syncNetCtx() via beforeTickListener

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

    /// Legacy tick() for backwards compatibility with standalone Sim tests.
    /// Assumes non-session mode. Use Engine for session/rollback functionality.
    pub fn tick(self: *Sim, is_resimulating: bool) void {
        // Non-session mode: match_frame = time.frame + 1
        const match_frame = self.time.frame + 1;
        const peer_count = self.input_buffer.peer_count;
        self.tickWithDeps(self.input_buffer, false, match_frame, peer_count, is_resimulating);
    }

    // ─────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────

    fn process_events(self: *Sim) void {
        for (self.events.events[0..self.events.count]) |event| {
            self.inputs.process_event(event);
        }
    }

    fn flush_events(self: *Sim) void {
        self.events.count = 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Event emission
    // ─────────────────────────────────────────────────────────────

    /// Emit an event to be processed this frame
    pub fn emit_event(self: *Sim, event: Event) void {
        self.append_event(event);
    }

    pub fn emit_keydown(self: *Sim, key: Events.Key, peer_id: u8) void {
        self.append_event(Event.keyDown(key, peer_id, .LocalKeyboard));
    }

    pub fn emit_keyup(self: *Sim, key: Events.Key, peer_id: u8) void {
        self.append_event(Event.keyUp(key, peer_id, .LocalKeyboard));
    }

    pub fn emit_mousedown(self: *Sim, button: Events.MouseButton, peer_id: u8) void {
        self.append_event(Event.mouseDown(button, peer_id, .LocalMouse));
    }

    pub fn emit_mouseup(self: *Sim, button: Events.MouseButton, peer_id: u8) void {
        self.append_event(Event.mouseUp(button, peer_id, .LocalMouse));
    }

    pub fn emit_mousemove(self: *Sim, x: f32, y: f32, peer_id: u8) void {
        self.append_event(Event.mouseMove(x, y, peer_id, .LocalMouse));
    }

    pub fn emit_mousewheel(self: *Sim, delta_x: f32, delta_y: f32, peer_id: u8) void {
        self.append_event(Event.mouseWheel(delta_x, delta_y, peer_id, .LocalMouse));
    }

    /// Append a fresh local event. Writes to canonical InputBuffer.
    /// For standalone Sim tests (non-session mode). Engine handles session mode.
    fn append_event(self: *Sim, event: Event) void {
        // Non-session mode: match_frame = time.frame + 1
        const match_frame = self.time.frame + 1;
        // Preserve event's peer_id for local multiplayer
        self.input_buffer.emit(event.peer_id, match_frame, &[_]Event{event});
    }

    // ─────────────────────────────────────────────────────────────
    // Snapshots
    // ─────────────────────────────────────────────────────────────

    /// Take a snapshot of current state
    pub fn take_snapshot(self: *Sim, user_data_len: u32) !*Tapes.Snapshot {
        const snap = try Tapes.Snapshot.init(self.allocator, user_data_len);

        snap.write_time(@intFromPtr(self.time));
        snap.write_inputs(@intFromPtr(self.inputs));
        snap.write_events(@intFromPtr(self.events));
        snap.write_net(@intFromPtr(self.net_ctx));

        if (snap.user_data_len > 0) {
            if (self.callbacks.user_serialize) |serialize| {
                serialize(@intFromPtr(snap.user_data().ptr), snap.user_data_len);
            }
        }

        return snap;
    }

    /// Restore state from a snapshot.
    /// Only restores basic Sim state (time, inputs, events, net_ctx).
    /// Session/rollback state is handled by Engine.
    pub fn restore(self: *Sim, snapshot: *Tapes.Snapshot) void {
        @memcpy(std.mem.asBytes(self.time), std.mem.asBytes(&snapshot.time));
        @memcpy(std.mem.asBytes(self.inputs), std.mem.asBytes(&snapshot.inputs));
        @memcpy(std.mem.asBytes(self.events), std.mem.asBytes(&snapshot.events));
        @memcpy(std.mem.asBytes(self.net_ctx), std.mem.asBytes(&snapshot.net));

        if (snapshot.user_data_len > 0) {
            if (self.callbacks.user_deserialize) |deserialize| {
                deserialize(@intFromPtr(snapshot.user_data().ptr), snapshot.user_data_len);
            }
        }
    }
};

test "Sim init and deinit" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Verify initial state
    try std.testing.expectEqual(0, sim.time.frame);
    try std.testing.expectEqual(0, sim.time.dt_ms);
    try std.testing.expectEqual(0, sim.time.total_ms);
    try std.testing.expectEqual(0, sim.events.count);
}

test "Sim contexts are zeroed" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Verify inputs are zeroed
    for (sim.inputs.players) |player| {
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
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    try std.testing.expectEqual(0, sim.time.frame);
    try std.testing.expectEqual(0, sim.time.total_ms);

    sim.tick(false);
    try std.testing.expectEqual(1, sim.time.frame);
    try std.testing.expectEqual(hz, sim.time.dt_ms);
    try std.testing.expectEqual(hz, sim.time.total_ms);

    sim.tick(false);
    try std.testing.expectEqual(2, sim.time.frame);
    try std.testing.expectEqual(hz * 2, sim.time.total_ms);
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

    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();
    sim.callbacks.systems = TestState.systems;

    sim.tick(false);
    try std.testing.expectEqual(1, TestState.call_count);
    try std.testing.expectEqual(hz, TestState.last_dt);

    sim.tick(false);
    try std.testing.expectEqual(2, TestState.call_count);
}

test "tick processes events and updates input state" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Key should not be down initially
    try std.testing.expectEqual(0, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)]);

    // Emit keydown and tick
    sim.emit_keydown(.KeyA, 0);
    sim.tick(false);

    // Key should now be down (bit 0 set)
    try std.testing.expectEqual(1, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);

    // Events should be flushed after tick
    try std.testing.expectEqual(0, sim.events.count);
}

test "tick ages input states" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Press key and tick
    sim.emit_keydown(.KeyA, 0);
    sim.tick(false);

    // Key state should be 0b1 (just pressed this frame)
    const state1 = sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)];
    try std.testing.expectEqual(0b1, state1);

    // Tick again (key still held - no new event, but held bit carries forward)
    sim.tick(false);

    // Key state should be 0b11 (held for 2 frames - aged once, still held)
    const state2 = sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)];
    try std.testing.expectEqual(0b11, state2);

    // Release key and tick
    sim.emit_keyup(.KeyA, 0);
    sim.tick(false);

    // Key state should be 0b110 (was held for 2 frames, now released)
    const state3 = sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)];
    try std.testing.expectEqual(0b110, state3);
}

test "take_snapshot captures time state" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Advance a few frames
    sim.tick(false);
    sim.tick(false);
    sim.tick(false);

    const snapshot = try sim.take_snapshot(0);
    defer snapshot.deinit(std.testing.allocator);

    try std.testing.expectEqual(3, snapshot.time.frame);
    try std.testing.expectEqual(hz * 3, snapshot.time.total_ms);
}

test "restore restores time state" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Advance and snapshot
    sim.tick(false);
    sim.tick(false);
    const snapshot = try sim.take_snapshot(0);
    defer snapshot.deinit(std.testing.allocator);

    // Advance more
    sim.tick(false);
    sim.tick(false);
    sim.tick(false);
    try std.testing.expectEqual(5, sim.time.frame);

    // Restore
    sim.restore(snapshot);
    try std.testing.expectEqual(2, sim.time.frame);
    try std.testing.expectEqual(hz * 2, sim.time.total_ms);
}

test "snapshot preserves input state" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Set up some input state
    sim.emit_keydown(.KeyA, 0);
    sim.emit_mousemove(100.0, 200.0, 0);
    sim.tick(false);

    const snapshot = try sim.take_snapshot(0);
    defer snapshot.deinit(std.testing.allocator);

    // Modify input state
    sim.emit_keyup(.KeyA, 0);
    sim.emit_mousemove(999.0, 999.0, 0);
    sim.tick(false);

    // Verify state changed
    try std.testing.expectEqual(0, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);

    // Restore
    sim.restore(snapshot);

    // Verify input state restored
    try std.testing.expectEqual(1, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);
    try std.testing.expectEqual(100.0, sim.inputs.players[0].mouse_ctx.x);
    try std.testing.expectEqual(200.0, sim.inputs.players[0].mouse_ctx.y);
}

test "emit_keydown adds event to InputBuffer" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Event buffer is empty until tick
    try std.testing.expectEqual(0, sim.events.count);

    // Emit keydown - goes to InputBuffer at match_frame = time.frame + 1
    sim.emit_keydown(.KeyA, 0);

    // Event buffer still empty (tick hasn't run)
    try std.testing.expectEqual(0, sim.events.count);

    // Check InputBuffer has the event at frame 1 (time.frame=0, so match_frame=1)
    const events = sim.input_buffer.get(0, 1);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    try std.testing.expectEqual(.KeyDown, events[0].kind);
    try std.testing.expectEqual(.KeyA, events[0].payload.key);
    try std.testing.expectEqual(.LocalKeyboard, events[0].device);

    // Emit keyup - also goes to InputBuffer at frame 1
    sim.emit_keyup(.KeyA, 0);
    const events2 = sim.input_buffer.get(0, 1);
    try std.testing.expectEqual(@as(usize, 2), events2.len);
    try std.testing.expectEqual(.KeyUp, events2[1].kind);
}

test "emit_mousemove adds event to InputBuffer" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    sim.emit_mousemove(100.5, 200.5, 0);

    // Check InputBuffer has the event at frame 1
    const events = sim.input_buffer.get(0, 1);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    try std.testing.expectEqual(.MouseMove, events[0].kind);
    try std.testing.expectEqual(100.5, events[0].payload.mouse_move.x);
    try std.testing.expectEqual(200.5, events[0].payload.mouse_move.y);
}
