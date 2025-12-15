const Events = @import("events.zig");
pub const TimeCtx = extern struct { frame: u32, dt_ms: u32, total_ms: u64 };

pub const NetCtx = extern struct {
    peer_count: u8,
    local_peer_id: u8 = 0,
    in_session: u8 = 0, // bool as u8 for alignment
    _pad1: u8 = 0,
    match_frame: u32,
    session_start_frame: u32 = 0,
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
