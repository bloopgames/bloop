const Events = @import("events.zig");
pub const TimeCtx = extern struct { frame: u32, dt_ms: u32, total_ms: u64 };

pub const InputCtx = extern struct {
    key_ctx: KeyCtx,
    mouse_ctx: MouseCtx,

    pub fn process_event(self: *InputCtx, event: Events.Event) void {
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
};

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
