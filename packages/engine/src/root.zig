// Root module - Engine coordinator and test imports
const std = @import("std");
const SimMod = @import("sim.zig");
const Sim = SimMod.Sim;
const Tapes = @import("tapes/tapes.zig");
const Transport = @import("netcode/transport.zig");
const Events = @import("events.zig");
const IB = @import("input_buffer.zig");
const PEB = @import("platform_event_buffer.zig");
const VCR = @import("tapes/vcr.zig").VCR;
const Ses = @import("netcode/session.zig");
const Log = @import("log.zig");

const Session = Ses.Session;
const InputBuffer = IB.InputBuffer;
const PlatformEventBuffer = PEB.PlatformEventBuffer;
const PacketBuilder = Transport.PacketBuilder;
const Event = Events.Event;
const Ctx = @import("context.zig");
const NetStatus = Ctx.NetStatus;

pub const hz = SimMod.hz;

/// Engine coordinates the simulation. It manages timing, sessions, tapes, and network.
pub const Engine = struct {
    /// The simulation (owns contexts: time, inputs, events, net_ctx)
    sim: *Sim,
    /// Frame timing accumulator
    accumulator: u32 = 0,
    /// Allocator for engine resources
    allocator: std.mem.Allocator,

    // ─────────────────────────────────────────────────────────────
    // Coordination state
    // ─────────────────────────────────────────────────────────────
    /// Tape recorder/player
    vcr: VCR,
    /// Multiplayer session state
    session: Session = .{},
    /// Confirmed snapshot for rollback
    confirmed_snapshot: ?*Tapes.Snapshot = null,
    /// Canonical input buffer - single source of truth for all inputs
    input_buffer: *InputBuffer,
    /// Platform event buffer - stores network events for replay
    platform_buffer: *PlatformEventBuffer,
    /// Network state for packet management (heap-allocated due to ~68KB size)
    net: *PacketBuilder,

    /// Initialize engine with a new simulation
    pub fn init(allocator: std.mem.Allocator, ctx_ptr: usize) !Engine {
        // Allocate canonical InputBuffer (single source of truth for all inputs)
        const input_buffer = try allocator.create(InputBuffer);
        input_buffer.* = .{};
        // Default: 1 peer for local play (session mode will reinit with actual peer count)
        input_buffer.init(1, 0);

        // Allocate PlatformEventBuffer for network events
        const platform_buffer = try allocator.create(PlatformEventBuffer);
        platform_buffer.* = .{};

        const net = try allocator.create(PacketBuilder);
        net.* = .{ .allocator = allocator, .input_buffer = input_buffer };

        const sim = try allocator.create(Sim);
        sim.* = try Sim.init(allocator, ctx_ptr, input_buffer);

        net.net_ctx = sim.net_ctx;

        return Engine{
            .sim = sim,
            .allocator = allocator,
            .vcr = VCR.init(allocator),
            .input_buffer = input_buffer,
            .platform_buffer = platform_buffer,
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

        // Process platform events from PlatformEventBuffer
        self.processPlatformEvents();
    }

    /// Process platform events from PlatformEventBuffer and forward to sim.events.
    /// Net events are processed here (Engine has access to net, input_buffer, net_ctx).
    /// All events are forwarded so users can observe them via the event buffer.
    fn processPlatformEvents(self: *Engine) void {
        // Read events for the current frame
        const target_frame = self.sim.time.frame;
        const platform_events = self.platform_buffer.get(target_frame);

        const is_resimulating = self.sim.time.is_resimulating == 1;

        for (platform_events) |event| {
            // Process net events in Engine (has access to net, input_buffer, net_ctx)
            if (event.kind.isNetEvent()) {
                // Skip NetSessionInit during resimulation - it clears InputBuffer
                // which would destroy the remote peer inputs we need for resim
                if (is_resimulating and event.kind == .NetSessionInit) {
                    continue;
                }
                self.processNetEvent(event);
            }

            // Forward ALL events to sim.events (users observe via event buffer)
            const idx = self.sim.events.count;
            if (idx < Events.MAX_EVENTS) {
                self.sim.events.count += 1;
                self.sim.events.events[idx] = event;
            }
        }
    }

    /// Process a network event - updates Engine's network state
    fn processNetEvent(self: *Engine, event: Event) void {
        switch (event.kind) {
            .NetJoinOk => {
                self.sim.net_ctx.status = @intFromEnum(NetStatus.connected);
                @memcpy(&self.sim.net_ctx.room_code, &event.payload.room_code);
                self.sim.net_ctx.peer_count = 1; // Self is first peer

                // Mark local peer as connected
                self.sim.net_ctx.peers[self.sim.net_ctx.local_peer_id].connected = 1;
            },
            .NetJoinFail => {
                self.sim.net_ctx.status = @intFromEnum(NetStatus.local);
            },
            .NetPeerJoin => {
                const peer_id = event.payload.peer_id;
                if (peer_id >= Ctx.MAX_PLAYERS) {
                    @panic("Invalid peer ID on NetPeerJoin");
                }
                // Mark peer as connected
                self.sim.net_ctx.peers[peer_id].connected = 1;

                // TODO: this guard should not be here
                if (self.sim.net_ctx.in_session == 0) {
                    self.sim.net_ctx.peer_count += 1;
                    if (self.sim.net_ctx.peer_count >= 2) {
                        self.sim.net_ctx.in_session = 1;
                    }
                }
            },
            .NetPeerLeave => {
                const peer_id = event.payload.peer_id;
                if (peer_id >= Ctx.MAX_PLAYERS) {
                    @panic("Invalid peer ID on NetPeerLeave");
                }
                // Disconnect peer and reset state
                self.sim.net_ctx.peers[peer_id] = .{};

                if (self.sim.net_ctx.peer_count > 0) {
                    self.sim.net_ctx.peer_count -= 1;
                }
                if (self.sim.net_ctx.peer_count <= 1) {
                    self.sim.net_ctx.in_session = 0;
                }
            },
            .NetPeerAssignLocalId => {
                const peer_id = event.payload.peer_id;
                if (peer_id >= Ctx.MAX_PLAYERS) {
                    @panic("Invalid local peer ID");
                }
                self.sim.net_ctx.local_peer_id = peer_id;
            },
            .NetSessionInit => {
                // Derive session params from context (set by prior peer:join and assign-local-id events)
                const local_peer_id = self.sim.net_ctx.local_peer_id;
                const peer_count = self.sim.net_ctx.peer_count;
                const start_frame = self.sim.time.frame;

                // Clean up existing confirmed snapshot if any
                if (self.confirmed_snapshot) |snap| {
                    snap.deinit(self.allocator);
                    self.confirmed_snapshot = null;
                }
                self.net.deinit();

                // Reinitialize InputBuffer for the session
                // Preserve observer (tape recording) across session init
                const saved_observer = self.input_buffer.observer;
                self.input_buffer.* = .{};
                self.input_buffer.init(peer_count, start_frame);
                self.input_buffer.observer = saved_observer;

                // Initialize session state
                self.session.start(start_frame);

                // Update net_ctx
                self.sim.net_ctx.in_session = 1;
                self.sim.net_ctx.session_start_frame = start_frame;
                self.sim.net_ctx.peers[local_peer_id].connected = 1;

                // Reinitialize NetState with NetCtx reference
                self.net.* = .{
                    .allocator = self.allocator,
                    .input_buffer = self.input_buffer,
                    .net_ctx = self.sim.net_ctx,
                };

                // Take confirmed snapshot (after prior peer:join events already processed)
                self.confirmed_snapshot = self.sim.take_snapshot(self.sim.getUserDataLen()) catch null;
            },
            else => {},
        }
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
                self.replayTapeNetEvents();
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
                self.sim.tick(false);
            }

            step_count += 1;
            self.accumulator -= hz;
        }
        return step_count;
    }

    // ─────────────────────────────────────────────────────────────
    // Session management
    // ─────────────────────────────────────────────────────────────

    /// Session-aware step that handles rollback when late inputs arrive
    fn sessionStep(self: *Engine) void {
        // The frame we're about to process (after this tick, match_frame will be this value)
        const target_match_frame = self.session.getMatchFrame(self.sim.time.frame) + 1;

        // Calculate how many frames can be confirmed based on received inputs
        const next_confirm = self.input_buffer.calculateNextConfirmFrame(target_match_frame);
        const current_confirmed = self.session.confirmed_frame;

        Log.debug("sessionStep: time.frame={} target_mf={} next_confirm={} current_confirmed={} peer_count={}", .{
            self.sim.time.frame,
            target_match_frame,
            next_confirm,
            current_confirmed,
            self.input_buffer.peer_count,
        });

        if (next_confirm > current_confirmed) {
            // New confirmed frames available - need to rollback and resim
            const rollback_depth = target_match_frame - 1 - current_confirmed;
            if (rollback_depth > Transport.MAX_ROLLBACK_FRAMES) {
                @panic("Rollback depth exceeds MAX_ROLLBACK_FRAMES - ring buffer would wrap");
            }

            // 1. Restore to confirmed state
            // Note: peers array contains live connection tracking (seq/ack) that must NOT roll back.
            // Network events in PlatformEventBuffer are replayed for topology (peer join/leave),
            // but seq/ack tracking is updated by packet processing and must be preserved.
            const saved_peers = self.sim.net_ctx.peers;
            if (self.confirmed_snapshot) |snap| {
                self.sim.restore(snap);
            }
            self.sim.net_ctx.peers = saved_peers;

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
        if (target_match_frame > self.input_buffer.peer_confirmed[self.sim.net_ctx.local_peer_id]) {
            self.input_buffer.peer_confirmed[self.sim.net_ctx.local_peer_id] = target_match_frame;
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
        self.allocator.destroy(self.platform_buffer);
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
    pub fn loadTape(self: *Engine, tape_buf: []u8, checkpoint_interval: u32, checkpoint_max_size: u32) !void {
        // Clear checkpoints from previous tape
        self.vcr.clearCheckpoints();

        // Configure checkpoints for seek performance optimization
        self.vcr.configureCheckpoints(checkpoint_interval, checkpoint_max_size);

        const snapshot = try self.vcr.loadTape(tape_buf);

        // Restore basic Sim state (time, inputs, events, net_ctx)
        self.sim.restore(snapshot);

        if (snapshot.net.in_session == 0) {
            return;
        }

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
        self.session.confirmed_frame = 0;
        self.session.stats = .{};
        self.session.active = true;

        self.net.* = .{
            .allocator = self.allocator,
            .input_buffer = self.input_buffer,
            .net_ctx = self.sim.net_ctx,
        };

        // Take initial confirmed snapshot for rollback
        self.confirmed_snapshot = self.sim.take_snapshot(snapshot.user_data_len) catch null;
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

    /// Initialize session - queues NetSessionInit event.
    /// Requires peer:join and assign-local-id events to be emitted first.
    pub fn emit_net_session_init(self: *Engine) void {
        self.appendNetEvent(Event.netSessionInit());
    }

    /// End session - emits NetPeerLeave for all connected peers
    pub fn emit_net_session_end(self: *Engine) void {
        // Emit disconnect events for all connected peers
        for (0..Transport.MAX_PEERS) |i| {
            if (self.sim.net_ctx.peers[i].connected == 1) {
                self.appendNetEvent(Event.netPeerLeave(@intCast(i)));
            }
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
        self.net.* = .{
            .allocator = self.allocator,
            .input_buffer = self.input_buffer,
            .net_ctx = self.sim.net_ctx,
        };

        // Net events will clear in_session, peer_count, etc. in process_events()
        self.sim.net_ctx.in_session = 0;
        self.sim.net_ctx.peer_count = 0;
        self.sim.net_ctx.session_start_frame = 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Session lifecycle (legacy direct API - will be removed)
    // ─────────────────────────────────────────────────────────────

    /// End the current session
    pub fn sessionEnd(self: *Engine) void {
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
        self.net.* = .{
            .allocator = self.allocator,
            .input_buffer = self.input_buffer,
            .net_ctx = self.sim.net_ctx,
        };
        self.sim.net_ctx.in_session = 0;
        self.sim.net_ctx.peer_count = 0;
        self.sim.net_ctx.session_start_frame = 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Network packets
    // ─────────────────────────────────────────────────────────────

    /// Build an outbound packet for a target peer
    pub fn buildOutboundPacket(self: *Engine, target_peer: u8) void {
        const match_frame: u32 = if (self.session.active)
            self.session.getMatchFrame(self.sim.time.frame)
        else
            self.sim.time.frame;
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

    /// Process a received packet and emit event for user observation.
    /// Packet is processed synchronously (while memory is valid),
    /// then event is queued so users can observe it via the event buffer.
    pub fn emit_receive_packet(self: *Engine, ptr: usize, len: u32) u8 {
        if (!self.session.active) return 1;

        // Minimal validation - just check buffer size
        if (len < Transport.HEADER_SIZE) return 2;

        const buf: [*]const u8 = @ptrFromInt(ptr);
        const slice = buf[0..len];

        // Record packet to tape before processing (capture exact bytes received)
        if (self.vcr.is_recording) {
            // peer_id is at byte[1] in the packet header
            const peer_id: u8 = slice[1];
            if (!self.vcr.recordPacket(self.sim.time.frame, peer_id, slice)) {
                // Packet buffer full - stop recording gracefully
                self.stopRecording();
                if (self.sim.callbacks.on_tape_full) |on_tape_full| {
                    on_tape_full();
                } else {
                    Log.log("Tape full (packet buffer), recording stopped (no onTapeFull callback registered)", .{});
                }
            }
        }

        // Process packet synchronously while memory is still valid
        self.processPacketSlice(slice);

        // Queue event for user observation (ptr/len are dummy since processing already happened)
        // tapePlatformObserver skips this event type since packets are recorded separately
        const event = Event.netPacketReceived(0, 0, slice[1]);
        self.appendNetEvent(event);

        return 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Input event emission
    // ─────────────────────────────────────────────────────────────

    pub fn emit_keydown(self: *Engine, key: Events.Key, peer_id: u8) void {
        self.appendInputEvent(Event.keyDown(key, peer_id, .LocalKeyboard));
    }

    pub fn emit_keyup(self: *Engine, key: Events.Key, peer_id: u8) void {
        self.appendInputEvent(Event.keyUp(key, peer_id, .LocalKeyboard));
    }

    pub fn emit_mousedown(self: *Engine, button: Events.MouseButton, peer_id: u8) void {
        self.appendInputEvent(Event.mouseDown(button, peer_id, .LocalMouse));
    }

    pub fn emit_mouseup(self: *Engine, button: Events.MouseButton, peer_id: u8) void {
        self.appendInputEvent(Event.mouseUp(button, peer_id, .LocalMouse));
    }

    pub fn emit_mousemove(self: *Engine, x: f32, y: f32, peer_id: u8) void {
        self.appendInputEvent(Event.mouseMove(x, y, peer_id, .LocalMouse));
    }

    pub fn emit_mousewheel(self: *Engine, delta_x: f32, delta_y: f32, peer_id: u8) void {
        self.appendInputEvent(Event.mouseWheel(delta_x, delta_y, peer_id, .LocalMouse));
    }

    /// Append a fresh local event. Writes to Engine's canonical InputBuffer.
    fn appendInputEvent(self: *Engine, event: Event) void {
        // Calculate match_frame for the upcoming tick
        const match_frame = if (self.session.active)
            self.session.getMatchFrame(self.sim.time.frame) + 1
        else
            self.sim.time.frame + 1;

        // In session mode, use local_peer_id for network consistency
        // In non-session mode, preserve the event's peer_id for local multiplayer
        const peer_id = if (self.session.active) self.sim.net_ctx.local_peer_id else event.peer_id;

        // Tag the event with the resolved peer ID
        var local_event = event;
        local_event.peer_id = peer_id;

        // Write to canonical InputBuffer - observer handles tape recording
        self.input_buffer.emit(peer_id, match_frame, &[_]Event{local_event});

        // If in a session, extend unacked window for packet sending to peers
        if (self.session.active) {
            self.net.extendUnackedWindow(match_frame);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Network event emission
    // ─────────────────────────────────────────────────────────────

    /// Queue a network event for processing in next tick.
    /// Events are stored in PlatformEventBuffer for unified replay during rollback.
    /// Tape recording is handled by the platform_buffer's observer.
    fn appendNetEvent(self: *Engine, event: Event) void {
        Log.debug("Appending net event peer_id={} kind={}", .{ event.peer_id, event.kind });

        // Platform events are indexed by the frame they occur on
        const target_frame = self.sim.time.frame;
        self.platform_buffer.emit(target_frame, event);
    }

    /// Emit NetJoinOk event - successfully joined a room
    pub fn emit_net_join_ok(self: *Engine, room_code: [8]u8) void {
        self.appendNetEvent(Event.netJoinOk(room_code));
    }

    /// Emit NetJoinFail event - failed to join a room
    pub fn emit_net_join_fail(self: *Engine, reason: Events.NetJoinFailReason) void {
        self.appendNetEvent(Event.netJoinFail(reason));
    }

    /// Emit NetPeerJoin event - a peer joined the room
    pub fn emit_net_peer_join(self: *Engine, peer_id: u8) void {
        self.appendNetEvent(Event.netPeerJoin(peer_id));
    }

    /// Emit NetPeerLeave event - a peer left the room
    pub fn emit_net_peer_leave(self: *Engine, peer_id: u8) void {
        self.appendNetEvent(Event.netPeerLeave(peer_id));
    }

    /// Assign local peer ID (for session setup)
    pub fn emit_net_peer_assign_local_id(self: *Engine, peer_id: u8) void {
        self.appendNetEvent(Event.netPeerAssignLocalId(peer_id));
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

        const snapshot = self.vcr.closestSnapshot(frame);
        Log.log("Seeking to frame {} using snapshot at frame {}", .{ frame, snapshot.time.frame });
        self.sim.restore(snapshot);

        // Remember if we were already replaying (from loadTape)
        const was_replaying = self.vcr.is_replaying;

        // Enter replay mode for resimulation
        self.vcr.enterReplayMode();

        // Advance to the desired frame using Engine.advance()
        // advance() handles tape event replay via replay_tape_inputs()
        while (self.sim.time.frame < frame) {
            // Create checkpoint at interval boundaries during resimulation
            if (self.vcr.shouldCheckpoint(self.sim.time.frame)) {
                const snap = self.sim.take_snapshot(self.sim.getUserDataLen()) catch @panic("Failed to create checkpoint during seek");
                self.vcr.storeCheckpoint(self.sim.time.frame, snap);
            }

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
    // Tape Replay
    // ─────────────────────────────────────────────────────────────

    /// Replay network events from tape for the current frame.
    /// Writes them to PlatformEventBuffer to be processed by processPlatformEvents().
    fn replayTapeNetEvents(self: *Engine) void {
        const tape_events = self.vcr.getEventsForFrame(self.sim.time.frame);
        for (tape_events) |event| {
            if (event.kind.isNetEvent()) {
                // Queue to PlatformEventBuffer (processed in beforeTickListener)
                self.appendNetEvent(event);
            }
        }
    }

    /// Replay packets from tape for the current frame
    fn replayTapePackets(self: *Engine) void {
        var iter = self.vcr.getPacketsForFrame(self.sim.time.frame);
        while (iter.next()) |packet| {
            // Process packet directly using the slice (avoids pointer truncation issues on 64-bit)
            self.processPacketSlice(packet.data);
        }
    }

    /// Process a packet from a raw slice (used by tape replay and emit_receive_packet)
    fn processPacketSlice(self: *Engine, slice: []const u8) void {
        // Decode packet header
        const header = Transport.PacketHeader.decode(slice) catch |e| {
            switch (e) {
                Transport.DecodeError.BufferTooSmall => @panic("Packet buffer too small"),
                Transport.DecodeError.UnsupportedVersion => @panic("Unsupported packet version"),
                Transport.DecodeError.InvalidEventCount => @panic("Invalid event count in packet"),
            }
        };

        if (header.peer_id >= Transport.MAX_PEERS) {
            @panic("Invalid peer_id in packet header");
        }

        const net_ctx = self.sim.net_ctx;
        const peer = &net_ctx.peers[header.peer_id];

        // Capture old seq before updating to filter duplicate events
        const old_seq = peer.seq;

        // Update seq/ack in NetCtx (single source of truth)
        if (header.frame_seq > peer.seq or peer.packet_count == 0) {
            peer.seq = header.frame_seq;
        }

        // Update ack - what frame they've received from us
        // 0xFFFF is sentinel for "no ack yet" - don't count it
        if (header.frame_ack != 0xFFFF) {
            if (header.frame_ack > peer.ack or peer.ack_count == 0) {
                peer.ack = header.frame_ack;
                // Increment ack count (saturate at 255)
                if (peer.ack_count < 255) {
                    peer.ack_count += 1;
                }
            }
        }

        // Increment packet count (saturate at 255)
        if (peer.packet_count < 255) {
            peer.packet_count += 1;
        }

        // Trim our unacked buffer up to the acked frame (skip if sentinel value)
        if (header.frame_ack != 0xFFFF) {
            // Reconstruct full u32 frame from header
            self.net.peer_unacked[header.peer_id].trimAcked(header.fullFrameAck());
        }

        // Decode and store events in InputBuffer
        var offset: usize = Transport.HEADER_SIZE;
        var i: usize = 0;
        while (i < header.event_count) : (i += 1) {
            if (offset + Transport.WIRE_EVENT_SIZE > slice.len) {
                @panic("Packet buffer too small for events");
            }
            const wire_event = Transport.WireEvent.decode(slice[offset .. offset + Transport.WIRE_EVENT_SIZE]) catch {
                @panic("Failed to decode wire event");
            };
            var input_event = wire_event.toEvent();
            // Set peer_id from packet header so events are routed to correct player
            input_event.peer_id = header.peer_id;

            // Only add events for frames we haven't received yet.
            // Each packet retransmits all unacked events, so we filter duplicates
            // by only accepting events for frames > our last received frame.
            if (wire_event.frame > old_seq) {
                // Reconstruct full u32 frame from u16 + base_frame_high
                const full_frame = header.toFullFrame(wire_event.frame);
                Log.debug("Processing input event from packet: peer={} match_frame={} engine_frame={} kind={}", .{
                    header.peer_id,
                    full_frame,
                    self.sim.time.frame,
                    input_event.kind,
                });
                self.input_buffer.emit(header.peer_id, full_frame, &[_]Event{input_event});
            }

            offset += Transport.WIRE_EVENT_SIZE;
        }

        // Update peer_confirmed even if there were no events.
        // The frame_seq tells us the peer has reached this frame,
        // which is sufficient for confirmation regardless of input activity.
        if (header.frame_seq > self.input_buffer.peer_confirmed[header.peer_id]) {
            self.input_buffer.peer_confirmed[header.peer_id] = header.frame_seq;
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

            // Use the peer_id from the tape event (preserves original peer)
            const peer_id = event.peer_id;

            // Write to InputBuffer - tick will read from there
            self.input_buffer.emit(peer_id, match_frame, &[_]Event{event});
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Tape Observer
    // ─────────────────────────────────────────────────────────────

    /// Observer callback for InputBuffer - record local peer inputs to tape.
    fn tapeInputObserver(ctx: *anyopaque, peer: u8, _: u32, event: Event) void {
        const self: *Engine = @ptrCast(@alignCast(ctx));

        if (peer != self.sim.net_ctx.local_peer_id) return;

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

    /// Observer callback for PlatformEventBuffer - record network events to tape.
    fn tapePlatformObserver(ctx: *anyopaque, _: u32, event: Event) void {
        const self: *Engine = @ptrCast(@alignCast(ctx));

        // Skip NetPacketReceived - packets are recorded separately with raw bytes
        if (event.kind == .NetPacketReceived) return;

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

    /// Enable tape observers on InputBuffer and PlatformEventBuffer
    fn enableTapeObserver(self: *Engine) void {
        self.input_buffer.observer = IB.InputObserver{
            .callback = tapeInputObserver,
            .context = @ptrCast(self),
        };
        self.platform_buffer.observer = PEB.PlatformEventObserver{
            .callback = tapePlatformObserver,
            .context = @ptrCast(self),
        };
    }

    /// Disable tape observers
    fn disableTapeObserver(self: *Engine) void {
        self.input_buffer.observer = null;
        self.platform_buffer.observer = null;
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

    // Set up session via events (must happen before session init)
    engine.emit_net_peer_assign_local_id(0);
    engine.emit_net_peer_join(0);
    engine.emit_net_peer_join(1);
    engine.emit_net_session_init();

    // Advance to process events
    _ = engine.advance(hz);
    try std.testing.expectEqual(true, engine.inSession());

    // Advance some more frames
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
