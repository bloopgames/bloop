pub const Event = extern struct {
    kind: EventType,
    payload: EventPayload,

    pub inline fn keyDown(key: u8) Event {
        return Event{
            .kind = .KeyDown,
            .payload = .{ .key_down = KeyDown{ .key = key } },
        };
    }
};

pub const EventBuffer = struct {
    count: u8,
    events: [256]Event,
};

pub const EventType = enum(u8) {
    KeyDown = 1,
    KeyUp,
    MouseMove,
    MouseDown,
    MouseUp,
    MouseWheel,
};

pub const KeyDown = extern struct { key: u8 };
pub const KeyUp = extern struct { key: u8 };
pub const MouseMove = extern struct { x: f32, y: f32 };
pub const MouseDown = extern struct { button: u8 };
pub const MouseUp = extern struct { button: u8 };
pub const MouseWheel = extern struct { delta_x: f32, delta_y: f32 };

pub const EventPayload = extern union {
    key_down: KeyDown,
    key_up: KeyUp,
    mouse_move: MouseMove,
    mouse_down: MouseDown,
    mouse_up: MouseUp,
    mouse_wheel: MouseWheel,
};
