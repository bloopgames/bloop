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
const Log = @import("log.zig");

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

        // Take initial confirmed snapshot for unified stepping path
        // Local mode uses the same rollback infrastructure as sessions
        const confirmed_snapshot = sim.take_snapshot(0) catch null;

        return Engine{
            .sim = sim,
            .allocator = allocator,
            .vcr = VCR.init(allocator),
            .input_buffer = input_buffer,
            .platform_buffer = platform_buffer,
            .net = net,
            .confirmed_snapshot = confirmed_snapshot,
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

                // Initialize session state in net_ctx
                self.sim.net_ctx.in_session = 1;
                self.sim.net_ctx.session_start_frame = start_frame;
                self.sim.net_ctx.peers[local_peer_id].connected = 1;
                // Reset rollback stats for new session
                self.sim.net_ctx.last_rollback_depth = 0;
                self.sim.net_ctx.total_rollbacks = 0;
                self.sim.net_ctx.frames_resimulated = 0;

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

        // match_frame was already set by beforeTickListener - no update needed here.
        // The value represents the frame we just processed (elapsed frames since session start).

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

    /// Get the confirmed match frame from the confirmed_snapshot.
    /// Returns -1 if no snapshot exists or if snapshot is from session start (before any frames processed).
    /// After processing match_frame N, snapshot has time.frame = session_start + N + 1,
    /// so confirmed_match_frame = time.frame - session_start - 1.
    fn getConfirmedMatchFrame(self: *const Engine) i32 {
        if (self.confirmed_snapshot) |snap| {
            if (snap.time.frame < snap.net.session_start_frame) {
                @panic("confirmed snapshot time.frame < session_start_frame");
            }
            // Initial snapshot taken at session start has time.frame == session_start
            // This represents "before frame 0", so nothing is confirmed yet
            if (snap.time.frame == snap.net.session_start_frame) return -1;
            return @as(i32, @intCast(snap.time.frame - snap.net.session_start_frame)) - 1;
        }
        return -1;
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

            // Unified stepping path for both local and session modes
            // Local mode is a degenerate case where peer_count=1 and session_start_frame=0
            self.step();

            // Auto-exit replay mode when we've advanced past the tape's end
            // This allows live inputs to be accepted after tape playback completes
            if (self.vcr.is_replaying and self.vcr.hasTape()) {
                const tape_end_frame = self.vcr.tape.?.end_frame();
                if (self.sim.time.frame >= tape_end_frame) {
                    self.vcr.exitReplayMode();
                }
            }

            // Update match_frame to reflect new time.frame after tick
            // This is the user-facing value: elapsed frames since session start
            self.sim.net_ctx.match_frame = self.sim.time.frame - self.sim.net_ctx.session_start_frame;

            step_count += 1;
            self.accumulator -= hz;
        }
        return step_count;
    }

    // ─────────────────────────────────────────────────────────────
    // Session management
    // ─────────────────────────────────────────────────────────────

    /// Unified stepping logic for local and session modes.
    /// Both modes use the same confirmation path - local mode is a degenerate case
    /// where peer_count=1 and all frames are immediately confirmed.
    fn step(self: *Engine) void {
        const current_match_frame = self.sim.time.frame - self.sim.net_ctx.session_start_frame;
        const current_match_i32: i32 = @intCast(current_match_frame);

        // Advance local peer's confirmed frame before calculating next_confirm.
        // Local inputs are already in the buffer, so they're confirmed.
        if (current_match_i32 > self.input_buffer.peer_confirmed[self.sim.net_ctx.local_peer_id]) {
            self.input_buffer.peer_confirmed[self.sim.net_ctx.local_peer_id] = current_match_i32;
        }

        // Calculate confirmation boundaries
        const next_confirm = self.input_buffer.calculateNextConfirmFrame(current_match_frame);
        const current_confirmed = self.getConfirmedMatchFrame();

        Log.debug("step: time.frame={} match_frame={} next_confirm={} current_confirmed={} peer_count={} session_start={}", .{
            self.sim.time.frame,
            current_match_frame,
            next_confirm,
            current_confirmed,
            self.input_buffer.peer_count,
            self.sim.net_ctx.session_start_frame,
        });

        var ticked_current_frame = false;
        var did_restore = false;
        var confirm_frame: u32 = 0;

        // Handle confirmations if new frames can be confirmed
        if (next_confirm > current_confirmed) {
            confirm_frame = @intCast(next_confirm);
            const resim_start: u32 = if (current_confirmed < 0) 0 else @intCast(current_confirmed + 1);
            const gap = next_confirm - current_confirmed;

            const rollback_depth = current_match_i32 - current_confirmed;
            if (rollback_depth > Transport.MAX_ROLLBACK_FRAMES) {
                @panic("Rollback depth exceeds MAX_ROLLBACK_FRAMES - ring buffer would wrap");
            }

            // Skip restore if confirming exactly one frame (current frame) with no mispredictions.
            // In local mode, this is always true (we confirm each frame as we process it).
            const skip_restore = (next_confirm == current_match_i32) and (gap == 1);
            did_restore = !skip_restore;

            if (did_restore) {
                // Restore to confirmed state.
                // Preserve peers array (live connection tracking) and rollback stats.
                // Don't restore input buffer - it contains inputs from packets that triggered this rollback.
                const saved_peers = self.sim.net_ctx.peers;
                const saved_stats = .{
                    .last_rollback_depth = self.sim.net_ctx.last_rollback_depth,
                    .total_rollbacks = self.sim.net_ctx.total_rollbacks,
                    .frames_resimulated = self.sim.net_ctx.frames_resimulated,
                };
                if (self.confirmed_snapshot) |snap| {
                    self.sim.restore(snap, false);
                }
                self.sim.net_ctx.peers = saved_peers;
                self.sim.net_ctx.last_rollback_depth = saved_stats.last_rollback_depth;
                self.sim.net_ctx.total_rollbacks = saved_stats.total_rollbacks;
                self.sim.net_ctx.frames_resimulated = saved_stats.frames_resimulated;

                // Clear event buffer - events from snapshot would cause duplicates
                // since processPlatformEvents will re-forward them during resim.
                self.sim.events.count = 0;

                self.sim.net_ctx.total_rollbacks += 1;
            }

            self.sim.net_ctx.confirmed_match_frame = next_confirm;

            // Resim confirmed frames (up to and including confirm_frame)
            var f = resim_start;
            while (f <= confirm_frame) : (f += 1) {
                self.sim.net_ctx.match_frame = f;
                const is_current = (f == current_match_frame);
                self.sim.tick(!is_current);
                if (is_current) ticked_current_frame = true;
            }

            // Update confirmed snapshot
            if (self.confirmed_snapshot) |old_snap| {
                old_snap.deinit(self.allocator);
            }
            self.confirmed_snapshot = self.sim.take_snapshot(self.sim.getUserDataLen()) catch null;

            self.sim.net_ctx.last_rollback_depth = @intCast(gap);
        }

        // Tick remaining frames to reach current
        if (!ticked_current_frame) {
            // Determine where game state currently is:
            // - If we restored: game state is at confirm_frame
            // - If we didn't restore and current_match_frame > 0: game state is at current_match_frame - 1
            // - If we didn't restore and current_match_frame == 0: we haven't ticked anything yet (use -1)
            const game_state_at: i32 = if (did_restore)
                @intCast(confirm_frame)
            else if (current_match_frame > 0)
                @intCast(current_match_frame - 1)
            else
                -1; // Sentinel: haven't processed any frames yet

            // Tick prediction frames (if any gap between game state and current)
            var f: i32 = game_state_at + 1;
            const target: i32 = @intCast(current_match_frame);
            while (f <= target) : (f += 1) {
                self.sim.net_ctx.match_frame = @intCast(f);
                const is_current = (f == target);
                self.sim.tick(!is_current);
            }
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
        const start_frame = self.sim.time.frame;

        // If in active session with confirmed_snapshot, stitch together:
        // - The confirmed game state (from confirmed_snapshot)
        // - The current input buffer state (with all unconfirmed events)
        if (self.sim.net_ctx.in_session != 0 and self.confirmed_snapshot != null) {
            const confirmed = self.confirmed_snapshot.?;

            // Calculate input buffer size for current match frame
            const current_match_frame = self.sim.time.frame - self.sim.net_ctx.session_start_frame;
            const input_buffer_len = self.input_buffer.snapshotSize(current_match_frame);

            // Allocate new snapshot with space for current input buffer
            const tape_snapshot = Tapes.Snapshot.init(self.allocator, confirmed.user_data_len, input_buffer_len) catch {
                return RecordingError.OutOfMemory;
            };
            defer tape_snapshot.deinit(self.allocator);

            // Copy confirmed snapshot (struct header + user_data) via memcpy
            const confirmed_bytes: [*]const u8 = @ptrCast(confirmed);
            const tape_bytes: [*]u8 = @ptrCast(tape_snapshot);
            const copy_len = @sizeOf(Tapes.Snapshot) + confirmed.user_data_len;
            @memcpy(tape_bytes[0..copy_len], confirmed_bytes[0..copy_len]);

            // Update input_buffer_len (was overwritten by memcpy)
            tape_snapshot.input_buffer_len = input_buffer_len;

            // Write current input buffer data
            if (input_buffer_len > 0) {
                self.input_buffer.writeSnapshot(current_match_frame, tape_snapshot.input_buffer_data());
            }

            try self.vcr.startRecording(start_frame, tape_snapshot, max_events, max_packet_bytes);
        } else {
            const snapshot = self.sim.take_snapshot(user_data_len) catch {
                return RecordingError.OutOfMemory;
            };
            defer snapshot.deinit(self.allocator);
            try self.vcr.startRecording(start_frame, snapshot, max_events, max_packet_bytes);
        }

        // Capture any pending platform events for the current frame.
        // These were emitted before recording started (observer was null),
        // but need to be in the tape for proper replay.
        const pending_events = self.platform_buffer.get(start_frame);
        for (pending_events) |event| {
            self.vcr.tape.?.append_event(event) catch {
                @panic("Failed to append pending platform event to tape");
            };
        }

        // Capture any pending input events for the current frame.
        // Inputs captured at frame N are stored in InputBuffer[N].
        const pending_match_frame = start_frame - self.sim.net_ctx.session_start_frame;
        const local_peer = self.sim.net_ctx.local_peer_id;
        const pending_inputs = self.input_buffer.get(local_peer, pending_match_frame);
        for (pending_inputs) |event| {
            if (!self.vcr.recordEvent(event)) {
                @panic("Failed to record pending input event to tape");
            }
        }

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
        // Restore input buffer too - this is the initial tape state
        self.sim.restore(snapshot, true);

        if (snapshot.net.in_session == 0) {
            return;
        }

        // Clean up existing confirmed snapshot if any
        if (self.confirmed_snapshot) |snap| {
            snap.deinit(self.allocator);
            self.confirmed_snapshot = null;
        }
        self.net.deinit();

        // Session tapes must have input buffer data
        if (snapshot.input_buffer_len == 0) {
            @panic("Session tape missing input buffer data");
        }

        // Preserve observer (tape recording) across restore
        const saved_observer = self.input_buffer.observer;
        self.input_buffer.session_start_frame = snapshot.net.session_start_frame;
        self.input_buffer.observer = saved_observer;

        // Session state is already restored from snapshot (net_ctx.in_session, net_ctx.session_start_frame)
        // Reset rollback stats for replay
        self.sim.net_ctx.last_rollback_depth = 0;
        self.sim.net_ctx.total_rollbacks = 0;
        self.sim.net_ctx.frames_resimulated = 0;

        self.net.* = .{
            .allocator = self.allocator,
            .input_buffer = self.input_buffer,
            .net_ctx = self.sim.net_ctx,
        };

        // Take confirmed_snapshot for rollback during replay
        // TODO: why is this needed? couldn't we just use the snapshot we restored from?
        self.confirmed_snapshot = self.sim.take_snapshot(self.sim.getUserDataLen()) catch null;

        // Roll forward from snapshot (confirmed state) to tape start_frame (prediction state)
        // This happens when recording started mid-session with prediction ahead of confirmed
        const header = self.vcr.tape.?.get_header();
        if (header.start_frame > snapshot.time.frame) {
            while (self.sim.time.frame < header.start_frame) {
                const count = self.advance(hz);
                if (count == 0) {
                    @panic("Failed to advance frame during loadTape roll-forward");
                }
            }
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
        return self.sim.net_ctx.in_session != 0;
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

        self.net.deinit();
        self.net.* = .{
            .allocator = self.allocator,
            .input_buffer = self.input_buffer,
            .net_ctx = self.sim.net_ctx,
        };

        // Reset session state in net_ctx
        self.sim.net_ctx.in_session = 0;
        self.sim.net_ctx.peer_count = 0;
        self.sim.net_ctx.session_start_frame = 0;

        // Recreate confirmed snapshot for unified stepping path
        self.confirmed_snapshot = self.sim.take_snapshot(0) catch null;
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

        self.net.deinit();
        self.net.* = .{
            .allocator = self.allocator,
            .input_buffer = self.input_buffer,
            .net_ctx = self.sim.net_ctx,
        };

        // Reset session state in net_ctx
        self.sim.net_ctx.in_session = 0;
        self.sim.net_ctx.peer_count = 0;
        self.sim.net_ctx.session_start_frame = 0;

        // Recreate confirmed snapshot for unified stepping path
        self.confirmed_snapshot = self.sim.take_snapshot(0) catch null;
    }

    // ─────────────────────────────────────────────────────────────
    // Network packets
    // ─────────────────────────────────────────────────────────────

    /// Build an outbound packet for a target peer
    pub fn buildOutboundPacket(self: *Engine, target_peer: u8) void {
        const match_frame: u32 = if (self.sim.net_ctx.in_session != 0)
            self.sim.time.frame - self.sim.net_ctx.session_start_frame
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
        if (self.sim.net_ctx.in_session == 0) return 1;

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

    /// Emit a resize event. Updates ScreenCtx and adds event to current frame's event buffer.
    /// This is a platform event that reflects current viewport state (not recorded to tape).
    pub fn emit_resize(self: *Engine, width: u32, height: u32, physical_width: u32, physical_height: u32, pixel_ratio: f32) void {
        // Update screen context
        self.sim.screen_ctx.width = width;
        self.sim.screen_ctx.height = height;
        self.sim.screen_ctx.physical_width = physical_width;
        self.sim.screen_ctx.physical_height = physical_height;
        self.sim.screen_ctx.pixel_ratio = pixel_ratio;

        // Add resize event to current frame's event buffer
        const idx = self.sim.events.count;
        if (idx < Events.MAX_EVENTS) {
            self.sim.events.count += 1;
            self.sim.events.events[idx] = Event.resize();
        }
    }

    /// Append a fresh local event. Writes to Engine's canonical InputBuffer.
    fn appendInputEvent(self: *Engine, event: Event) void {
        // Inputs captured at frame N are stored in InputBuffer[N]
        const match_frame = self.sim.time.frame - self.sim.net_ctx.session_start_frame;

        // In session mode, use local_peer_id for network consistency
        // In non-session mode, preserve the event's peer_id for local multiplayer
        const peer_id = if (self.sim.net_ctx.in_session != 0) self.sim.net_ctx.local_peer_id else event.peer_id;

        // Tag the event with the resolved peer ID
        var local_event = event;
        local_event.peer_id = peer_id;

        // Write to canonical InputBuffer - observer handles tape recording
        self.input_buffer.emit(peer_id, match_frame, &[_]Event{local_event});

        // If in a session, extend unacked window for packet sending to peers
        if (self.sim.net_ctx.in_session != 0) {
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

    /// Get current match frame (next frame to process).
    /// In local mode: equals time.frame. In session mode: time.frame - session_start_frame.
    pub fn getMatchFrame(self: *const Engine) u32 {
        return self.sim.time.frame - self.sim.net_ctx.session_start_frame;
    }

    /// Get confirmed frame (-1 if no frames confirmed yet).
    /// In local mode: equals match_frame - 1 (always 1 frame ahead of confirmed).
    pub fn getConfirmedFrame(self: *const Engine) i32 {
        return self.getConfirmedMatchFrame();
    }

    /// Get confirmed frame for a specific peer (-1 = no inputs yet)
    pub fn getPeerFrame(self: *const Engine, peer: u8) i32 {
        if (peer >= IB.MAX_PEERS) return -1;
        return self.input_buffer.peer_confirmed[peer];
    }

    /// Get rollback depth (match_frame - confirmed_frame).
    /// In local mode: always 1 (single peer, immediate confirmation).
    pub fn getRollbackDepth(self: *const Engine) u32 {
        const match_frame: i32 = @intCast(self.sim.time.frame - self.sim.net_ctx.session_start_frame);
        const confirmed = self.getConfirmedMatchFrame();
        if (confirmed < 0) return @intCast(match_frame + 1); // No confirmed frames yet
        return @intCast(match_frame - confirmed);
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
        self.sim.restore(snapshot, true); // Restore input buffer for seek

        // Clear platform event buffer to avoid duplicate events during seek.
        // Events will be re-replayed from tape via replayTapeNetEvents() in advance().
        self.platform_buffer.* = .{};

        // Update confirmed_snapshot to match restored state
        // This ensures getConfirmedMatchFrame() returns a consistent value for step()
        if (self.confirmed_snapshot) |old| old.deinit(self.allocator);
        self.confirmed_snapshot = self.sim.take_snapshot(self.sim.getUserDataLen()) catch null;

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
        // -1 means no packets received yet, so any frame >= 0 is new
        const old_seq = peer.seq;

        // Update seq in NetCtx (single source of truth)
        const frame_seq_i16: i16 = @intCast(header.frame_seq);
        if (frame_seq_i16 > peer.seq) {
            peer.seq = frame_seq_i16;
        }

        // Update ack - what frame they've received from us
        // 0xFFFF is wire sentinel for "no ack yet" - don't update
        if (header.frame_ack != 0xFFFF) {
            const frame_ack_i16: i16 = @intCast(header.frame_ack);
            if (frame_ack_i16 > peer.ack) {
                peer.ack = frame_ack_i16;
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
            // old_seq is -1 if no packets received yet, so frame 0 naturally passes.
            const event_frame_i16: i16 = @intCast(wire_event.frame);
            if (event_frame_i16 > old_seq) {
                // Reconstruct full u32 frame from u16 + base_frame_high
                const full_frame = header.toFullFrame(wire_event.frame);
                self.input_buffer.emit(header.peer_id, full_frame, &[_]Event{input_event});
            }

            offset += Transport.WIRE_EVENT_SIZE;
        }

        // Update peer_confirmed even if there were no events.
        // The frame_seq tells us the peer has reached this frame,
        // which is sufficient for confirmation regardless of input activity.
        const full_frame_seq: i32 = @intCast(header.fullFrameSeq());
        if (full_frame_seq > self.input_buffer.peer_confirmed[header.peer_id]) {
            self.input_buffer.peer_confirmed[header.peer_id] = full_frame_seq;
        }
    }

    /// Replay input events from tape for the current frame.
    fn replayTapeInputs(self: *Engine) void {
        const tape_events = self.vcr.getEventsForFrame(self.sim.time.frame);
        for (tape_events) |event| {
            // Skip FrameStart markers and session events
            if (event.kind == .FrameStart or event.kind.isSessionEvent()) continue;

            // Inputs captured at frame N are stored in InputBuffer[N]
            const match_frame = self.sim.time.frame - self.sim.net_ctx.session_start_frame;

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

    // Emit keydown - goes to InputBuffer at match_frame = time.frame (0)
    engine.emit_keydown(.KeyA, 0);

    // Check InputBuffer has the event at frame 0 (inputs at frame N go to match_frame N)
    const events = engine.input_buffer.get(0, 0);
    try std.testing.expectEqual(@as(usize, 1), events.len);
    try std.testing.expectEqual(.KeyDown, events[0].kind);
    try std.testing.expectEqual(.KeyA, events[0].payload.key);
    try std.testing.expectEqual(.LocalKeyboard, events[0].device);

    // Emit keyup - also goes to InputBuffer at frame 0
    engine.emit_keyup(.KeyA, 0);
    const events2 = engine.input_buffer.get(0, 0);
    try std.testing.expectEqual(@as(usize, 2), events2.len);
    try std.testing.expectEqual(.KeyUp, events2[1].kind);
}

test "Engine emit_mousemove adds event to InputBuffer" {
    var engine = try Engine.init(std.testing.allocator, 0);
    engine.wireListeners();
    defer engine.deinit();

    engine.emit_mousemove(100.5, 200.5, 0);

    // Check InputBuffer has the event at frame 0 (inputs at frame N go to match_frame N)
    const events = engine.input_buffer.get(0, 0);
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
}
