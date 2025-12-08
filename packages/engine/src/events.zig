pub const MAX_EVENTS = 512;

pub const EventBuffer = extern struct {
    count: u16,
    _padding: [2]u8 = .{ 0, 0 },
    events: [MAX_EVENTS]Event,
};

pub const Event = extern struct {
    kind: EventType,
    source: InputSource = .None,
    _padding: [2]u8 = .{ 0, 0 },
    payload: EventPayload,

    pub inline fn keyDown(key: Key, source: InputSource) Event {
        return Event{
            .kind = .KeyDown,
            .source = source,
            .payload = .{ .key = key },
        };
    }

    pub inline fn keyUp(key: Key, source: InputSource) Event {
        return Event{
            .kind = .KeyUp,
            .source = source,
            .payload = .{ .key = key },
        };
    }

    pub inline fn mouseDown(button: MouseButton, source: InputSource) Event {
        return Event{
            .kind = .MouseDown,
            .source = source,
            .payload = .{ .mouse_button = button },
        };
    }

    pub inline fn mouseUp(button: MouseButton, source: InputSource) Event {
        return Event{
            .kind = .MouseUp,
            .source = source,
            .payload = .{ .mouse_button = button },
        };
    }

    pub inline fn mouseMove(x: f32, y: f32, source: InputSource) Event {
        return Event{
            .kind = .MouseMove,
            .source = source,
            .payload = .{ .mouse_move = .{ .x = x, .y = y } },
        };
    }

    pub inline fn mouseWheel(delta_x: f32, delta_y: f32, source: InputSource) Event {
        return Event{
            .kind = .MouseWheel,
            .source = source,
            .payload = .{ .delta = .{ .delta_x = delta_x, .delta_y = delta_y } },
        };
    }

    pub inline fn frameStart(frame_number: u32) Event {
        return Event{
            .kind = .FrameStart,
            .source = .None,
            .payload = .{ .frame_number = frame_number },
        };
    }
};

pub const EventPayload = extern union {
    key: Key,
    mouse_button: MouseButton,
    mouse_move: extern struct { x: f32, y: f32 },
    delta: extern struct { delta_x: f32, delta_y: f32 },
    frame_number: u32,
};

pub const EventType = enum(u8) {
    None = 0,
    KeyDown = 1,
    KeyUp,
    MouseMove,
    MouseDown,
    MouseUp,
    MouseWheel,
    /// Frame is complete. Frame number payload indicates which frame has completed its events
    FrameStart,
};

// https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/button#value
// shifted by 1 for None value
pub const MouseButton = enum(u8) {
    None = 0,
    Left,
    Middle,
    Right,
    X1,
    X2,
    X3,
    X4,
    X5,
};

pub const Key = enum(u8) {
    None = 0,
    Backquote = 1,
    Backslash,
    BracketLeft,
    BracketRight,
    Comma,
    Digit0,
    Digit1,
    Digit2,
    Digit3,
    Digit4,
    Digit5,
    Digit6,
    Digit7,
    Digit8,
    Digit9,
    Equal,
    IntlBackslash,
    IntlRo,
    IntlYen,
    KeyA,
    KeyB,
    KeyC,
    KeyD,
    KeyE,
    KeyF,
    KeyG,
    KeyH,
    KeyI,
    KeyJ,
    KeyK,
    KeyL,
    KeyM,
    KeyN,
    KeyO,
    KeyP,
    KeyQ,
    KeyR,
    KeyS,
    KeyT,
    KeyU,
    KeyV,
    KeyW,
    KeyX,
    KeyY,
    KeyZ,
    Minus,
    Period,
    Quote,
    Semicolon,
    Slash,
    AltLeft,
    AltRight,
    Backspace,
    CapsLock,
    ContextMenu,
    ControlLeft,
    ControlRight,
    Enter,
    MetaLeft,
    MetaRight,
    ShiftLeft,
    ShiftRight,
    Space,
    Tab,
    Convert,
    KanaMode,
    Lang1,
    Lang2,
    Lang3,
    Lang4,
    Lang5,
    NonConvert,
    Delete,
    End,
    Help,
    Home,
    Insert,
    PageDown,
    PageUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    NumLock,
    Numpad0,
    Numpad1,
    Numpad2,
    Numpad3,
    Numpad4,
    Numpad5,
    Numpad6,
    Numpad7,
    Numpad8,
    Numpad9,
    NumpadAdd,
    NumpadBackspace,
    NumpadClear,
    NumpadClearEntry,
    NumpadComma,
    NumpadDecimal,
    NumpadDivide,
    NumpadEnter,
    NumpadEqual,
    NumpadHash,
    NumpadMemoryAdd,
    NumpadMemoryClear,
    NumpadMemoryRecall,
    NumpadMemoryStore,
    NumpadMemorySubtract,
    NumpadMultiply,
    NumpadParenLeft,
    NumpadParenRight,
    NumpadStar,
    NumpadSubtract,
    Escape,
    Fn,
    FnLock,
    PrintScreen,
    ScrollLock,
    Pause,
    BrowserBack,
    BrowserFavorites,
    BrowserForward,
    BrowserHome,
    BrowserRefresh,
    BrowserSearch,
    BrowserStop,
    Eject,
    LaunchApp1,
    LaunchApp2,
    LaunchMail,
    MediaPlayPause,
    MediaSelect,
    MediaStop,
    MediaTrackNext,
    MediaTrackPrevious,
    Power,
    Sleep,
    AudioVolumeDown,
    AudioVolumeMute,
    AudioVolumeUp,
    WakeUp,
    Hyper,
    Super,
    Turbo,
    Abort,
    Resume,
    Suspend,
    Again,
    Copy,
    Cut,
    Find,
    Open,
    Paste,
    Props,
    Select,
    Undo,
    Hiragana,
    Katakana,
    F1,
    F2,
    F3,
    F4,
    F5,
    F6,
    F7,
    F8,
    F9,
    F10,
    F11,
    F12,
    F13,
    F14,
    F15,
    F16,
    F17,
    F18,
    F19,
    F20,
    F21,
    F22,
    F23,
    F24,
    F25,
    F26,
    F27,
    F28,
    F29,
    F30,
    F31,
    F32,
    F33,
    F34,
    F35,
};

/// Input source identifies where an input event originated from.
/// Used for multiplayer to distinguish local vs remote inputs.
pub const InputSource = enum(u8) {
    /// Unset source
    None = 0,

    // Local input devices (1-127)
    LocalKeyboard = 1,
    LocalMouse = 2,
    LocalTouch = 3,
    LocalGamepad0 = 4,
    LocalGamepad1 = 5,
    LocalGamepad2 = 6,
    LocalGamepad3 = 7,
    LocalGamepad4 = 8,
    LocalGamepad5 = 9,
    LocalGamepad6 = 10,
    LocalGamepad7 = 11,
    LocalGamepad8 = 12,
    LocalGamepad9 = 13,
    LocalGamepad10 = 14,
    LocalGamepad11 = 15,
    // 16-127 reserved for future local sources

    // Remote peers (128-254)
    RemotePeer0 = 128,
    RemotePeer1 = 129,
    RemotePeer2 = 130,
    RemotePeer3 = 131,
    RemotePeer4 = 132,
    RemotePeer5 = 133,
    RemotePeer6 = 134,
    RemotePeer7 = 135,
    RemotePeer8 = 136,
    RemotePeer9 = 137,
    RemotePeer10 = 138,
    RemotePeer11 = 139,
    // 140-254 reserved for additional remote peers

    /// Invalid/unmapped source
    Unmapped = 255,

    pub fn isLocal(self: InputSource) bool {
        const val = @intFromEnum(self);
        return val >= 1 and val < 128;
    }

    pub fn isRemote(self: InputSource) bool {
        const val = @intFromEnum(self);
        return val >= 128 and val < 255;
    }

    pub fn remotePeerIndex(self: InputSource) ?u8 {
        if (!self.isRemote()) return null;
        return @intFromEnum(self) - 128;
    }
};
