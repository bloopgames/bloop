pub const TimeCtx = extern struct { frame: u32, dt_ms: u32, total_ms: u64 };

pub const InputCtx = extern struct {
    key_ctx: KeyCtx,
    mouse_ctx: MouseCtx,
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
