const Events = @import("events.zig");
pub const TimeCtx = extern struct {
    frame: u32,
    dt_ms: u32,
    total_ms: u64,
    is_resimulating: u8 = 0, // 1 during rollback resimulation
};

/// Network status values
pub const NetStatus = enum(u8) {
    offline = 0,
    local = 1,
    join_pending = 2,
    connected = 3,
    disconnected = 4,
};

/// Per-peer connection and synchronization state (8 bytes)
pub const PeerCtx = extern struct {
    connected: u8 = 0, // offset 0: 1 = connected
    packet_count: u8 = 0, // offset 1: packets received (0 = no data yet)
    seq: u16 = 0, // offset 2: Latest frame received from this peer
    ack: u16 = 0, // offset 4: Latest frame this peer acked from us
    ack_count: u8 = 0, // offset 6: acks received (0 = no ack yet)
    _pad: u8 = 0, // offset 7: padding for alignment
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

    _pad: [3]u8 = .{ 0, 0, 0 }, // offset 29, align for peers array

    // Per-peer state (AoS layout, 72 bytes = 12 × 6)
    peers: [12]PeerCtx = [_]PeerCtx{.{}} ** 12, // offset 32
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

test "NetCtx peer connected tracking" {
    var net_ctx = NetCtx{
        .peer_count = 0,
        .match_frame = 0,
    };

    // Initially all peers disconnected
    for (net_ctx.peers) |peer| {
        try std.testing.expectEqual(@as(u8, 0), peer.connected);
    }

    // Mark peer 0 and 1 as connected
    net_ctx.peers[0].connected = 1;
    net_ctx.peers[1].connected = 1;

    try std.testing.expectEqual(@as(u8, 1), net_ctx.peers[0].connected);
    try std.testing.expectEqual(@as(u8, 1), net_ctx.peers[1].connected);
    try std.testing.expectEqual(@as(u8, 0), net_ctx.peers[2].connected);

    // Disconnect peer 0
    net_ctx.peers[0].connected = 0;
    try std.testing.expectEqual(@as(u8, 0), net_ctx.peers[0].connected);
    try std.testing.expectEqual(@as(u8, 1), net_ctx.peers[1].connected);
}

test "NetCtx and PeerCtx layout" {
    const net_offset = @offsetOf(NetCtx, "peers");
    try std.testing.expectEqual(@as(usize, 32), net_offset);
    try std.testing.expectEqual(@as(usize, 8), @sizeOf(PeerCtx));
    try std.testing.expectEqual(@as(usize, 0), @offsetOf(PeerCtx, "connected"));
    try std.testing.expectEqual(@as(usize, 1), @offsetOf(PeerCtx, "packet_count"));
    try std.testing.expectEqual(@as(usize, 2), @offsetOf(PeerCtx, "seq"));
    try std.testing.expectEqual(@as(usize, 4), @offsetOf(PeerCtx, "ack"));
    try std.testing.expectEqual(@as(usize, 6), @offsetOf(PeerCtx, "ack_count"));
}

test "NetCtx seq/ack updates" {
    var net_ctx = NetCtx{
        .peer_count = 2,
        .match_frame = 0,
    };

    // Initially all seq/ack/packet_count are 0
    try std.testing.expectEqual(@as(u16, 0), net_ctx.peers[0].seq);
    try std.testing.expectEqual(@as(u16, 0), net_ctx.peers[0].ack);
    try std.testing.expectEqual(@as(u8, 0), net_ctx.peers[0].packet_count);

    // Update seq/ack for peer 1
    net_ctx.peers[1].seq = 100;
    net_ctx.peers[1].ack = 50;
    net_ctx.peers[1].packet_count = 1;

    try std.testing.expectEqual(@as(u16, 100), net_ctx.peers[1].seq);
    try std.testing.expectEqual(@as(u16, 50), net_ctx.peers[1].ack);
    try std.testing.expectEqual(@as(u8, 1), net_ctx.peers[1].packet_count);

    // Peer 0 should still be 0
    try std.testing.expectEqual(@as(u16, 0), net_ctx.peers[0].seq);

    // Reset peer 1 (on disconnect)
    net_ctx.peers[1] = .{};

    try std.testing.expectEqual(@as(u16, 0), net_ctx.peers[1].seq);
    try std.testing.expectEqual(@as(u16, 0), net_ctx.peers[1].ack);
    try std.testing.expectEqual(@as(u8, 0), net_ctx.peers[1].packet_count);
}
