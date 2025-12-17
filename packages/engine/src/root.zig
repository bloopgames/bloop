// Root module - Engine coordinator and test imports
const std = @import("std");
const SimMod = @import("sim.zig");
const Sim = SimMod.Sim;
const Tapes = @import("tapes/tapes.zig");
const Transport = @import("netcode/transport.zig");
const Events = @import("events.zig");

pub const hz = SimMod.hz;

/// Engine coordinates the simulation, managing timing, sessions, tapes, and network.
/// This is the unit-testable orchestration layer that sits above Sim.
///
/// Phase 1: Engine wraps Sim. Fields will be migrated from Sim to Engine incrementally.
pub const Engine = struct {
    /// The simulation (currently owns most state - will be slimmed down)
    sim: *Sim,
    /// Frame timing accumulator (moved from Sim in Phase 2)
    accumulator: u32 = 0,
    /// Allocator for engine resources
    allocator: std.mem.Allocator,

    // Fields to be migrated from Sim:
    // - vcr (Phase 4)
    // - input_buffer (Phase 5)
    // - session (Phase 3)
    // - net, net_ctx (Phase 5)
    // - confirmed_snapshot (Phase 3)

    /// Initialize engine with a new simulation
    pub fn init(allocator: std.mem.Allocator, ctx_ptr: usize) !Engine {
        const sim = try allocator.create(Sim);
        sim.* = try Sim.init(allocator, ctx_ptr);

        return Engine{
            .sim = sim,
            .allocator = allocator,
        };
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
            if (self.sim.vcr.is_replaying) {
                self.sim.replay_tape_session_events();
                self.sim.replay_tape_packets();
                self.sim.replay_tape_inputs();
            }

            // Notify host before each simulation step
            if (self.sim.callbacks.before_frame) |before_frame| {
                before_frame(self.sim.time.frame);
            }

            // If in a session, handle rollback
            if (self.sim.session.active) {
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
    // Session management (moved from Sim in Phase 3)
    // ─────────────────────────────────────────────────────────────

    /// Session-aware step that handles rollback when late inputs arrive
    fn sessionStep(self: *Engine) void {
        const sim = self.sim;

        // The frame we're about to process (after this tick, match_frame will be this value)
        const target_match_frame = sim.session.getMatchFrame(sim.time.frame) + 1;

        // Calculate how many frames can be confirmed based on received inputs
        const next_confirm = sim.input_buffer.calculateNextConfirmFrame(target_match_frame);
        const current_confirmed = sim.session.confirmed_frame;

        if (next_confirm > current_confirmed) {
            // New confirmed frames available - need to rollback and resim
            const rollback_depth = target_match_frame - 1 - current_confirmed;
            if (rollback_depth > Transport.MAX_ROLLBACK_FRAMES) {
                @panic("Rollback depth exceeds MAX_ROLLBACK_FRAMES - ring buffer would wrap");
            }

            // 1. Restore to confirmed state
            if (sim.confirmed_snapshot) |snap| {
                sim.restore(snap);
            }

            // 2. Resim confirmed frames with all peer inputs
            var frames_resimmed: u32 = 0;
            var f = current_confirmed + 1;
            while (f <= next_confirm) : (f += 1) {
                const is_current_frame = (f == target_match_frame);
                sim.tick(!is_current_frame);
                if (!is_current_frame) {
                    frames_resimmed += 1;
                }
            }

            // 3. Update confirmed snapshot
            if (sim.confirmed_snapshot) |old_snap| {
                old_snap.deinit(sim.allocator);
            }
            sim.confirmed_snapshot = sim.take_snapshot(sim.getUserDataLen()) catch null;

            // 4. If we haven't reached target_match_frame yet, predict forward
            if (next_confirm < target_match_frame) {
                f = next_confirm + 1;
                while (f <= target_match_frame) : (f += 1) {
                    const is_current_frame = (f == target_match_frame);
                    sim.tick(!is_current_frame);
                    if (!is_current_frame) {
                        frames_resimmed += 1;
                    }
                }
            }

            // Update session with new confirmed frame and stats
            sim.session.confirmFrame(next_confirm, frames_resimmed);
        } else {
            // No rollback needed - this is the target frame, not resimulating
            sim.tick(false);
        }

        // Always advance local peer's confirmed frame, even if there's no input.
        if (target_match_frame > sim.input_buffer.peer_confirmed[sim.session.local_peer_id]) {
            sim.input_buffer.peer_confirmed[sim.session.local_peer_id] = target_match_frame;
        }
    }

    /// Free all engine resources
    pub fn deinit(self: *Engine) void {
        self.sim.deinit();
        self.allocator.destroy(self.sim);
    }

    // ─────────────────────────────────────────────────────────────
    // Tape control (moved from Sim in Phase 4)
    // ─────────────────────────────────────────────────────────────

    pub const RecordingError = SimMod.Sim.RecordingError;

    /// Start recording to a new tape
    pub fn startRecording(self: *Engine, user_data_len: u32, max_events: u32, max_packet_bytes: u32) RecordingError!void {
        return self.sim.start_recording(user_data_len, max_events, max_packet_bytes);
    }

    /// Stop recording
    pub fn stopRecording(self: *Engine) void {
        self.sim.stop_recording();
    }

    /// Load a tape from raw bytes (enters replay mode)
    pub fn loadTape(self: *Engine, tape_buf: []u8) !void {
        return self.sim.load_tape(tape_buf);
    }

    /// Get the current tape buffer (for serialization)
    pub fn getTapeBuffer(self: *Engine) ?[]u8 {
        return self.sim.get_tape_buffer();
    }

    // ─────────────────────────────────────────────────────────────
    // Accessors - temporary bridges until fields migrate
    // ─────────────────────────────────────────────────────────────

    /// Check if recording (vcr will move to Engine in Phase 4)
    pub fn isRecording(self: *const Engine) bool {
        return self.sim.vcr.is_recording;
    }

    /// Check if replaying (vcr will move to Engine in Phase 4)
    pub fn isReplaying(self: *const Engine) bool {
        return self.sim.vcr.is_replaying;
    }

    /// Check if session is active (session will move to Engine in Phase 3)
    pub fn inSession(self: *const Engine) bool {
        return self.sim.session.active;
    }

    // ─────────────────────────────────────────────────────────────
    // Session lifecycle (Phase 5)
    // ─────────────────────────────────────────────────────────────

    /// Initialize a multiplayer session with rollback support
    pub fn sessionInit(self: *Engine, peer_count: u8, user_data_len: u32) !void {
        return self.sim.sessionInit(peer_count, user_data_len);
    }

    /// End the current session
    pub fn sessionEnd(self: *Engine) void {
        self.sim.sessionEnd();
    }

    /// Emit inputs for a peer at a given match frame
    pub fn sessionEmitInputs(self: *Engine, peer: u8, match_frame: u32, events: []const Events.Event) void {
        self.sim.sessionEmitInputs(peer, match_frame, events);
    }

    // ─────────────────────────────────────────────────────────────
    // Peer management (Phase 5)
    // ─────────────────────────────────────────────────────────────

    /// Set local peer ID for packet encoding
    pub fn setLocalPeer(self: *Engine, peer_id: u8) void {
        self.sim.setLocalPeer(peer_id);
    }

    /// Mark a peer as connected
    pub fn connectPeer(self: *Engine, peer_id: u8) void {
        self.sim.connectPeer(peer_id);
    }

    /// Mark a peer as disconnected
    pub fn disconnectPeer(self: *Engine, peer_id: u8) void {
        self.sim.disconnectPeer(peer_id);
    }

    // ─────────────────────────────────────────────────────────────
    // Network packets (Phase 5)
    // ─────────────────────────────────────────────────────────────

    /// Build an outbound packet for a target peer
    pub fn buildOutboundPacket(self: *Engine, target_peer: u8) void {
        self.sim.buildOutboundPacket(target_peer);
    }

    /// Get pointer to the outbound packet buffer
    pub fn getOutboundPacketPtr(self: *const Engine) usize {
        return self.sim.getOutboundPacketPtr();
    }

    /// Get length of the outbound packet
    pub fn getOutboundPacketLen(self: *const Engine) u32 {
        return self.sim.getOutboundPacketLen();
    }

    /// Process a received packet
    pub fn receivePacket(self: *Engine, ptr: usize, len: u32) u8 {
        return self.sim.receivePacket(ptr, len);
    }

    /// Get seq for a peer (latest frame received from them)
    pub fn getPeerSeq(self: *const Engine, peer: u8) u16 {
        return self.sim.getPeerSeq(peer);
    }

    /// Get ack for a peer (latest frame they acked from us)
    pub fn getPeerAck(self: *const Engine, peer: u8) u16 {
        return self.sim.getPeerAck(peer);
    }

    // ─────────────────────────────────────────────────────────────
    // Session state accessors (Phase 5)
    // ─────────────────────────────────────────────────────────────

    /// Get current match frame (0 if no session)
    pub fn getMatchFrame(self: *const Engine) u32 {
        return self.sim.getMatchFrame();
    }

    /// Get confirmed frame (0 if no session)
    pub fn getConfirmedFrame(self: *const Engine) u32 {
        return self.sim.getConfirmedFrame();
    }

    /// Get confirmed frame for a specific peer
    pub fn getPeerFrame(self: *const Engine, peer: u8) u32 {
        return self.sim.getPeerFrame(peer);
    }

    /// Get rollback depth (match_frame - confirmed_frame)
    pub fn getRollbackDepth(self: *const Engine) u32 {
        return self.sim.getRollbackDepth();
    }

    // ─────────────────────────────────────────────────────────────
    // Seek (Phase 6)
    // ─────────────────────────────────────────────────────────────

    /// Seek to a specific frame using the current tape
    /// Restores closest snapshot and resimulates forward
    pub fn seek(self: *Engine, frame: u32) void {
        if (!self.sim.vcr.hasTape()) {
            @panic("Tried to seek to frame without an active tape");
        }

        const snapshot = self.sim.vcr.closestSnapshot(frame) orelse @panic("No snapshot found for seek");
        self.sim.restore(snapshot);

        // Remember if we were already replaying (from loadTape)
        const was_replaying = self.sim.vcr.is_replaying;

        // Enter replay mode for resimulation
        self.sim.vcr.enterReplayMode();

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
            self.sim.vcr.exitReplayMode();
        }
    }
};

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

test "Engine init and deinit" {
    var engine = try Engine.init(std.testing.allocator, 0);
    defer engine.deinit();

    // Verify initial state
    try std.testing.expectEqual(@as(u32, 0), engine.accumulator);
    try std.testing.expectEqual(false, engine.inSession());
    try std.testing.expectEqual(false, engine.isRecording());
    try std.testing.expectEqual(false, engine.isReplaying());
}

test "Engine advance accumulates time" {
    var engine = try Engine.init(std.testing.allocator, 0);
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
