const Events = @import("events.zig");
pub const TimeCtx = extern struct { frame: u32, dt_ms: u32, total_ms: u64 };

/// Network status values
pub const NetStatus = enum(u8) {
    offline = 0,
    local = 1,
    join_pending = 2,
    connected = 3,
    disconnected = 4,
};

pub const NetCtx = extern struct {
    peer_count: u8,
    local_peer_id: u8 = 0,
    in_session: u8 = 0, // bool as u8 for alignment
    status: u8 = @intFromEnum(NetStatus.local), // NetStatus enum value
    match_frame: u32,
    session_start_frame: u32 = 0,
    room_code: [8]u8 = .{ 0, 0, 0, 0, 0, 0, 0, 0 }, // null-terminated room code
    // Game code writes to these, platform reads them
    wants_room_code: [8]u8 = .{ 0, 0, 0, 0, 0, 0, 0, 0 }, // offset 20
    wants_disconnect: u8 = 0, // offset 28

    // Per-peer connection state (12 bytes)
    peer_connected: [12]u8 = [_]u8{0} ** 12, // bool as u8 for alignment

    // Per-peer seq/ack tracking (48 bytes each = 144 bytes total)
    peer_remote_seq: [12]u16 = [_]u16{0} ** 12, // Latest frame received from each peer
    peer_remote_ack: [12]u16 = [_]u16{0} ** 12, // Latest frame each peer acked from us
    peer_local_seq: [12]u16 = [_]u16{0} ** 12, // Our latest frame sent to each peer

    _padding: [3]u8 = .{ 0, 0, 0 }, // alignment padding
};

pub const MAX_PLAYERS: u8 = 12;

pub const KeyCtx = extern struct {
    /// Each byte represents last 8 frames of input
    key_states: [256]u8,
};

pub const MouseCtx = extern struct {
    x: f32,
    y: f32,
    wheel_x: f32,
    wheel_y: f32,
    /// Each byte represents last 8 frames of input
    button_states: [8]u8,
};

/// Per-player input state
pub const PlayerInputs = extern struct {
    key_ctx: KeyCtx,
    mouse_ctx: MouseCtx,

    pub fn process_event(self: *PlayerInputs, event: Events.Event) void {
        switch (event.kind) {
            .KeyDown => {
                self.key_ctx.key_states[@intFromEnum(event.payload.key)] |= 1;
            },
            .KeyUp => {
                self.key_ctx.key_states[@intFromEnum(event.payload.key)] &= 0b11111110;
            },
            .MouseMove => {
                self.mouse_ctx.x = event.payload.mouse_move.x;
                self.mouse_ctx.y = event.payload.mouse_move.y;
            },
            .MouseDown => {
                self.mouse_ctx.button_states[@intFromEnum(event.payload.mouse_button)] |= 1;
            },
            .MouseUp => {
                self.mouse_ctx.button_states[@intFromEnum(event.payload.mouse_button)] &= 0b11111110;
            },
            .MouseWheel => {
                self.mouse_ctx.wheel_x = event.payload.delta.delta_x;
                self.mouse_ctx.wheel_y = event.payload.delta.delta_y;
            },
            else => {
                // no-op
            },
        }
    }

    pub fn age_states(self: *PlayerInputs) void {
        for (&self.key_ctx.key_states) |*state| {
            const held = state.* & 1;
            state.* = (state.* << 1) | held;
        }
        for (&self.mouse_ctx.button_states) |*state| {
            const held = state.* & 1;
            state.* = (state.* << 1) | held;
        }
        // Reset wheel deltas each frame
        self.mouse_ctx.wheel_x = 0;
        self.mouse_ctx.wheel_y = 0;
    }
};

pub const InputCtx = extern struct {
    /// Per-player input state
    players: [MAX_PLAYERS]PlayerInputs,

    /// Process an event and route it to the appropriate player based on peer_id.
    ///
    /// Mapping:
    /// - peer_id 0-11 → players[peer_id]
    /// - LOCAL_PEER (255) → player 0 (local input defaults to first player)
    pub fn process_event(self: *InputCtx, event: Events.Event) void {
        const player_index = peerIdToPlayerIndex(event.peer_id);
        if (player_index < MAX_PLAYERS) {
            self.players[player_index].process_event(event);
        }
    }

    /// Map a peer_id to a player index.
    /// peer_id 0-11 maps directly to player 0-11.
    /// LOCAL_PEER (255) maps to player 0 (local input without session).
    pub fn peerIdToPlayerIndex(peer_id: u8) u8 {
        if (peer_id == Events.LOCAL_PEER) {
            return 0;
        }
        return peer_id;
    }

    pub fn age_all_states(self: *InputCtx) void {
        // Age all players for now (could optimize to only active players)
        for (&self.players) |*player| {
            player.age_states();
        }
    }
};

const std = @import("std");

test "peerIdToPlayerIndex maps peer IDs directly" {
    try std.testing.expectEqual(@as(u8, 0), InputCtx.peerIdToPlayerIndex(0));
    try std.testing.expectEqual(@as(u8, 1), InputCtx.peerIdToPlayerIndex(1));
    try std.testing.expectEqual(@as(u8, 11), InputCtx.peerIdToPlayerIndex(11));
}

test "peerIdToPlayerIndex maps LOCAL_PEER to player 0" {
    try std.testing.expectEqual(@as(u8, 0), InputCtx.peerIdToPlayerIndex(Events.LOCAL_PEER));
}

test "NetCtx peer_connected tracking" {
    var net_ctx = NetCtx{
        .peer_count = 0,
        .match_frame = 0,
    };

    // Initially all peers disconnected
    for (net_ctx.peer_connected) |connected| {
        try std.testing.expectEqual(@as(u8, 0), connected);
    }

    // Mark peer 0 and 1 as connected
    net_ctx.peer_connected[0] = 1;
    net_ctx.peer_connected[1] = 1;

    try std.testing.expectEqual(@as(u8, 1), net_ctx.peer_connected[0]);
    try std.testing.expectEqual(@as(u8, 1), net_ctx.peer_connected[1]);
    try std.testing.expectEqual(@as(u8, 0), net_ctx.peer_connected[2]);

    // Disconnect peer 0
    net_ctx.peer_connected[0] = 0;
    try std.testing.expectEqual(@as(u8, 0), net_ctx.peer_connected[0]);
    try std.testing.expectEqual(@as(u8, 1), net_ctx.peer_connected[1]);
}

test "NetCtx seq/ack updates" {
    var net_ctx = NetCtx{
        .peer_count = 2,
        .match_frame = 0,
    };

    // Initially all seq/ack are 0
    try std.testing.expectEqual(@as(u16, 0), net_ctx.peer_remote_seq[0]);
    try std.testing.expectEqual(@as(u16, 0), net_ctx.peer_remote_ack[0]);
    try std.testing.expectEqual(@as(u16, 0), net_ctx.peer_local_seq[0]);

    // Update seq/ack for peer 1
    net_ctx.peer_remote_seq[1] = 100;
    net_ctx.peer_remote_ack[1] = 50;
    net_ctx.peer_local_seq[1] = 75;

    try std.testing.expectEqual(@as(u16, 100), net_ctx.peer_remote_seq[1]);
    try std.testing.expectEqual(@as(u16, 50), net_ctx.peer_remote_ack[1]);
    try std.testing.expectEqual(@as(u16, 75), net_ctx.peer_local_seq[1]);

    // Peer 0 should still be 0
    try std.testing.expectEqual(@as(u16, 0), net_ctx.peer_remote_seq[0]);

    // Reset peer 1 (on disconnect)
    net_ctx.peer_remote_seq[1] = 0;
    net_ctx.peer_remote_ack[1] = 0;
    net_ctx.peer_local_seq[1] = 0;

    try std.testing.expectEqual(@as(u16, 0), net_ctx.peer_remote_seq[1]);
    try std.testing.expectEqual(@as(u16, 0), net_ctx.peer_remote_ack[1]);
    try std.testing.expectEqual(@as(u16, 0), net_ctx.peer_local_seq[1]);
}
