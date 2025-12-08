const std = @import("std");
const Ctx = @import("context.zig");
const Events = @import("events.zig");
const Tapes = @import("tapes.zig");
const Rollback = @import("rollback.zig");

const TimeCtx = Ctx.TimeCtx;
const InputCtx = Ctx.InputCtx;
const Event = Events.Event;
const EventBuffer = Events.EventBuffer;
const RollbackState = Rollback.RollbackState;

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
};

pub const Sim = struct {
    time: *TimeCtx,
    inputs: *InputCtx,
    events: *EventBuffer,
    tape: ?Tapes.Tape = null,
    accumulator: u32 = 0,
    is_recording: bool = false,
    is_replaying: bool = false,
    callbacks: Callbacks = .{},
    allocator: std.mem.Allocator,
    /// Pointer to context data passed to callbacks (for JS interop)
    ctx_ptr: usize,
    /// Rollback state (null if not in a session)
    rollback: ?RollbackState = null,
    /// User data length for snapshots (cached from last snapshot)
    user_data_len: u32 = 0,

    /// Initialize a new simulation with allocated contexts
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

        return Sim{
            .time = time,
            .inputs = inputs,
            .events = events,
            .allocator = allocator,
            .ctx_ptr = ctx_ptr,
        };
    }

    test "Sim init and deinit" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        // Verify initial state
        try std.testing.expectEqual(0, sim.time.frame);
        try std.testing.expectEqual(0, sim.time.dt_ms);
        try std.testing.expectEqual(0, sim.time.total_ms);
        try std.testing.expectEqual(0, sim.events.count);
        try std.testing.expectEqual(false, sim.is_recording);
        try std.testing.expectEqual(false, sim.is_replaying);
        try std.testing.expectEqual(null, sim.tape);
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

    /// Free all simulation resources
    pub fn deinit(self: *Sim) void {
        if (self.rollback) |*r| {
            r.deinit();
            self.rollback = null;
        }
        if (self.tape) |*t| {
            t.free(self.allocator);
            self.tape = null;
        }
        self.allocator.destroy(self.time);
        self.allocator.destroy(self.inputs);
        self.allocator.destroy(self.events);
    }

    // ─────────────────────────────────────────────────────────────
    // Session / Rollback
    // ─────────────────────────────────────────────────────────────

    /// Initialize a multiplayer session with rollback support
    /// Captures current frame as session_start_frame
    pub fn sessionInit(self: *Sim, peer_count: u8, user_data_len: u32) !void {
        // Clean up existing session if any
        if (self.rollback) |*r| {
            r.deinit();
        }

        self.user_data_len = user_data_len;
        self.rollback = RollbackState.init(self.allocator, self.time.frame, peer_count);

        // Take initial confirmed snapshot at frame 0
        const snap = try self.take_snapshot(user_data_len);
        self.rollback.?.confirmed_snapshot = snap;
    }

    /// End the current session
    pub fn sessionEnd(self: *Sim) void {
        if (self.rollback) |*r| {
            r.deinit();
            self.rollback = null;
        }
    }

    /// Emit inputs for a peer at a given match frame
    pub fn sessionEmitInputs(self: *Sim, peer: u8, match_frame: u32, events: []const Event) void {
        if (self.rollback) |*r| {
            r.emitInputs(peer, match_frame, events);
        }
    }

    /// Get current match frame (0 if no session)
    pub fn getMatchFrame(self: *const Sim) u32 {
        if (self.rollback) |r| {
            return r.getMatchFrame(self.time.frame);
        }
        return 0;
    }

    /// Get confirmed frame (0 if no session)
    pub fn getConfirmedFrame(self: *const Sim) u32 {
        if (self.rollback) |r| {
            return r.confirmed_frame;
        }
        return 0;
    }

    /// Get confirmed frame for a specific peer
    pub fn getPeerFrame(self: *const Sim, peer: u8) u32 {
        if (self.rollback) |r| {
            if (peer < r.peer_count) {
                return r.peer_confirmed_frame[peer];
            }
        }
        return 0;
    }

    /// Get rollback depth (match_frame - confirmed_frame)
    pub fn getRollbackDepth(self: *const Sim) u32 {
        if (self.rollback) |r| {
            const match_frame = r.getMatchFrame(self.time.frame);
            return match_frame - r.confirmed_frame;
        }
        return 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Time stepping
    // ─────────────────────────────────────────────────────────────

    /// Advance simulation by `ms` milliseconds, returns number of frames stepped
    /// If in a session, handles rollback/resimulation when late inputs arrive
    pub fn step(self: *Sim, ms: u32) u32 {
        self.accumulator += ms;

        var step_count: u32 = 0;
        while (self.accumulator >= hz) {
            // Notify host before each simulation step
            if (self.callbacks.before_frame) |before_frame| {
                before_frame(self.time.frame);
            }

            // If in a session, handle rollback
            if (self.rollback != null) {
                self.sessionStep();
            } else {
                self.tick();
            }

            step_count += 1;
            self.accumulator -= hz;
        }
        return step_count;
    }

    /// Session-aware step that handles rollback when late inputs arrive
    fn sessionStep(self: *Sim) void {
        var r = &self.rollback.?;

        // The frame we're about to process (after this tick, match_frame will be this value)
        const target_match_frame = r.getMatchFrame(self.time.frame) + 1;

        // Calculate how many frames can be confirmed based on received inputs
        const next_confirm = r.calculateNextConfirmFrame(target_match_frame);

        if (next_confirm > r.confirmed_frame) {
            // New confirmed frames available - need to rollback and resim
            const rollback_depth = target_match_frame - 1 - r.confirmed_frame;
            if (rollback_depth > 0) {
                r.stats.last_rollback_depth = rollback_depth;
                r.stats.total_rollbacks += 1;
            }

            // 1. Restore to confirmed state
            if (r.confirmed_snapshot) |snap| {
                self.restore(snap);
            }

            // 2. Resim confirmed frames with all peer inputs
            var f = r.confirmed_frame + 1;
            while (f <= next_confirm) : (f += 1) {
                self.injectInputsForFrame(f);
                self.tick();
                if (f < target_match_frame) {
                    r.stats.frames_resimulated += 1;
                }
            }

            // 3. Update confirmed snapshot
            if (r.confirmed_snapshot) |old_snap| {
                old_snap.deinit(self.allocator);
            }
            r.confirmed_snapshot = self.take_snapshot(self.user_data_len) catch null;
            r.confirmed_frame = next_confirm;

            // 4. If we haven't reached target_match_frame yet, predict forward
            if (next_confirm < target_match_frame) {
                f = next_confirm + 1;
                while (f <= target_match_frame) : (f += 1) {
                    self.injectInputsForFrame(f);
                    self.tick();
                    if (f < target_match_frame) {
                        r.stats.frames_resimulated += 1;
                    }
                }
            }
        } else {
            // No rollback needed - just tick with current frame's inputs
            self.injectInputsForFrame(target_match_frame);
            self.tick();
        }
    }

    /// Inject stored inputs for a specific match frame into the event buffer
    fn injectInputsForFrame(self: *Sim, match_frame: u32) void {
        const r = &self.rollback.?;
        for (0..r.peer_count) |peer_idx| {
            const peer: u8 = @intCast(peer_idx);
            const events = r.getInputs(peer, match_frame);
            for (events) |event| {
                self.append_event(event);
            }
        }
    }

    /// Run a single simulation frame without accumulator management.
    /// Use this for rollback resimulation to avoid re-entrancy issues with step().
    pub fn tick(self: *Sim) void {
        // Age input states at the start of each frame (all players)
        self.inputs.age_all_states();

        self.time.dt_ms = hz;
        self.time.total_ms += hz;

        // If replaying and not at end of tape, use tape events
        if (self.is_replaying) {
            if (self.tape) |*t| {
                if (self.time.frame < t.frame_count() -| 1) {
                    self.use_tape_events();
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

        // Advance tape frame if recording (not replaying)
        if (self.is_recording and !self.is_replaying) {
            if (self.tape) |*t| {
                t.start_frame() catch {
                    @panic("Failed to advance tape frame");
                };
            }
        }
    }

    test "step advances frames based on accumulator" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        // 16ms = 1 frame (at 60hz, hz = 16)
        const count1 = sim.step(16);
        try std.testing.expectEqual(1, count1);
        try std.testing.expectEqual(1, sim.time.frame);

        // 32ms = 2 frames
        const count2 = sim.step(32);
        try std.testing.expectEqual(2, count2);
        try std.testing.expectEqual(3, sim.time.frame);

        // 8ms = 0 frames (accumulates)
        const count3 = sim.step(8);
        try std.testing.expectEqual(0, count3);
        try std.testing.expectEqual(3, sim.time.frame);

        // 8ms more = 1 frame (8 + 8 = 16)
        const count4 = sim.step(8);
        try std.testing.expectEqual(1, count4);
        try std.testing.expectEqual(4, sim.time.frame);
    }

    test "tick advances single frame" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        try std.testing.expectEqual(0, sim.time.frame);
        try std.testing.expectEqual(0, sim.time.total_ms);

        sim.tick();
        try std.testing.expectEqual(1, sim.time.frame);
        try std.testing.expectEqual(hz, sim.time.dt_ms);
        try std.testing.expectEqual(hz, sim.time.total_ms);

        sim.tick();
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

        sim.tick();
        try std.testing.expectEqual(1, TestState.call_count);
        try std.testing.expectEqual(hz, TestState.last_dt);

        sim.tick();
        try std.testing.expectEqual(2, TestState.call_count);
    }

    test "step calls before_frame callback" {
        const TestState = struct {
            var frames_seen: [4]u32 = .{ 0, 0, 0, 0 };
            var idx: usize = 0;

            fn before_frame(frame: u32) void {
                if (idx < 4) {
                    frames_seen[idx] = frame;
                    idx += 1;
                }
            }

            fn reset() void {
                frames_seen = .{ 0, 0, 0, 0 };
                idx = 0;
            }
        };

        TestState.reset();

        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();
        sim.callbacks.before_frame = TestState.before_frame;

        _ = sim.step(48); // 3 frames
        try std.testing.expectEqual(3, TestState.idx);
        try std.testing.expectEqual(0, TestState.frames_seen[0]);
        try std.testing.expectEqual(1, TestState.frames_seen[1]);
        try std.testing.expectEqual(2, TestState.frames_seen[2]);
    }

    test "tick processes events and updates input state" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        // Key should not be down initially
        try std.testing.expectEqual(0, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)]);

        // Emit keydown and tick
        sim.emit_keydown(.KeyA, .LocalKeyboard);
        sim.tick();

        // Key should now be down (bit 0 set)
        try std.testing.expectEqual(1, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);

        // Events should be flushed after tick
        try std.testing.expectEqual(0, sim.events.count);
    }

    test "tick ages input states" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        // Press key and tick
        sim.emit_keydown(.KeyA, .LocalKeyboard);
        sim.tick();

        // Key state should be 0b1 (just pressed this frame)
        const state1 = sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)];
        try std.testing.expectEqual(0b1, state1);

        // Tick again (key still held - no new event, but held bit carries forward)
        sim.tick();

        // Key state should be 0b11 (held for 2 frames - aged once, still held)
        const state2 = sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)];
        try std.testing.expectEqual(0b11, state2);

        // Release key and tick
        sim.emit_keyup(.KeyA, .LocalKeyboard);
        sim.tick();

        // Key state should be 0b110 (was held for 2 frames, now released)
        const state3 = sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)];
        try std.testing.expectEqual(0b110, state3);
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

    fn use_tape_events(self: *Sim) void {
        if (self.tape) |*t| {
            const tape_events = t.get_events(self.time.frame);
            self.events.count = std.math.cast(u16, tape_events.len) orelse {
                @panic("Too many events in tape for event buffer");
            };
            for (tape_events, 0..) |event, idx| {
                self.events.events[idx] = event;
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Event emission
    // ─────────────────────────────────────────────────────────────

    /// Emit an event to be processed this frame
    pub fn emit_event(self: *Sim, event: Event) void {
        self.append_event(event);
    }

    pub fn emit_keydown(self: *Sim, key: Events.Key, source: Events.InputSource) void {
        self.append_event(Event.keyDown(key, source));
    }

    pub fn emit_keyup(self: *Sim, key: Events.Key, source: Events.InputSource) void {
        self.append_event(Event.keyUp(key, source));
    }

    pub fn emit_mousedown(self: *Sim, button: Events.MouseButton, source: Events.InputSource) void {
        self.append_event(Event.mouseDown(button, source));
    }

    pub fn emit_mouseup(self: *Sim, button: Events.MouseButton, source: Events.InputSource) void {
        self.append_event(Event.mouseUp(button, source));
    }

    pub fn emit_mousemove(self: *Sim, x: f32, y: f32, source: Events.InputSource) void {
        self.append_event(Event.mouseMove(x, y, source));
    }

    pub fn emit_mousewheel(self: *Sim, delta_x: f32, delta_y: f32, source: Events.InputSource) void {
        self.append_event(Event.mouseWheel(delta_x, delta_y, source));
    }

    fn append_event(self: *Sim, event: Event) void {
        // Record to tape if recording
        if (self.is_recording) {
            if (self.tape) |*t| {
                t.append_event(event) catch @panic("Failed to record event");
            }
        }

        // Add to event buffer
        const idx = self.events.count;
        if (idx < Events.MAX_EVENTS) {
            self.events.count += 1;
            self.events.events[idx] = event;
        } else {
            @panic("Event buffer full. Have you called flush?");
        }
    }

    test "emit_keydown adds event to buffer" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        try std.testing.expectEqual(0, sim.events.count);

        sim.emit_keydown(.KeyA, .LocalKeyboard);
        try std.testing.expectEqual(1, sim.events.count);
        try std.testing.expectEqual(.KeyDown, sim.events.events[0].kind);
        try std.testing.expectEqual(.KeyA, sim.events.events[0].payload.key);
        try std.testing.expectEqual(.LocalKeyboard, sim.events.events[0].source);

        sim.emit_keyup(.KeyA, .LocalKeyboard);
        try std.testing.expectEqual(2, sim.events.count);
        try std.testing.expectEqual(.KeyUp, sim.events.events[1].kind);
    }

    test "emit_mousemove adds event to buffer" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        sim.emit_mousemove(100.5, 200.5, .LocalMouse);
        try std.testing.expectEqual(1, sim.events.count);
        try std.testing.expectEqual(.MouseMove, sim.events.events[0].kind);
        try std.testing.expectEqual(100.5, sim.events.events[0].payload.mouse_move.x);
        try std.testing.expectEqual(200.5, sim.events.events[0].payload.mouse_move.y);
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

        if (snap.user_data_len > 0) {
            if (self.callbacks.user_serialize) |serialize| {
                serialize(@intFromPtr(snap.user_data().ptr), snap.user_data_len);
            }
        }

        return snap;
    }

    /// Restore state from a snapshot
    pub fn restore(self: *Sim, snapshot: *Tapes.Snapshot) void {
        @memcpy(std.mem.asBytes(self.time), std.mem.asBytes(&snapshot.time));
        @memcpy(std.mem.asBytes(self.inputs), std.mem.asBytes(&snapshot.inputs));
        @memcpy(std.mem.asBytes(self.events), std.mem.asBytes(&snapshot.events));

        if (snapshot.user_data_len > 0) {
            if (self.callbacks.user_deserialize) |deserialize| {
                deserialize(@intFromPtr(snapshot.user_data().ptr), snapshot.user_data_len);
            }
        }
    }

    test "take_snapshot captures time state" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        // Advance a few frames
        sim.tick();
        sim.tick();
        sim.tick();

        const snapshot = try sim.take_snapshot(0);
        defer snapshot.deinit(std.testing.allocator);

        try std.testing.expectEqual(3, snapshot.time.frame);
        try std.testing.expectEqual(hz * 3, snapshot.time.total_ms);
    }

    test "restore restores time state" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        // Advance and snapshot
        sim.tick();
        sim.tick();
        const snapshot = try sim.take_snapshot(0);
        defer snapshot.deinit(std.testing.allocator);

        // Advance more
        sim.tick();
        sim.tick();
        sim.tick();
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
        sim.emit_keydown(.KeyA, .LocalKeyboard);
        sim.emit_mousemove(100.0, 200.0, .LocalMouse);
        sim.tick();

        const snapshot = try sim.take_snapshot(0);
        defer snapshot.deinit(std.testing.allocator);

        // Modify input state
        sim.emit_keyup(.KeyA, .LocalKeyboard);
        sim.emit_mousemove(999.0, 999.0, .LocalMouse);
        sim.tick();

        // Verify state changed
        try std.testing.expectEqual(0, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);

        // Restore
        sim.restore(snapshot);

        // Verify input state restored
        try std.testing.expectEqual(1, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);
        try std.testing.expectEqual(100.0, sim.inputs.players[0].mouse_ctx.x);
        try std.testing.expectEqual(200.0, sim.inputs.players[0].mouse_ctx.y);
    }

    // ─────────────────────────────────────────────────────────────
    // Recording / Playback
    // ─────────────────────────────────────────────────────────────

    pub const RecordingError = error{
        AlreadyRecording,
        OutOfMemory,
        TapeError,
    };

    /// Start recording to a new tape
    pub fn start_recording(self: *Sim, user_data_len: u32, max_events: u32) RecordingError!void {
        if (self.is_recording) {
            return RecordingError.AlreadyRecording;
        }

        const snapshot = self.take_snapshot(user_data_len) catch {
            return RecordingError.OutOfMemory;
        };
        defer snapshot.deinit(self.allocator);

        self.tape = Tapes.Tape.init(self.allocator, snapshot, max_events) catch {
            return RecordingError.OutOfMemory;
        };
        self.is_recording = true;

        // Start the first frame
        self.tape.?.start_frame() catch {
            return RecordingError.TapeError;
        };
    }

    /// Stop recording
    pub fn stop_recording(self: *Sim) void {
        self.is_recording = false;
    }

    /// Load a tape from raw bytes (enters replay mode)
    pub fn load_tape(self: *Sim, tape_buf: []u8) !void {
        if (self.is_recording) {
            return error.CurrentlyRecording;
        }

        // Make a copy of the tape buffer
        const copy = try self.allocator.alloc(u8, tape_buf.len);
        @memcpy(copy, tape_buf);

        self.tape = try Tapes.Tape.load(copy);
        self.is_replaying = true;
    }

    /// Get the current tape buffer (for serialization)
    pub fn get_tape_buffer(self: *Sim) ?[]u8 {
        if (self.tape) |*t| {
            return t.get_buffer();
        }
        return null;
    }

    test "start_recording enables recording" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        try std.testing.expectEqual(false, sim.is_recording);
        try std.testing.expectEqual(null, sim.tape);

        try sim.start_recording(0, 1024);

        try std.testing.expectEqual(true, sim.is_recording);
        try std.testing.expect(sim.tape != null);
    }

    test "start_recording fails if already recording" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        try sim.start_recording(0, 1024);

        const result = sim.start_recording(0, 1024);
        try std.testing.expectError(Sim.RecordingError.AlreadyRecording, result);
    }

    test "stop_recording disables recording" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        try sim.start_recording(0, 1024);
        try std.testing.expectEqual(true, sim.is_recording);

        sim.stop_recording();
        try std.testing.expectEqual(false, sim.is_recording);
    }

    test "recording captures events" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        try sim.start_recording(0, 1024);

        sim.emit_keydown(.KeyA, .LocalKeyboard);
        sim.tick();

        sim.emit_keyup(.KeyA, .LocalKeyboard);
        sim.tick();

        // Tape should have recorded the events
        const tape_buf = sim.get_tape_buffer();
        try std.testing.expect(tape_buf != null);
        try std.testing.expect(tape_buf.?.len > 0);
    }

    test "get_tape_buffer returns null without recording" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        try std.testing.expectEqual(null, sim.get_tape_buffer());
    }

    // ─────────────────────────────────────────────────────────────
    // Seek
    // ─────────────────────────────────────────────────────────────

    /// Seek to the start of a given frame (requires tape)
    pub fn seek(self: *Sim, frame: u32) void {
        if (self.tape == null) {
            @panic("Tried to seek to frame without an active tape");
        }

        const snapshot = self.tape.?.closest_snapshot(frame);
        self.restore(snapshot);

        // Enter replay mode for resimulation
        self.is_replaying = true;
        defer {
            self.is_replaying = false;
        }

        // Advance to the desired frame
        while (self.time.frame < frame) {
            const tape_events = self.tape.?.get_events(self.time.frame);
            self.events.count = std.math.cast(u16, tape_events.len) orelse {
                @panic("Too many events in tape for event buffer");
            };
            for (tape_events, 0..) |event, idx| {
                self.events.events[idx] = event;
            }
            const count = self.step(hz);
            if (count == 0) {
                @panic("Failed to advance frame during seek");
            }
        }
    }

    test "Sim.seek restores to target frame" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        // Start recording
        try sim.start_recording(0, 1024);

        // Advance a few frames with input
        sim.emit_keydown(.KeyA, .LocalKeyboard);
        sim.tick(); // frame 1
        sim.tick(); // frame 2
        sim.emit_keyup(.KeyA, .LocalKeyboard);
        sim.tick(); // frame 3
        sim.tick(); // frame 4
        sim.tick(); // frame 5

        try std.testing.expectEqual(5, sim.time.frame);

        // Seek back to frame 2
        sim.seek(2);

        try std.testing.expectEqual(2, sim.time.frame);
        try std.testing.expectEqual(hz * 2, sim.time.total_ms);
    }

    test "Sim.seek replays events correctly" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        // Start recording
        try sim.start_recording(0, 1024);

        // Frame 0->1: press A
        sim.emit_keydown(.KeyA, .LocalKeyboard);
        sim.tick();

        // Frame 1->2: hold A
        sim.tick();

        // Frame 2->3: release A
        sim.emit_keyup(.KeyA, .LocalKeyboard);
        sim.tick();

        // At frame 3, key A should be released
        try std.testing.expectEqual(0, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);

        // Seek back to frame 2 (before release)
        sim.seek(2);

        // At frame 2, key A should still be held
        try std.testing.expectEqual(1, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);
    }

    // ─────────────────────────────────────────────────────────────
    // Session/Rollback tests
    // ─────────────────────────────────────────────────────────────

    test "sessionInit creates rollback state" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        // Advance a few frames first
        _ = sim.step(32); // 2 frames
        try std.testing.expectEqual(@as(u32, 2), sim.time.frame);

        // Initialize session with 2 peers
        try sim.sessionInit(2, 0);

        // Verify rollback state was created
        try std.testing.expect(sim.rollback != null);
        try std.testing.expectEqual(@as(u32, 2), sim.rollback.?.session_start_frame);
        try std.testing.expectEqual(@as(u8, 2), sim.rollback.?.peer_count);
        try std.testing.expectEqual(@as(u32, 0), sim.rollback.?.confirmed_frame);
        try std.testing.expect(sim.rollback.?.confirmed_snapshot != null);
    }

    test "session step without rollback (inputs in sync)" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        try sim.sessionInit(2, 0);

        // Emit inputs for both peers at match frame 1 (in sync)
        const events0 = [_]Event{Event.keyDown(.KeyA, .LocalKeyboard)};
        const events1 = [_]Event{Event.keyDown(.KeyW, .LocalKeyboard)};
        sim.sessionEmitInputs(0, 1, &events0);
        sim.sessionEmitInputs(1, 1, &events1);

        // Step once - should not trigger rollback
        _ = sim.step(16);

        try std.testing.expectEqual(@as(u32, 1), sim.getMatchFrame());
        try std.testing.expectEqual(@as(u32, 1), sim.getConfirmedFrame());
        try std.testing.expectEqual(@as(u32, 0), sim.getRollbackDepth());
        try std.testing.expectEqual(@as(u32, 0), sim.rollback.?.stats.total_rollbacks);
    }

    test "session step with rollback (late inputs)" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        try sim.sessionInit(2, 0);

        // Peer 0 emits inputs at frames 1, 2, 3
        sim.sessionEmitInputs(0, 1, &[_]Event{Event.keyDown(.KeyA, .LocalKeyboard)});
        sim.sessionEmitInputs(0, 2, &[_]Event{});
        sim.sessionEmitInputs(0, 3, &[_]Event{});

        // Peer 1 only has inputs up to frame 1
        sim.sessionEmitInputs(1, 1, &[_]Event{Event.keyDown(.KeyW, .LocalKeyboard)});

        // Step 3 frames - peer 1 is lagging
        _ = sim.step(16); // frame 1 - both have inputs, confirm to 1
        _ = sim.step(16); // frame 2 - peer 1 lagging, predict
        _ = sim.step(16); // frame 3 - peer 1 still lagging, predict

        try std.testing.expectEqual(@as(u32, 3), sim.getMatchFrame());
        try std.testing.expectEqual(@as(u32, 1), sim.getConfirmedFrame());
        try std.testing.expectEqual(@as(u32, 2), sim.getRollbackDepth());

        // Now peer 1 catches up with inputs for frames 2 and 3
        sim.sessionEmitInputs(1, 2, &[_]Event{});
        sim.sessionEmitInputs(1, 3, &[_]Event{});

        // Step once more - should trigger rollback
        sim.sessionEmitInputs(0, 4, &[_]Event{});
        sim.sessionEmitInputs(1, 4, &[_]Event{});
        _ = sim.step(16);

        try std.testing.expectEqual(@as(u32, 4), sim.getMatchFrame());
        try std.testing.expectEqual(@as(u32, 4), sim.getConfirmedFrame());
        try std.testing.expectEqual(@as(u32, 0), sim.getRollbackDepth());
        try std.testing.expect(sim.rollback.?.stats.total_rollbacks > 0);
    }

    test "sessionEnd cleans up rollback state" {
        var sim = try Sim.init(std.testing.allocator, 0);
        defer sim.deinit();

        try sim.sessionInit(2, 0);
        try std.testing.expect(sim.rollback != null);

        sim.sessionEnd();
        try std.testing.expect(sim.rollback == null);
    }
};

// Force test discovery for tests inside Sim struct
comptime {
    _ = Sim;
}
