const std = @import("std");
const Ctx = @import("context.zig");
const Events = @import("events.zig");
const Tapes = @import("tapes/tapes.zig");
const Transport = @import("netcode/transport.zig");
const Log = @import("log.zig");
const IB = @import("input_buffer.zig");
const VCR = @import("tapes/vcr.zig").VCR;
const Ses = @import("netcode/session.zig");
const Session = Ses.Session;

const TimeCtx = Ctx.TimeCtx;
const InputCtx = Ctx.InputCtx;
const NetCtx = Ctx.NetCtx;
const Event = Events.Event;
const EventBuffer = Events.EventBuffer;
const NetState = Transport.NetState;
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

pub const Sim = struct {
    time: *TimeCtx,
    inputs: *InputCtx,
    events: *EventBuffer,
    vcr: VCR,
    accumulator: u32 = 0,
    callbacks: Callbacks = .{},
    allocator: std.mem.Allocator,
    /// Pointer to context data passed to callbacks (for JS interop)
    ctx_ptr: usize,
    /// Canonical input buffer - single source of truth for all inputs
    input_buffer: *InputBuffer,
    /// Network state for packet management (heap-allocated due to ~68KB size)
    net: *NetState,
    /// Network context exposed to game systems via DataView
    net_ctx: *NetCtx,

    // ─────────────────────────────────────────────────────────────
    // Session state
    // ─────────────────────────────────────────────────────────────
    session: Session = .{},
    /// Confirmed snapshot for rollback (requires allocator, so stays in Sim)
    confirmed_snapshot: ?*Tapes.Snapshot = null,

    // ─────────────────────────────────────────────────────────────
    // Tape Observer
    // ─────────────────────────────────────────────────────────────

    /// Observer callback for InputBuffer - records local peer inputs to tape.
    /// Called immediately when input is emitted (on receive, not on confirm).
    fn tapeInputObserver(ctx: *anyopaque, peer: u8, _: u32, event: Event) void {
        const self: *Sim = @ptrCast(@alignCast(ctx));

        // Only record local peer's inputs - remote inputs come from packet replay
        if (peer != self.session.local_peer_id) return;

        // Only record if we're recording and not replaying
        if (!self.vcr.is_recording or self.vcr.is_replaying) return;

        if (!self.vcr.recordEvent(event)) {
            // Tape is full - stop recording gracefully
            self.stop_recording();
            if (self.callbacks.on_tape_full) |on_tape_full| {
                on_tape_full();
            } else {
                Log.log("Tape full, recording stopped (no onTapeFull callback registered)", .{});
            }
        }
    }

    /// Wire up the tape observer to the InputBuffer
    fn enableTapeObserver(self: *Sim) void {
        self.input_buffer.observer = IB.InputObserver{
            .callback = tapeInputObserver,
            .context = @ptrCast(self),
        };
    }

    /// Disable the tape observer
    fn disableTapeObserver(self: *Sim) void {
        self.input_buffer.observer = null;
    }

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

        // Allocate canonical InputBuffer (single source of truth for all inputs)
        const input_buffer = try allocator.create(InputBuffer);
        input_buffer.* = .{};
        // Default: MAX_PEERS to support local multiplayer testing (session mode will reinit)
        input_buffer.init(IB.MAX_PEERS, 0);

        // Allocate NetState on heap (now much smaller - no unacked_frames copies)
        const net = try allocator.create(NetState);
        net.* = .{ .allocator = allocator, .input_buffer = input_buffer };

        // Allocate NetCtx (small struct exposed to game systems)
        const net_ctx = try allocator.create(NetCtx);
        net_ctx.* = .{ .peer_count = 0, .match_frame = 0 };

        return Sim{
            .time = time,
            .inputs = inputs,
            .events = events,
            .vcr = VCR.init(allocator),
            .input_buffer = input_buffer,
            .net = net,
            .net_ctx = net_ctx,
            .allocator = allocator,
            .ctx_ptr = ctx_ptr,
        };
    }

    /// Free all simulation resources
    pub fn deinit(self: *Sim) void {
        // Clean up confirmed snapshot if any
        if (self.confirmed_snapshot) |snap| {
            snap.deinit(self.allocator);
            self.confirmed_snapshot = null;
        }
        self.allocator.destroy(self.input_buffer);
        self.net.deinit();
        self.allocator.destroy(self.net);
        self.vcr.deinit();
        self.allocator.destroy(self.time);
        self.allocator.destroy(self.inputs);
        self.allocator.destroy(self.events);
        self.allocator.destroy(self.net_ctx);
    }

    // ─────────────────────────────────────────────────────────────
    // Session / Rollback
    // ─────────────────────────────────────────────────────────────

    /// Initialize a multiplayer session with rollback support
    /// Captures current frame as session_start_frame
    pub fn sessionInit(self: *Sim, peer_count_arg: u8, user_data_len: u32) !void {
        // Record session event to tape if recording (but not replaying)
        if (self.vcr.is_recording and !self.vcr.is_replaying) {
            _ = self.vcr.recordEvent(Event.sessionInit(peer_count_arg));
        }

        // Clean up existing confirmed snapshot if any
        if (self.confirmed_snapshot) |snap| {
            snap.deinit(self.allocator);
            self.confirmed_snapshot = null;
        }
        self.net.deinit();

        // Reinitialize InputBuffer for the new session
        // Preserve observer (tape recording) across session init
        const saved_observer = self.input_buffer.observer;
        self.input_buffer.* = .{};
        self.input_buffer.init(peer_count_arg, self.time.frame);
        self.input_buffer.observer = saved_observer;

        // Initialize session state
        self.session.start(self.time.frame, peer_count_arg);

        // Reinitialize net state (references the same InputBuffer)
        self.net.* = .{ .allocator = self.allocator, .input_buffer = self.input_buffer };

        // Update net_ctx for snapshots (captured in take_snapshot)
        self.net_ctx.peer_count = peer_count_arg;
        self.net_ctx.in_session = 1;
        self.net_ctx.session_start_frame = self.time.frame;

        // Take initial confirmed snapshot (after session is active so it's captured)
        const snap = try self.take_snapshot(user_data_len);
        self.confirmed_snapshot = snap;
    }

    /// Get current user data length from callback (or 0 if no callback set)
    fn getUserDataLen(self: *const Sim) u32 {
        if (self.callbacks.user_data_len) |get_len| {
            return get_len();
        }
        return 0;
    }

    /// End the current session
    pub fn sessionEnd(self: *Sim) void {
        // Record session event to tape if recording (but not replaying)
        if (self.vcr.is_recording and !self.vcr.is_replaying) {
            _ = self.vcr.recordEvent(Event.sessionEnd());
        }

        // Clean up confirmed snapshot
        if (self.confirmed_snapshot) |snap| {
            snap.deinit(self.allocator);
            self.confirmed_snapshot = null;
        }

        // Reinitialize InputBuffer for non-session mode
        // Preserve observer (tape recording) across session end
        const saved_observer = self.input_buffer.observer;
        self.input_buffer.* = .{};
        self.input_buffer.init(1, 0);
        self.input_buffer.observer = saved_observer;

        // Reset session state
        self.session.end();

        self.net.deinit();
        self.net.* = .{ .allocator = self.allocator, .input_buffer = self.input_buffer };
        self.net_ctx.in_session = 0;
        self.net_ctx.peer_count = 0;
        self.net_ctx.session_start_frame = 0;
    }

    /// Emit inputs for a peer at a given match frame
    pub fn sessionEmitInputs(self: *Sim, peer: u8, match_frame: u32, events: []const Event) void {
        self.input_buffer.emit(peer, match_frame, events);
    }

    /// Get current match frame (0 if no session)
    pub fn getMatchFrame(self: *const Sim) u32 {
        return self.session.getMatchFrame(self.time.frame);
    }

    /// Get confirmed frame (0 if no session)
    pub fn getConfirmedFrame(self: *const Sim) u32 {
        return self.session.getConfirmedFrame();
    }

    /// Get confirmed frame for a specific peer
    pub fn getPeerFrame(self: *const Sim, peer: u8) u32 {
        if (!self.session.active) return 0;
        if (peer >= IB.MAX_PEERS) return 0;
        return self.input_buffer.peer_confirmed[peer];
    }

    /// Get rollback depth (match_frame - confirmed_frame)
    pub fn getRollbackDepth(self: *const Sim) u32 {
        return self.session.getRollbackDepth(self.time.frame);
    }

    /// Check if session is active
    pub fn inSession(self: *const Sim) bool {
        return self.session.active;
    }

    // ─────────────────────────────────────────────────────────────
    // Network / Packets
    // ─────────────────────────────────────────────────────────────

    /// Set local peer ID for packet encoding
    pub fn setLocalPeer(self: *Sim, peer_id: u8) void {
        // Record session event to tape if recording (but not replaying)
        if (self.vcr.is_recording and !self.vcr.is_replaying) {
            _ = self.vcr.recordEvent(Event.sessionSetLocalPeer(peer_id));
        }

        self.session.setLocalPeer(peer_id);
        self.net.setLocalPeer(peer_id);
        self.net_ctx.local_peer_id = peer_id;
    }

    /// Connect a peer for packet management
    pub fn connectPeer(self: *Sim, peer_id: u8) void {
        // Record session event to tape if recording (but not replaying)
        if (self.vcr.is_recording and !self.vcr.is_replaying) {
            _ = self.vcr.recordEvent(Event.sessionConnectPeer(peer_id));
        }

        self.net.connectPeer(peer_id);
    }

    /// Disconnect a peer
    pub fn disconnectPeer(self: *Sim, peer_id: u8) void {
        // Record session event to tape if recording (but not replaying)
        if (self.vcr.is_recording and !self.vcr.is_replaying) {
            _ = self.vcr.recordEvent(Event.sessionDisconnectPeer(peer_id));
        }

        self.net.disconnectPeer(peer_id);
    }

    /// Build outbound packet for a target peer
    pub fn buildOutboundPacket(self: *Sim, target_peer: u8) void {
        const match_frame: u16 = if (self.session.active)
            @intCast(self.session.getMatchFrame(self.time.frame))
        else
            @intCast(self.time.frame);
        self.net.buildOutboundPacket(target_peer, match_frame) catch {
            Log.log("Failed to build outbound packet for peer {}", .{target_peer});
            @panic("Failed to build outbound packet");
        };
    }

    /// Get pointer to outbound packet buffer
    pub fn getOutboundPacketPtr(self: *const Sim) usize {
        if (self.net.outbound_buffer) |buf| {
            return @intFromPtr(buf.ptr);
        }
        return 0;
    }

    /// Get length of outbound packet
    pub fn getOutboundPacketLen(self: *const Sim) u32 {
        return self.net.outbound_len;
    }

    /// Process a received packet
    pub fn receivePacket(self: *Sim, ptr: usize, len: u32) u8 {
        if (!self.session.active) return 1;

        const buf: [*]const u8 = @ptrFromInt(ptr);
        const slice = buf[0..len];

        // Record packet to tape before processing (capture exact bytes received)
        if (self.vcr.is_recording) {
            // peer_id is at byte[1] in the packet header
            const peer_id: u8 = if (len > 1) slice[1] else 0;
            // Record at current frame - during replay, inject at this frame
            self.vcr.recordPacket(self.time.frame, peer_id, slice);
        }

        self.net.receivePacket(slice, self.input_buffer) catch |e| {
            switch (e) {
                Transport.DecodeError.BufferTooSmall => return 2,
                Transport.DecodeError.UnsupportedVersion => return 3,
                Transport.DecodeError.InvalidEventCount => return 4,
            }
        };
        return 0;
    }

    /// Get seq for a peer (latest frame received from them)
    pub fn getPeerSeq(self: *const Sim, peer: u8) u16 {
        if (peer < Transport.MAX_PEERS) {
            return self.net.peer_states[peer].remote_seq;
        }
        return 0;
    }

    /// Get ack for a peer (latest frame they acked from us)
    pub fn getPeerAck(self: *const Sim, peer: u8) u16 {
        if (peer < Transport.MAX_PEERS) {
            return self.net.peer_states[peer].remote_ack;
        }
        return 0;
    }

    /// Get unacked count for a peer
    pub fn getUnackedCount(self: *const Sim, peer: u8) u16 {
        if (peer < Transport.MAX_PEERS) {
            return self.net.peer_states[peer].unackedCount();
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
            // Replay tape data during replay mode
            if (self.vcr.is_replaying) {
                self.replay_tape_session_events(); // Process session events first
                self.replay_tape_packets(); // Then packets (populates rollback state)
                self.replay_tape_inputs(); // Then input events
            }

            // Notify host before each simulation step
            if (self.callbacks.before_frame) |before_frame| {
                before_frame(self.time.frame);
            }

            // If in a session, handle rollback
            if (self.session.active) {
                self.sessionStep();
            } else {
                self.tick(false); // Non-session: not resimulating, always record
            }

            step_count += 1;
            self.accumulator -= hz;
        }
        return step_count;
    }

    /// Session-aware step that handles rollback when late inputs arrive
    fn sessionStep(self: *Sim) void {
        // The frame we're about to process (after this tick, match_frame will be this value)
        const target_match_frame = self.session.getMatchFrame(self.time.frame) + 1;

        // Calculate how many frames can be confirmed based on received inputs
        const next_confirm = self.input_buffer.calculateNextConfirmFrame(target_match_frame);
        const current_confirmed = self.session.confirmed_frame;

        if (next_confirm > current_confirmed) {
            // New confirmed frames available - need to rollback and resim
            const rollback_depth = target_match_frame - 1 - current_confirmed;
            if (rollback_depth > Transport.MAX_ROLLBACK_FRAMES) {
                @panic("Rollback depth exceeds MAX_ROLLBACK_FRAMES - ring buffer would wrap");
            }

            // 1. Restore to confirmed state
            if (self.confirmed_snapshot) |snap| {
                self.restore(snap);
            }

            // 2. Resim confirmed frames with all peer inputs
            var frames_resimmed: u32 = 0;
            var f = current_confirmed + 1;
            while (f <= next_confirm) : (f += 1) {
                const is_current_frame = (f == target_match_frame);
                self.tick(!is_current_frame); // resimulating unless this is the target frame
                if (!is_current_frame) {
                    frames_resimmed += 1;
                }
            }

            // 3. Update confirmed snapshot (get current user_data_len dynamically)
            if (self.confirmed_snapshot) |old_snap| {
                old_snap.deinit(self.allocator);
            }
            self.confirmed_snapshot = self.take_snapshot(self.getUserDataLen()) catch null;

            // 4. If we haven't reached target_match_frame yet, predict forward
            if (next_confirm < target_match_frame) {
                f = next_confirm + 1;
                while (f <= target_match_frame) : (f += 1) {
                    const is_current_frame = (f == target_match_frame);
                    self.tick(!is_current_frame); // resimulating unless this is the target frame
                    if (!is_current_frame) {
                        frames_resimmed += 1;
                    }
                }
            }

            // Update session with new confirmed frame and stats
            self.session.confirmFrame(next_confirm, frames_resimmed);
        } else {
            // No rollback needed - this is the target frame, not resimulating
            self.tick(false);
        }

        // Always advance local peer's confirmed frame, even if there's no input.
        // Without this, confirmed_frame can't advance if the local player is idle,
        // causing rollback depth to grow unbounded.
        if (target_match_frame > self.input_buffer.peer_confirmed[self.session.local_peer_id]) {
            self.input_buffer.peer_confirmed[self.session.local_peer_id] = target_match_frame;
        }
    }

    /// Run a single simulation frame without accumulator management.
    /// @param is_resimulating: true if this is a resim frame during rollback (don't record to tape),
    ///                         false if this is a new frame being processed (record to tape).
    pub fn tick(self: *Sim, is_resimulating: bool) void {
        // Age input states at the start of each frame (all players)
        self.inputs.age_all_states();

        self.time.dt_ms = hz;
        self.time.total_ms += hz;

        // Calculate match_frame for the frame we're about to process
        const match_frame = if (self.session.active)
            self.session.getMatchFrame(self.time.frame) + 1
        else
            self.time.frame + 1;

        // Read events from canonical InputBuffer for all peers
        // In session mode, use session peer_count; in non-session mode, use InputBuffer peer_count
        const peer_count_for_tick = if (self.session.active) self.session.peer_count else self.input_buffer.peer_count;
        for (0..peer_count_for_tick) |peer_idx| {
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

        // Update net context for game systems to read
        self.net_ctx.peer_count = if (self.session.active) self.session.peer_count else 0;
        self.net_ctx.match_frame = self.getMatchFrame();

        // Call game systems
        if (self.callbacks.systems) |systems| {
            systems(self.ctx_ptr, hz);
        }

        self.time.frame += 1;
        self.flush_events();

        // Advance tape frame if recording a new frame (not replaying or resimulating)
        // Note: Input events are written via observer on emit, this just advances the frame marker
        if (self.vcr.is_recording and !self.vcr.is_replaying and !is_resimulating) {
            if (!self.vcr.advanceFrame()) {
                // Tape is full - stop recording gracefully
                self.stop_recording();
                if (self.callbacks.on_tape_full) |on_tape_full| {
                    on_tape_full();
                } else {
                    Log.log("Tape full, recording stopped (no onTapeFull callback registered)", .{});
                }
            }
        }
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

    /// Replay session lifecycle events from tape for the current frame.
    /// Must be called before replay_tape_packets and replay_tape_inputs.
    fn replay_tape_session_events(self: *Sim) void {
        const tape_events = self.vcr.getEventsForFrame(self.time.frame);
        for (tape_events) |event| {
            switch (event.kind) {
                .SessionInit => {
                    self.sessionInit(event.payload.peer_id, self.getUserDataLen()) catch {};
                },
                .SessionSetLocalPeer => {
                    self.setLocalPeer(event.payload.peer_id);
                },
                .SessionConnectPeer => {
                    self.connectPeer(event.payload.peer_id);
                },
                .SessionDisconnectPeer => {
                    self.disconnectPeer(event.payload.peer_id);
                },
                .SessionEnd => {
                    self.sessionEnd();
                },
                else => {},
            }
        }
    }

    /// Replay packets from tape for the current frame
    fn replay_tape_packets(self: *Sim) void {
        var iter = self.vcr.getPacketsForFrame(self.time.frame) orelse return;
        while (iter.next()) |packet| {
            // Process the packet as if it was just received
            // This will trigger rollback if needed, just like during the original session
            self.net.receivePacket(packet.data, self.input_buffer) catch |e| {
                std.debug.panic("Failed to replay packet at frame {}: {any}", .{ self.time.frame, e });
            };
        }
    }

    /// Replay input events from tape for the current frame.
    /// Routes inputs to InputBuffer (tick reads from there).
    fn replay_tape_inputs(self: *Sim) void {
        const tape_events = self.vcr.getEventsForFrame(self.time.frame);
        for (tape_events) |event| {
            // Skip FrameStart markers and session events
            if (event.kind == .FrameStart or event.kind.isSessionEvent()) continue;

            // Calculate match_frame for the upcoming tick
            const match_frame = if (self.session.active)
                self.session.getMatchFrame(self.time.frame) + 1
            else
                self.time.frame + 1;

            const peer_id = if (self.session.active) self.session.local_peer_id else 0;

            var local_event = event;
            local_event.peer_id = peer_id;

            // Write to InputBuffer - tick will read from there
            self.input_buffer.emit(peer_id, match_frame, &[_]Event{local_event});
        }
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

    /// Append a fresh local event. Writes to canonical InputBuffer (observer handles tape).
    /// Use this for events from live user input (emit_* functions).
    fn append_event(self: *Sim, event: Event) void {
        // Calculate match_frame for the upcoming tick
        const match_frame = if (self.session.active)
            self.session.getMatchFrame(self.time.frame) + 1
        else
            self.time.frame + 1; // Non-session: match_frame = time.frame

        // In session mode, use local_peer_id for network consistency
        // In non-session mode, preserve the event's peer_id for local multiplayer
        const peer_id = if (self.session.active) self.session.local_peer_id else event.peer_id;

        // Tag the event with the resolved peer ID
        var local_event = event;
        local_event.peer_id = peer_id;

        // Write to canonical InputBuffer - observer handles tape recording
        self.input_buffer.emit(peer_id, match_frame, &[_]Event{local_event});

        // If in a session, extend unacked window for packet sending to peers
        // (events are already in InputBuffer - no copy needed)
        if (self.session.active) {
            const match_frame_u16: u16 = @intCast(match_frame);
            self.net.extendUnackedWindow(match_frame_u16);
        }
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

    /// Restore state from a snapshot
    /// If the snapshot was taken during a session (in_session == 1), auto-initializes the session
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

        // Auto-initialize session if snapshot was taken during a session
        if (snapshot.net.in_session == 1 and !self.session.active) {
            // Initialize session state directly with session_start_frame from snapshot
            // (don't use sessionInit which would set session_start_frame = current frame)
            if (self.confirmed_snapshot) |snap| {
                snap.deinit(self.allocator);
                self.confirmed_snapshot = null;
            }
            self.net.deinit();

            // Reinitialize InputBuffer with session state from snapshot
            // Preserve observer (tape recording) across restore
            const saved_observer = self.input_buffer.observer;
            self.input_buffer.* = .{};
            self.input_buffer.init(snapshot.net.peer_count, snapshot.net.session_start_frame);
            self.input_buffer.observer = saved_observer;

            // Initialize session state directly from snapshot
            self.session.start_frame = snapshot.net.session_start_frame;
            self.session.peer_count = snapshot.net.peer_count;
            self.session.local_peer_id = snapshot.net.local_peer_id;
            self.session.confirmed_frame = 0;
            self.session.stats = .{};
            self.session.active = true;

            self.net.* = .{ .allocator = self.allocator, .input_buffer = self.input_buffer };
            self.net.setLocalPeer(snapshot.net.local_peer_id);

            // Take initial confirmed snapshot for rollback
            self.confirmed_snapshot = self.take_snapshot(snapshot.user_data_len) catch null;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Recording / Playback
    // ─────────────────────────────────────────────────────────────

    pub const RecordingError = VCR.RecordingError;

    /// Start recording to a new tape
    pub fn start_recording(self: *Sim, user_data_len: u32, max_events: u32, max_packet_bytes: u32) RecordingError!void {
        const snapshot = self.take_snapshot(user_data_len) catch {
            return RecordingError.OutOfMemory;
        };
        defer snapshot.deinit(self.allocator);

        try self.vcr.startRecording(snapshot, max_events, max_packet_bytes);

        // Enable tape observer to record local inputs
        self.enableTapeObserver();
    }

    /// Stop recording
    pub fn stop_recording(self: *Sim) void {
        self.vcr.stopRecording();
        self.disableTapeObserver();
    }

    /// Load a tape from raw bytes (enters replay mode)
    /// Restores the initial snapshot which will auto-init session if needed
    pub fn load_tape(self: *Sim, tape_buf: []u8) !void {
        const snapshot = try self.vcr.loadTape(tape_buf);
        // Restore initial snapshot from tape - this will auto-init session if net_ctx.in_session is set
        self.restore(snapshot);
    }

    /// Get the current tape buffer (for serialization)
    pub fn get_tape_buffer(self: *Sim) ?[]u8 {
        return self.vcr.getTapeBuffer();
    }

    /// Check if recording is active
    pub fn isRecording(self: *const Sim) bool {
        return self.vcr.is_recording;
    }

    /// Check if replay is active
    pub fn isReplaying(self: *const Sim) bool {
        return self.vcr.is_replaying;
    }

    // ─────────────────────────────────────────────────────────────
    // Seek
    // ─────────────────────────────────────────────────────────────

    /// Seek to the start of a given frame (requires tape)
    pub fn seek(self: *Sim, frame: u32) void {
        if (!self.vcr.hasTape()) {
            @panic("Tried to seek to frame without an active tape");
        }

        const snapshot = self.vcr.closestSnapshot(frame) orelse @panic("No snapshot found for seek");
        self.restore(snapshot);

        // Remember if we were already replaying (from load_tape)
        const was_replaying = self.vcr.is_replaying;

        // Enter replay mode for resimulation
        self.vcr.enterReplayMode();

        // Advance to the desired frame
        // step() handles tape event replay via replay_tape_inputs()
        while (self.time.frame < frame) {
            const count = self.step(hz);
            if (count == 0) {
                @panic("Failed to advance frame during seek");
            }
        }

        // Preserve replay state if we were replaying before (e.g., from load_tape)
        // Only reset if we weren't in replay mode before this seek
        if (!was_replaying) {
            self.vcr.exitReplayMode();
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
    try std.testing.expectEqual(false, sim.vcr.is_recording);
    try std.testing.expectEqual(false, sim.vcr.is_replaying);
    try std.testing.expectEqual(false, sim.vcr.hasTape());
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

test "sessionInit creates rollback state" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Advance a few frames first
    _ = sim.step(32); // 2 frames
    try std.testing.expectEqual(@as(u32, 2), sim.time.frame);

    // Initialize session with 2 peers
    try sim.sessionInit(2, 0);

    // Verify session is active and rollback state was initialized
    try std.testing.expect(sim.session.active);
    try std.testing.expectEqual(@as(u32, 2), sim.session.start_frame);
    try std.testing.expectEqual(@as(u8, 2), sim.session.peer_count);
    try std.testing.expectEqual(@as(u32, 0), sim.session.confirmed_frame);
    try std.testing.expect(sim.confirmed_snapshot != null);
}

test "session step without rollback (inputs in sync)" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    try sim.sessionInit(2, 0);

    // Emit inputs for both peers at match frame 1 (in sync)
    const events0 = [_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)};
    const events1 = [_]Event{Event.keyDown(.KeyW, 0, .LocalKeyboard)};
    sim.sessionEmitInputs(0, 1, &events0);
    sim.sessionEmitInputs(1, 1, &events1);

    // Step once - should not trigger rollback
    _ = sim.step(16);

    try std.testing.expectEqual(@as(u32, 1), sim.getMatchFrame());
    try std.testing.expectEqual(@as(u32, 1), sim.getConfirmedFrame());
    try std.testing.expectEqual(@as(u32, 0), sim.getRollbackDepth());
    try std.testing.expectEqual(@as(u32, 0), sim.session.stats.total_rollbacks);
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

test "session step with rollback (late inputs)" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    try sim.sessionInit(2, 0);

    // Peer 0 emits inputs at frames 1, 2, 3
    sim.sessionEmitInputs(0, 1, &[_]Event{Event.keyDown(.KeyA, 0, .LocalKeyboard)});
    sim.sessionEmitInputs(0, 2, &[_]Event{});
    sim.sessionEmitInputs(0, 3, &[_]Event{});

    // Peer 1 only has inputs up to frame 1
    sim.sessionEmitInputs(1, 1, &[_]Event{Event.keyDown(.KeyW, 0, .LocalKeyboard)});

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
    try std.testing.expect(sim.session.stats.total_rollbacks > 0);
}

test "sessionEnd cleans up rollback state" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    try sim.sessionInit(2, 0);
    try std.testing.expect(sim.session.active);

    sim.sessionEnd();
    try std.testing.expect(!sim.session.active);
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

test "session uses dynamic user_data_len for snapshots" {
    // Test that user_data_len is fetched dynamically at snapshot time,
    // not cached at session init
    const TestState = struct {
        var current_size: u32 = 8;

        fn getUserDataLen() u32 {
            return current_size;
        }

        fn serialize(_: usize, _: u32) void {
            // No-op for this test - we just care about the size
        }

        fn deserialize(_: usize, _: u32) void {
            // No-op for this test
        }
    };

    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Wire up the dynamic size callback
    sim.callbacks.user_data_len = TestState.getUserDataLen;
    sim.callbacks.user_serialize = TestState.serialize;
    sim.callbacks.user_deserialize = TestState.deserialize;

    // Start with size = 8
    TestState.current_size = 8;
    try sim.sessionInit(2, TestState.getUserDataLen());

    // Initial snapshot should have size 8
    try std.testing.expectEqual(@as(u32, 8), sim.confirmed_snapshot.?.user_data_len);

    // Emit inputs for frame 1
    sim.sessionEmitInputs(0, 1, &[_]Event{});
    sim.sessionEmitInputs(1, 1, &[_]Event{});

    // Change size to 16 before stepping
    TestState.current_size = 16;

    // Step - this should take a new snapshot with the updated size
    _ = sim.step(16);

    // The new confirmed snapshot should have the new size
    try std.testing.expectEqual(@as(u32, 16), sim.confirmed_snapshot.?.user_data_len);

    // Change size to 32
    TestState.current_size = 32;

    // Emit inputs and step again
    sim.sessionEmitInputs(0, 2, &[_]Event{});
    sim.sessionEmitInputs(1, 2, &[_]Event{});
    _ = sim.step(16);

    // Snapshot should now have size 32
    try std.testing.expectEqual(@as(u32, 32), sim.confirmed_snapshot.?.user_data_len);
}

test "start_recording enables recording" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    try std.testing.expectEqual(false, sim.vcr.is_recording);
    try std.testing.expectEqual(false, sim.vcr.hasTape());

    try sim.start_recording(0, 1024, 0);

    try std.testing.expectEqual(true, sim.vcr.is_recording);
    try std.testing.expect(sim.vcr.hasTape());
}

test "start_recording fails if already recording" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    try sim.start_recording(0, 1024, 0);

    const result = sim.start_recording(0, 1024, 0);
    try std.testing.expectError(Sim.RecordingError.AlreadyRecording, result);
}

test "stop_recording disables recording" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    try sim.start_recording(0, 1024, 0);
    try std.testing.expectEqual(true, sim.vcr.is_recording);

    sim.stop_recording();
    try std.testing.expectEqual(false, sim.vcr.is_recording);
}

test "recording captures events" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    try sim.start_recording(0, 1024, 0);

    sim.emit_keydown(.KeyA, 0);
    sim.tick(false);

    sim.emit_keyup(.KeyA, 0);
    sim.tick(false);

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

test "Sim.seek restores to target frame" {
    var sim = try Sim.init(std.testing.allocator, 0);
    defer sim.deinit();

    // Start recording
    try sim.start_recording(0, 1024, 0);

    // Advance a few frames with input
    sim.emit_keydown(.KeyA, 0);
    sim.tick(false); // frame 1
    sim.tick(false); // frame 2
    sim.emit_keyup(.KeyA, 0);
    sim.tick(false); // frame 3
    sim.tick(false); // frame 4
    sim.tick(false); // frame 5

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
    try sim.start_recording(0, 1024, 0);

    // Frame 0->1: press A
    sim.emit_keydown(.KeyA, 0);
    sim.tick(false);

    // Frame 1->2: hold A
    sim.tick(false);

    // Frame 2->3: release A
    sim.emit_keyup(.KeyA, 0);
    sim.tick(false);

    // At frame 3, key A should be released
    try std.testing.expectEqual(0, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);

    // Seek back to frame 2 (before release)
    sim.seek(2);

    // At frame 2, key A should still be held
    try std.testing.expectEqual(1, sim.inputs.players[0].key_ctx.key_states[@intFromEnum(Events.Key.KeyA)] & 1);
}
