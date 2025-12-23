// Root module - Engine coordinator and test imports
const std = @import("std");
const SimMod = @import("sim.zig");
const Sim = SimMod.Sim;
const Tapes = @import("tapes/tapes.zig");
const Transport = @import("netcode/transport.zig");
const Events = @import("events.zig");
const IB = @import("input_buffer.zig");
const VCR = @import("tapes/vcr.zig").VCR;
const Ses = @import("netcode/session.zig");
const Log = @import("log.zig");

const Session = Ses.Session;
const InputBuffer = IB.InputBuffer;
const NetState = Transport.NetState;
const Event = Events.Event;

pub const hz = SimMod.hz;

/// Maximum pending network events between frames
const MAX_PENDING_NET_EVENTS: usize = 16;

/// Engine coordinates the simulation, managing timing, sessions, tapes, and network.
/// This is the unit-testable orchestration layer that sits above Sim.
pub const Engine = struct {
    /// The simulation (owns contexts: time, inputs, events, net_ctx)
    sim: *Sim,
    /// Frame timing accumulator
    accumulator: u32 = 0,
    /// Allocator for engine resources
    allocator: std.mem.Allocator,

    // ─────────────────────────────────────────────────────────────
    // Coordination state (moved from Sim)
    // ─────────────────────────────────────────────────────────────
    /// Tape recorder/player
    vcr: VCR,
    /// Multiplayer session state
    session: Session = .{},
    /// Confirmed snapshot for rollback
    confirmed_snapshot: ?*Tapes.Snapshot = null,
    /// Canonical input buffer - single source of truth for all inputs
    input_buffer: *InputBuffer,
    /// Network state for packet management (heap-allocated due to ~68KB size)
    net: *NetState,

    // ─────────────────────────────────────────────────────────────
    // Pending network events (queued until next tick)
    // ─────────────────────────────────────────────────────────────
    /// Network events waiting to be processed in next tick
    pending_net_events: [MAX_PENDING_NET_EVENTS]Event = undefined,
    /// Number of pending network events
    pending_net_events_count: u8 = 0,

    /// Initialize engine with a new simulation
    pub fn init(allocator: std.mem.Allocator, ctx_ptr: usize) !Engine {
        // Allocate canonical InputBuffer (single source of truth for all inputs)
        const input_buffer = try allocator.create(InputBuffer);
        input_buffer.* = .{};
        // Default: MAX_PEERS to support local multiplayer testing (session mode will reinit)
        input_buffer.init(IB.MAX_PEERS, 0);

        // Allocate NetState on heap (now much smaller - no unacked_frames copies)
        const net = try allocator.create(NetState);
        net.* = .{ .allocator = allocator, .input_buffer = input_buffer };

        // Create Sim (slimmed down - only owns contexts, uses Engine's input_buffer)
        const sim = try allocator.create(Sim);
        sim.* = try Sim.init(allocator, ctx_ptr, input_buffer);

        return Engine{
            .sim = sim,
            .allocator = allocator,
            .vcr = VCR.init(allocator),
            .input_buffer = input_buffer,
            .net = net,
        };
    }

    /// Wire up tick listeners after Engine is stored in its final location.
    /// Must be called after init() when Engine is in a stable memory location.
    pub fn wireListeners(self: *Engine) void {
        self.sim.listeners = .{
            .context = @ptrCast(self),
            .before_tick = beforeTickListener,
            .after_tick = afterTickListener,
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Tick Listeners
    // ─────────────────────────────────────────────────────────────

    fn beforeTickListener(ctx: *anyopaque) void {
        const self: *Engine = @ptrCast(@alignCast(ctx));
        // Update sim.net_ctx from Engine's network state before tick processes events
        // Note: Tape replay is handled by Engine.advance() before tick() is called
        self.syncNetCtx();

        // Copy pending network events to sim.events (processed before input events)
        self.flushPendingNetEvents();
    }

    /// Copy pending network events to sim.events and clear the pending buffer
    fn flushPendingNetEvents(self: *Engine) void {
        const pending_count = self.pending_net_events_count;
        if (pending_count == 0) return;

        for (0..pending_count) |i| {
            const idx = self.sim.events.count;
            if (idx < Events.MAX_EVENTS) {
                self.sim.events.count += 1;
                self.sim.events.events[idx] = self.pending_net_events[i];
            }
        }

        self.pending_net_events_count = 0;
    }

    fn afterTickListener(ctx: *anyopaque, is_resimulating: bool) void {
        const self: *Engine = @ptrCast(@alignCast(ctx));

        // Advance tape frame if recording a new frame (not replaying or resimulating)
        if (self.vcr.is_recording and !self.vcr.is_replaying and !is_resimulating) {
            if (!self.vcr.advanceFrame()) {
                // Tape is full - stop recording gracefully
                self.stopRecording();
                if (self.sim.callbacks.on_tape_full) |on_tape_full| {
                    on_tape_full();
                } else {
                    Log.log("Tape full, recording stopped (no onTapeFull callback registered)", .{});
                }
            }
        }
    }

    /// Sync sim.net_ctx from Engine's network state before each tick.
    /// Sets match_frame to the NEXT frame that tick will process (time.frame + 1).
    /// Note: peer_count, status, room_code, and in_session are managed by network events
    /// in process_events(), not here.
    fn syncNetCtx(self: *Engine) void {
        // Calculate the target match_frame for the upcoming tick
        self.sim.net_ctx.match_frame = if (self.session.active)
            self.session.getMatchFrame(self.sim.time.frame) + 1
        else
            self.sim.time.frame + 1;
        self.sim.net_ctx.session_start_frame = self.session.start_frame;
        self.sim.net_ctx.local_peer_id = self.session.local_peer_id;
    }

    // ─────────────────────────────────────────────────────────────
    // Time stepping
    // ─────────────────────────────────────────────────────────────

    /// Advance simulation by `ms` milliseconds, returns number of frames stepped
    /// If in a session, handles rollback/resimulation when late inputs arrive
    pub fn advance(self: *Engine, ms: u32) u32 {
        self.accumulator += ms;

        var step_count: u32 = 0;
        while (self.accumulator >= hz) {
            // Replay tape data during replay mode
            if (self.vcr.is_replaying) {
                self.replayTapeSessionEvents();
                self.replayTapePackets();
                self.replayTapeInputs();
            }

            // Notify host before each simulation step
            if (self.sim.callbacks.before_frame) |before_frame| {
                before_frame(self.sim.time.frame);
            }

            // If in a session, handle rollback
            if (self.session.active) {
                self.sessionStep();
            } else {
                // Non-session mode: beforeTickListener syncs net_ctx
                self.sim.tick(false);
            }

            step_count += 1;
            self.accumulator -= hz;
        }
        return step_count;
    }

    // ─────────────────────────────────────────────────────────────
    // Session management (moved from Sim in Phase 3)
    // ─────────────────────────────────────────────────────────────

    /// Session-aware step that handles rollback when late inputs arrive
    fn sessionStep(self: *Engine) void {
        // The frame we're about to process (after this tick, match_frame will be this value)
        const target_match_frame = self.session.getMatchFrame(self.sim.time.frame) + 1;

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
                self.sim.restore(snap);
            }

            // 2. Resim confirmed frames with all peer inputs
            var frames_resimmed: u32 = 0;
            var f = current_confirmed + 1;
            while (f <= next_confirm) : (f += 1) {
                const is_current_frame = (f == target_match_frame);
                // beforeTickListener syncs net_ctx with correct match_frame
                self.sim.tick(!is_current_frame);
                if (!is_current_frame) {
                    frames_resimmed += 1;
                }
            }

            // 3. Update confirmed snapshot
            if (self.confirmed_snapshot) |old_snap| {
                old_snap.deinit(self.allocator);
            }
            self.confirmed_snapshot = self.sim.take_snapshot(self.sim.getUserDataLen()) catch null;

            // 4. If we haven't reached target_match_frame yet, predict forward
            if (next_confirm < target_match_frame) {
                f = next_confirm + 1;
                while (f <= target_match_frame) : (f += 1) {
                    const is_current_frame = (f == target_match_frame);
                    // beforeTickListener syncs net_ctx with correct match_frame
                    self.sim.tick(!is_current_frame);
                    if (!is_current_frame) {
                        frames_resimmed += 1;
                    }
                }
            }

            // Update session with new confirmed frame and stats
            self.session.confirmFrame(next_confirm, frames_resimmed);
        } else {
            // No rollback needed - this is the target frame, not resimulating
            self.sim.tick(false);
        }

        // Always advance local peer's confirmed frame, even if there's no input.
        if (target_match_frame > self.input_buffer.peer_confirmed[self.session.local_peer_id]) {
            self.input_buffer.peer_confirmed[self.session.local_peer_id] = target_match_frame;
        }
    }

    /// Free all engine resources
    pub fn deinit(self: *Engine) void {
        // Clean up confirmed snapshot if any
        if (self.confirmed_snapshot) |snap| {
            snap.deinit(self.allocator);
            self.confirmed_snapshot = null;
        }

        // Clean up Engine-owned resources
        self.allocator.destroy(self.input_buffer);
        self.net.deinit();
        self.allocator.destroy(self.net);
        self.vcr.deinit();

        // Clean up Sim (which now only owns contexts)
        self.sim.deinit();
        self.allocator.destroy(self.sim);
    }

    // ─────────────────────────────────────────────────────────────
    // Tape control
    // ─────────────────────────────────────────────────────────────

    pub const RecordingError = VCR.RecordingError;

    /// Start recording to a new tape
    pub fn startRecording(self: *Engine, user_data_len: u32, max_events: u32, max_packet_bytes: u32) RecordingError!void {
        const snapshot = self.sim.take_snapshot(user_data_len) catch {
            return RecordingError.OutOfMemory;
        };
        defer snapshot.deinit(self.allocator);

        try self.vcr.startRecording(snapshot, max_events, max_packet_bytes);

        // Enable tape observer to record local inputs
        self.enableTapeObserver();
    }

    /// Stop recording
    pub fn stopRecording(self: *Engine) void {
        self.vcr.stopRecording();
        self.disableTapeObserver();
    }

    /// Load a tape from raw bytes (enters replay mode)
    /// Auto-initializes session if the tape was recorded during a session
    pub fn loadTape(self: *Engine, tape_buf: []u8) !void {
        const snapshot = try self.vcr.loadTape(tape_buf);

        // Restore basic Sim state (time, inputs, events, net_ctx)
        self.sim.restore(snapshot);

        // Auto-initialize session if snapshot was taken during a session
        if (snapshot.net.in_session == 1 and !self.session.active) {
            // Clean up existing confirmed snapshot if any
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
            self.confirmed_snapshot = self.sim.take_snapshot(snapshot.user_data_len) catch null;
        }
    }

    /// Get the current tape buffer (for serialization)
    pub fn getTapeBuffer(self: *Engine) ?[]u8 {
        return self.vcr.getTapeBuffer();
    }

    // ─────────────────────────────────────────────────────────────
    // Accessors
    // ─────────────────────────────────────────────────────────────

    /// Check if recording
    pub fn isRecording(self: *const Engine) bool {
        return self.vcr.is_recording;
    }

    /// Check if replaying
    pub fn isReplaying(self: *const Engine) bool {
        return self.vcr.is_replaying;
    }

    /// Check if session is active
    pub fn inSession(self: *const Engine) bool {
        return self.session.active;
    }

    // ─────────────────────────────────────────────────────────────
    // Session lifecycle
    // ─────────────────────────────────────────────────────────────

    /// Initialize a multiplayer session with rollback support
    pub fn sessionInit(self: *Engine, peer_count_arg: u8, user_data_len: u32) !void {
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
        self.input_buffer.init(peer_count_arg, self.sim.time.frame);
        self.input_buffer.observer = saved_observer;

        // Initialize session state
        self.session.start(self.sim.time.frame, peer_count_arg);

        // Reinitialize net state (references the same InputBuffer)
        self.net.* = .{ .allocator = self.allocator, .input_buffer = self.input_buffer };

        // Update net_ctx for snapshots (captured in take_snapshot)
        self.sim.net_ctx.peer_count = peer_count_arg;
        self.sim.net_ctx.in_session = 1;
        self.sim.net_ctx.session_start_frame = self.sim.time.frame;

        // Take initial confirmed snapshot (after session is active so it's captured)
        const snap = try self.sim.take_snapshot(user_data_len);
        self.confirmed_snapshot = snap;
    }

    /// End the current session
    pub fn sessionEnd(self: *Engine) void {
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
        self.sim.net_ctx.in_session = 0;
        self.sim.net_ctx.peer_count = 0;
        self.sim.net_ctx.session_start_frame = 0;
    }

    /// Emit inputs for a peer at a given match frame
    pub fn sessionEmitInputs(self: *Engine, peer: u8, match_frame: u32, events: []const Event) void {
        self.input_buffer.emit(peer, match_frame, events);
    }

    // ─────────────────────────────────────────────────────────────
    // Peer management
    // ─────────────────────────────────────────────────────────────

    /// Set local peer ID for packet encoding
    pub fn setLocalPeer(self: *Engine, peer_id: u8) void {
        // Record session event to tape if recording (but not replaying)
        if (self.vcr.is_recording and !self.vcr.is_replaying) {
            _ = self.vcr.recordEvent(Event.sessionSetLocalPeer(peer_id));
        }

        self.session.setLocalPeer(peer_id);
        self.net.setLocalPeer(peer_id);
        self.sim.net_ctx.local_peer_id = peer_id;
    }

    /// Mark a peer as connected
    pub fn connectPeer(self: *Engine, peer_id: u8) void {
        // Record session event to tape if recording (but not replaying)
        if (self.vcr.is_recording and !self.vcr.is_replaying) {
            _ = self.vcr.recordEvent(Event.sessionConnectPeer(peer_id));
        }

        self.net.connectPeer(peer_id);
    }

    /// Mark a peer as disconnected
    pub fn disconnectPeer(self: *Engine, peer_id: u8) void {
        // Record session event to tape if recording (but not replaying)
        if (self.vcr.is_recording and !self.vcr.is_replaying) {
            _ = self.vcr.recordEvent(Event.sessionDisconnectPeer(peer_id));
        }

        self.net.disconnectPeer(peer_id);
    }

    // ─────────────────────────────────────────────────────────────
    // Network packets
    // ─────────────────────────────────────────────────────────────

    /// Build an outbound packet for a target peer
    pub fn buildOutboundPacket(self: *Engine, target_peer: u8) void {
        const match_frame: u16 = if (self.session.active)
            @intCast(self.session.getMatchFrame(self.sim.time.frame))
        else
            @intCast(self.sim.time.frame);
        self.net.buildOutboundPacket(target_peer, match_frame) catch {
            Log.log("Failed to build outbound packet for peer {}", .{target_peer});
            @panic("Failed to build outbound packet");
        };
    }

    /// Get pointer to the outbound packet buffer
    pub fn getOutboundPacketPtr(self: *const Engine) usize {
        if (self.net.outbound_buffer) |buf| {
            return @intFromPtr(buf.ptr);
        }
        return 0;
    }

    /// Get length of the outbound packet
    pub fn getOutboundPacketLen(self: *const Engine) u32 {
        return self.net.outbound_len;
    }

    /// Process a received packet
    pub fn receivePacket(self: *Engine, ptr: usize, len: u32) u8 {
        if (!self.session.active) return 1;

        const buf: [*]const u8 = @ptrFromInt(ptr);
        const slice = buf[0..len];

        // Record packet to tape before processing (capture exact bytes received)
        if (self.vcr.is_recording) {
            // peer_id is at byte[1] in the packet header
            const peer_id: u8 = if (len > 1) slice[1] else 0;
            // Record at current frame - during replay, inject at this frame
            self.vcr.recordPacket(self.sim.time.frame, peer_id, slice);
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
    pub fn getPeerSeq(self: *const Engine, peer: u8) u16 {
        if (peer < Transport.MAX_PEERS) {
            return self.net.peer_states[peer].remote_seq;
        }
        return 0;
    }

    /// Get ack for a peer (latest frame they acked from us)
    pub fn getPeerAck(self: *const Engine, peer: u8) u16 {
        if (peer < Transport.MAX_PEERS) {
            return self.net.peer_states[peer].remote_ack;
        }
        return 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Event emission
    // ─────────────────────────────────────────────────────────────

    pub fn emit_keydown(self: *Engine, key: Events.Key, peer_id: u8) void {
        self.appendEvent(Event.keyDown(key, peer_id, .LocalKeyboard));
    }

    pub fn emit_keyup(self: *Engine, key: Events.Key, peer_id: u8) void {
        self.appendEvent(Event.keyUp(key, peer_id, .LocalKeyboard));
    }

    pub fn emit_mousedown(self: *Engine, button: Events.MouseButton, peer_id: u8) void {
        self.appendEvent(Event.mouseDown(button, peer_id, .LocalMouse));
    }

    pub fn emit_mouseup(self: *Engine, button: Events.MouseButton, peer_id: u8) void {
        self.appendEvent(Event.mouseUp(button, peer_id, .LocalMouse));
    }

    pub fn emit_mousemove(self: *Engine, x: f32, y: f32, peer_id: u8) void {
        self.appendEvent(Event.mouseMove(x, y, peer_id, .LocalMouse));
    }

    pub fn emit_mousewheel(self: *Engine, delta_x: f32, delta_y: f32, peer_id: u8) void {
        self.appendEvent(Event.mouseWheel(delta_x, delta_y, peer_id, .LocalMouse));
    }

    // ─────────────────────────────────────────────────────────────
    // Network event emission
    // ─────────────────────────────────────────────────────────────

    /// Queue a network event for processing in next tick
    fn emitNetEvent(self: *Engine, event: Event) void {
        if (self.pending_net_events_count < MAX_PENDING_NET_EVENTS) {
            self.pending_net_events[self.pending_net_events_count] = event;
            self.pending_net_events_count += 1;
        }
    }

    /// Emit NetJoinOk event - successfully joined a room
    pub fn emit_net_join_ok(self: *Engine, room_code: [8]u8) void {
        self.emitNetEvent(Event.netJoinOk(room_code));
    }

    /// Emit NetJoinFail event - failed to join a room
    pub fn emit_net_join_fail(self: *Engine, reason: Events.NetJoinFailReason) void {
        self.emitNetEvent(Event.netJoinFail(reason));
    }

    /// Emit NetPeerJoin event - a peer joined the room
    pub fn emit_net_peer_join(self: *Engine, peer_id: u8) void {
        self.emitNetEvent(Event.netPeerJoin(peer_id));
    }

    /// Emit NetPeerLeave event - a peer left the room
    pub fn emit_net_peer_leave(self: *Engine, peer_id: u8) void {
        self.emitNetEvent(Event.netPeerLeave(peer_id));
    }

    /// Append a fresh local event. Writes to Engine's canonical InputBuffer.
    fn appendEvent(self: *Engine, event: Event) void {
        // Calculate match_frame for the upcoming tick
        const match_frame = if (self.session.active)
            self.session.getMatchFrame(self.sim.time.frame) + 1
        else
            self.sim.time.frame + 1;

        // In session mode, use local_peer_id for network consistency
        // In non-session mode, preserve the event's peer_id for local multiplayer
        const peer_id = if (self.session.active) self.session.local_peer_id else event.peer_id;

        // Tag the event with the resolved peer ID
        var local_event = event;
        local_event.peer_id = peer_id;

        // Write to canonical InputBuffer - observer handles tape recording
        self.input_buffer.emit(peer_id, match_frame, &[_]Event{local_event});

        // If in a session, extend unacked window for packet sending to peers
        if (self.session.active) {
            const match_frame_u16: u16 = @intCast(match_frame);
            self.net.extendUnackedWindow(match_frame_u16);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Session state accessors
    // ─────────────────────────────────────────────────────────────

    /// Get current match frame (0 if no session)
    pub fn getMatchFrame(self: *const Engine) u32 {
        return self.session.getMatchFrame(self.sim.time.frame);
    }

    /// Get confirmed frame (0 if no session)
    pub fn getConfirmedFrame(self: *const Engine) u32 {
        return self.session.getConfirmedFrame();
    }

    /// Get confirmed frame for a specific peer
    pub fn getPeerFrame(self: *const Engine, peer: u8) u32 {
        if (!self.session.active) return 0;
        if (peer >= IB.MAX_PEERS) return 0;
        return self.input_buffer.peer_confirmed[peer];
    }

    /// Get rollback depth (match_frame - confirmed_frame)
    pub fn getRollbackDepth(self: *const Engine) u32 {
        return self.session.getRollbackDepth(self.sim.time.frame);
    }

    // ─────────────────────────────────────────────────────────────
    // Seek
    // ─────────────────────────────────────────────────────────────

    /// Seek to a specific frame using the current tape
    /// Restores closest snapshot and resimulates forward
    pub fn seek(self: *Engine, frame: u32) void {
        if (!self.vcr.hasTape()) {
            @panic("Tried to seek to frame without an active tape");
        }

        const snapshot = self.vcr.closestSnapshot(frame) orelse @panic("No snapshot found for seek");
        self.sim.restore(snapshot);

        // Remember if we were already replaying (from loadTape)
        const was_replaying = self.vcr.is_replaying;

        // Enter replay mode for resimulation
        self.vcr.enterReplayMode();

        // Advance to the desired frame using Engine.advance()
        // advance() handles tape event replay via replay_tape_inputs()
        while (self.sim.time.frame < frame) {
            const count = self.advance(hz);
            if (count == 0) {
                @panic("Failed to advance frame during seek");
            }
        }

        // Preserve replay state if we were replaying before (e.g., from loadTape)
        // Only reset if we weren't in replay mode before this seek
        if (!was_replaying) {
            self.vcr.exitReplayMode();
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Tape Replay (moved from Sim)
    // ─────────────────────────────────────────────────────────────

    /// Replay session lifecycle events from tape for the current frame.
    fn replayTapeSessionEvents(self: *Engine) void {
        const tape_events = self.vcr.getEventsForFrame(self.sim.time.frame);
        for (tape_events) |event| {
            switch (event.kind) {
                .SessionInit => {
                    self.sessionInit(event.payload.peer_id, self.sim.getUserDataLen()) catch {};
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
    fn replayTapePackets(self: *Engine) void {
        var iter = self.vcr.getPacketsForFrame(self.sim.time.frame) orelse return;
        while (iter.next()) |packet| {
            // Process the packet as if it was just received
            self.net.receivePacket(packet.data, self.input_buffer) catch |e| {
                std.debug.panic("Failed to replay packet at frame {}: {any}", .{ self.sim.time.frame, e });
            };
        }
    }

    /// Replay input events from tape for the current frame.
    fn replayTapeInputs(self: *Engine) void {
        const tape_events = self.vcr.getEventsForFrame(self.sim.time.frame);
        for (tape_events) |event| {
            // Skip FrameStart markers and session events
            if (event.kind == .FrameStart or event.kind.isSessionEvent()) continue;

            // Calculate match_frame for the upcoming tick
            const match_frame = if (self.session.active)
                self.session.getMatchFrame(self.sim.time.frame) + 1
            else
                self.sim.time.frame + 1;

            const peer_id = if (self.session.active) self.session.local_peer_id else 0;

            var local_event = event;
            local_event.peer_id = peer_id;

            // Write to InputBuffer - tick will read from there
            self.input_buffer.emit(peer_id, match_frame, &[_]Event{local_event});
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Tape Observer (moved from Sim)
    // ─────────────────────────────────────────────────────────────

    /// Observer callback for InputBuffer - records local peer inputs to tape.
    fn tapeInputObserver(ctx: *anyopaque, peer: u8, _: u32, event: Event) void {
        const self: *Engine = @ptrCast(@alignCast(ctx));

        // Only record local peer's inputs - remote inputs come from packet replay
        if (peer != self.session.local_peer_id) return;

        // Only record if we're recording and not replaying
        if (!self.vcr.is_recording or self.vcr.is_replaying) return;

        if (!self.vcr.recordEvent(event)) {
            // Tape is full - stop recording gracefully
            self.stopRecording();
            if (self.sim.callbacks.on_tape_full) |on_tape_full| {
                on_tape_full();
            } else {
                Log.log("Tape full, recording stopped (no onTapeFull callback registered)", .{});
            }
        }
    }

    /// Enable tape observer on InputBuffer
    fn enableTapeObserver(self: *Engine) void {
        self.input_buffer.observer = IB.InputObserver{
            .callback = tapeInputObserver,
            .context = @ptrCast(self),
        };
    }

    /// Disable tape observer
    fn disableTapeObserver(self: *Engine) void {
        self.input_buffer.observer = null;
    }
};

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

test "Engine init and deinit" {
    var engine = try Engine.init(std.testing.allocator, 0);
    engine.wireListeners();
    defer engine.deinit();

    // Verify initial state
    try std.testing.expectEqual(@as(u32, 0), engine.accumulator);
    try std.testing.expectEqual(false, engine.inSession());
    try std.testing.expectEqual(false, engine.isRecording());
    try std.testing.expectEqual(false, engine.isReplaying());
}

test "Engine advance accumulates time" {
    var engine = try Engine.init(std.testing.allocator, 0);
    engine.wireListeners();
    defer engine.deinit();

    // Advance by 10ms - not enough for a frame (hz = 16ms)
    const frames1 = engine.advance(10);
    try std.testing.expectEqual(@as(u32, 0), frames1);
    try std.testing.expectEqual(@as(u32, 10), engine.accumulator);

    // Advance by another 10ms - now we have 20ms, should step once
    const frames2 = engine.advance(10);
    try std.testing.expectEqual(@as(u32, 1), frames2);
    try std.testing.expectEqual(@as(u32, 4), engine.accumulator); // 20 - 16 = 4

    // Advance by 32ms - should step twice
    const frames3 = engine.advance(32);
    try std.testing.expectEqual(@as(u32, 2), frames3);
    try std.testing.expectEqual(@as(u32, 4), engine.accumulator); // 36 - 32 = 4
}

test "Engine tape recording" {
    var engine = try Engine.init(std.testing.allocator, 0);
    engine.wireListeners();
    defer engine.deinit();

    try std.testing.expectEqual(false, engine.isRecording());

    // Start recording
    try engine.startRecording(0, 1024, 0);
    try std.testing.expectEqual(true, engine.isRecording());

    // Advance a few frames
    _ = engine.advance(hz * 3);

    // Stop recording
    engine.stopRecording();
    try std.testing.expectEqual(false, engine.isRecording());

    // Should have tape buffer
    try std.testing.expect(engine.getTapeBuffer() != null);
}

test "Engine seek restores frame" {
    var engine = try Engine.init(std.testing.allocator, 0);
    engine.wireListeners();
    defer engine.deinit();

    // Start recording
    try engine.startRecording(0, 1024, 0);

    // Advance to frame 5
    _ = engine.advance(hz * 5);
    try std.testing.expectEqual(@as(u32, 5), engine.sim.time.frame);

    // Stop recording
    engine.stopRecording();

    // Seek back to frame 2
    engine.seek(2);
    try std.testing.expectEqual(@as(u32, 2), engine.sim.time.frame);

    // Seek forward to frame 4
    engine.seek(4);
    try std.testing.expectEqual(@as(u32, 4), engine.sim.time.frame);
}

test "Engine session lifecycle" {
    var engine = try Engine.init(std.testing.allocator, 0);
    engine.wireListeners();
    defer engine.deinit();

    // Not in session initially
    try std.testing.expectEqual(false, engine.inSession());

    // Initialize session
    try engine.sessionInit(2, 0);
    try std.testing.expectEqual(true, engine.inSession());

    // Set local peer
    engine.setLocalPeer(0);

    // Connect both peers
    engine.connectPeer(0);
    engine.connectPeer(1);

    // Advance some frames
    _ = engine.advance(hz * 3);

    // End session
    engine.sessionEnd();
    try std.testing.expectEqual(false, engine.inSession());
}

test "Engine emit_keydown adds event to InputBuffer" {
    var engine = try Engine.init(std.testing.allocator, 0);
    engine.wireListeners();
    defer engine.deinit();

    // Emit keydown - goes to InputBuffer at match_frame = time.frame + 1
    engine.emit_keydown(.KeyA, 0);

    // Check InputBuffer has the event at frame 1 (time.frame=0, so match_frame=1)
    const events = engine.input_buffer.get(0, 1);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    try std.testing.expectEqual(.KeyDown, events[0].kind);
    try std.testing.expectEqual(.KeyA, events[0].payload.key);
    try std.testing.expectEqual(.LocalKeyboard, events[0].device);

    // Emit keyup - also goes to InputBuffer at frame 1
    engine.emit_keyup(.KeyA, 0);
    const events2 = engine.input_buffer.get(0, 1);
    try std.testing.expectEqual(@as(usize, 2), events2.len);
    try std.testing.expectEqual(.KeyUp, events2[1].kind);
}

test "Engine emit_mousemove adds event to InputBuffer" {
    var engine = try Engine.init(std.testing.allocator, 0);
    engine.wireListeners();
    defer engine.deinit();

    engine.emit_mousemove(100.5, 200.5, 0);

    // Check InputBuffer has the event at frame 1
    const events = engine.input_buffer.get(0, 1);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    try std.testing.expectEqual(.MouseMove, events[0].kind);
    try std.testing.expectEqual(100.5, events[0].payload.mouse_move.x);
    try std.testing.expectEqual(200.5, events[0].payload.mouse_move.y);
}

// ─────────────────────────────────────────────────────────────
// Test imports - pull in tests from all modules
// ─────────────────────────────────────────────────────────────

comptime {
    // Core modules
    _ = @import("sim.zig");
    _ = @import("input_buffer.zig");

    // Tapes modules
    _ = @import("tapes/tapes.zig");
    _ = @import("tapes/vcr.zig");

    // Netcode modules
    _ = @import("netcode/transport.zig");
    _ = @import("netcode/session.zig");
}
