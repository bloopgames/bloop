const std = @import("std");

/// Statistics for rollback introspection
pub const RollbackStats = struct {
    last_rollback_depth: u32 = 0,
    total_rollbacks: u32 = 0,
    frames_resimulated: u64 = 0,
};

/// Session manages multiplayer session state and rollback tracking.
/// This is a value type that can be embedded in Sim.
pub const Session = struct {
    /// Frame when session started (absolute frame number)
    start_frame: u32 = 0,
    /// Number of peers in this session
    peer_count: u8 = 0,
    /// Whether a session is currently active
    active: bool = false,
    /// Last confirmed frame (relative to session start)
    confirmed_frame: u32 = 0,
    /// Rollback statistics
    stats: RollbackStats = .{},

    /// Start a new session at the given frame
    pub fn start(self: *Session, current_frame: u32, peer_count_arg: u8) void {
        self.start_frame = current_frame;
        self.peer_count = peer_count_arg;
        self.confirmed_frame = 0;
        self.stats = .{};
        self.active = true;
    }

    /// End the current session
    pub fn end(self: *Session) void {
        self.start_frame = 0;
        self.peer_count = 0;
        self.confirmed_frame = 0;
        self.stats = .{};
        self.active = false;
    }

    /// Get current match frame (frames since session start)
    /// Returns 0 if no session is active
    pub fn getMatchFrame(self: *const Session, current_frame: u32) u32 {
        if (!self.active) return 0;
        return current_frame - self.start_frame;
    }

    /// Get the confirmed frame
    /// Returns 0 if no session is active
    pub fn getConfirmedFrame(self: *const Session) u32 {
        if (!self.active) return 0;
        return self.confirmed_frame;
    }

    /// Get rollback depth (match_frame - confirmed_frame)
    /// Returns 0 if no session is active
    pub fn getRollbackDepth(self: *const Session, current_frame: u32) u32 {
        if (!self.active) return 0;
        const match_frame = current_frame - self.start_frame;
        return match_frame - self.confirmed_frame;
    }

    /// Update confirmed frame and record rollback statistics if needed
    pub fn confirmFrame(self: *Session, new_confirmed: u32, frames_resimulated: u32) void {
        if (new_confirmed > self.confirmed_frame) {
            const rollback_depth = new_confirmed - self.confirmed_frame;
            if (frames_resimulated > 0) {
                self.stats.last_rollback_depth = rollback_depth;
                self.stats.total_rollbacks += 1;
                self.stats.frames_resimulated += frames_resimulated;
            }
            self.confirmed_frame = new_confirmed;
        }
    }

    /// Check if session is active
    pub fn isActive(self: *const Session) bool {
        return self.active;
    }
};

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

test "Session init and end" {
    var session = Session{};

    try std.testing.expectEqual(false, session.active);
    try std.testing.expectEqual(@as(u32, 0), session.start_frame);

    session.start(100, 2);

    try std.testing.expectEqual(true, session.active);
    try std.testing.expectEqual(@as(u32, 100), session.start_frame);
    try std.testing.expectEqual(@as(u8, 2), session.peer_count);
    try std.testing.expectEqual(@as(u32, 0), session.confirmed_frame);

    session.end();

    try std.testing.expectEqual(false, session.active);
    try std.testing.expectEqual(@as(u32, 0), session.start_frame);
    try std.testing.expectEqual(@as(u8, 0), session.peer_count);
}

test "Session getMatchFrame" {
    var session = Session{};

    // No session active
    try std.testing.expectEqual(@as(u32, 0), session.getMatchFrame(50));

    session.start(100, 2);

    // Match frame is current - start
    try std.testing.expectEqual(@as(u32, 0), session.getMatchFrame(100));
    try std.testing.expectEqual(@as(u32, 5), session.getMatchFrame(105));
    try std.testing.expectEqual(@as(u32, 50), session.getMatchFrame(150));
}

test "Session getRollbackDepth" {
    var session = Session{};

    // No session active
    try std.testing.expectEqual(@as(u32, 0), session.getRollbackDepth(50));

    session.start(100, 2);

    // At frame 105, match_frame = 5, confirmed = 0, depth = 5
    try std.testing.expectEqual(@as(u32, 5), session.getRollbackDepth(105));

    // Confirm frame 3
    session.confirmed_frame = 3;
    // At frame 105, match_frame = 5, confirmed = 3, depth = 2
    try std.testing.expectEqual(@as(u32, 2), session.getRollbackDepth(105));
}

test "Session confirmFrame tracks stats" {
    var session = Session{};
    session.start(0, 2);

    try std.testing.expectEqual(@as(u32, 0), session.stats.total_rollbacks);

    // Confirm with resimulation
    session.confirmFrame(5, 3);

    try std.testing.expectEqual(@as(u32, 5), session.confirmed_frame);
    try std.testing.expectEqual(@as(u32, 1), session.stats.total_rollbacks);
    try std.testing.expectEqual(@as(u32, 5), session.stats.last_rollback_depth);
    try std.testing.expectEqual(@as(u64, 3), session.stats.frames_resimulated);

    // Confirm more frames with resimulation
    session.confirmFrame(10, 4);

    try std.testing.expectEqual(@as(u32, 10), session.confirmed_frame);
    try std.testing.expectEqual(@as(u32, 2), session.stats.total_rollbacks);
    try std.testing.expectEqual(@as(u32, 5), session.stats.last_rollback_depth);
    try std.testing.expectEqual(@as(u64, 7), session.stats.frames_resimulated);
}

test "Session confirmFrame without resimulation" {
    var session = Session{};
    session.start(0, 2);

    // Confirm without resimulation (no rollback occurred)
    session.confirmFrame(5, 0);

    try std.testing.expectEqual(@as(u32, 5), session.confirmed_frame);
    try std.testing.expectEqual(@as(u32, 0), session.stats.total_rollbacks);
}
