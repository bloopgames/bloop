pub const MAX_EVENTS = 512;

pub const EventBuffer = extern struct {
    count: u16,
    _padding: [2]u8 = .{ 0, 0 },
    events: [MAX_EVENTS]Event,
};

/// Peer ID 255 indicates local input (not yet assigned to a session peer)
pub const LOCAL_PEER: u8 = 255;

pub const Event = extern struct {
    kind: EventType,
    /// Device that generated this input (keyboard, mouse, gamepad, etc.)
    device: InputSource = .None,
    /// Peer ID in the session (0-11), or LOCAL_PEER (255) for local unassigned input
    peer_id: u8 = LOCAL_PEER,
    _padding: [1]u8 = .{0},
    payload: EventPayload,

    pub inline fn keyDown(key: Key, peer_id: u8, device: InputSource) Event {
        return Event{
            .kind = .KeyDown,
            .device = device,
            .peer_id = peer_id,
            .payload = .{ .key = key },
        };
    }

    pub inline fn keyUp(key: Key, peer_id: u8, device: InputSource) Event {
        return Event{
            .kind = .KeyUp,
            .device = device,
            .peer_id = peer_id,
            .payload = .{ .key = key },
        };
    }

    pub inline fn mouseDown(button: MouseButton, peer_id: u8, device: InputSource) Event {
        return Event{
            .kind = .MouseDown,
            .device = device,
            .peer_id = peer_id,
            .payload = .{ .mouse_button = button },
        };
    }

    pub inline fn mouseUp(button: MouseButton, peer_id: u8, device: InputSource) Event {
        return Event{
            .kind = .MouseUp,
            .device = device,
            .peer_id = peer_id,
            .payload = .{ .mouse_button = button },
        };
    }

    pub inline fn mouseMove(x: f32, y: f32, peer_id: u8, device: InputSource) Event {
        return Event{
            .kind = .MouseMove,
            .device = device,
            .peer_id = peer_id,
            .payload = .{ .mouse_move = .{ .x = x, .y = y } },
        };
    }

    pub inline fn mouseWheel(delta_x: f32, delta_y: f32, peer_id: u8, device: InputSource) Event {
        return Event{
            .kind = .MouseWheel,
            .device = device,
            .peer_id = peer_id,
            .payload = .{ .delta = .{ .delta_x = delta_x, .delta_y = delta_y } },
        };
    }

    pub inline fn frameStart(frame_number: u32) Event {
        return Event{
            .kind = .FrameStart,
            .device = .None,
            .payload = .{ .frame_number = frame_number },
        };
    }

    /// Network event: successfully joined a room
    pub inline fn netJoinOk(room_code: [8]u8) Event {
        return Event{
            .kind = .NetJoinOk,
            .device = .None,
            .payload = .{ .room_code = room_code },
        };
    }

    /// Network event: failed to join a room
    pub inline fn netJoinFail(reason: NetJoinFailReason) Event {
        return Event{
            .kind = .NetJoinFail,
            .device = .None,
            .payload = .{ .join_fail_reason = reason },
        };
    }

    /// Network event: a peer joined the room
    pub inline fn netPeerJoin(peer_id: u8) Event {
        return Event{
            .kind = .NetPeerJoin,
            .device = .None,
            .payload = .{ .peer_id = peer_id },
        };
    }

    /// Network event: a peer left the room
    pub inline fn netPeerLeave(peer_id: u8) Event {
        return Event{
            .kind = .NetPeerLeave,
            .device = .None,
            .payload = .{ .peer_id = peer_id },
        };
    }

    /// Network event: assign local peer ID
    pub inline fn netPeerAssignLocalId(peer_id: u8) Event {
        return Event{
            .kind = .NetPeerAssignLocalId,
            .device = .None,
            .payload = .{ .peer_id = peer_id },
        };
    }
};

/// Reason for join failure
pub const NetJoinFailReason = enum(u8) {
    unknown = 0,
    timeout = 1,
    room_full = 2,
    room_not_found = 3,
    already_in_room = 4,
};

pub const EventPayload = extern union {
    key: Key,
    mouse_button: MouseButton,
    mouse_move: extern struct { x: f32, y: f32 },
    delta: extern struct { delta_x: f32, delta_y: f32 },
    frame_number: u32,
    /// Used by NetPeerJoin/NetPeerLeave (peer_id)
    peer_id: u8,
    /// Room code for NetJoinOk (8 bytes, null-terminated)
    room_code: [8]u8,
    /// Reason for NetJoinFail
    join_fail_reason: NetJoinFailReason,
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
    /// Network events (emitted by platform, stored in tape)
    NetJoinOk,
    NetJoinFail,
    NetPeerJoin,
    NetPeerLeave,
    NetPeerAssignLocalId,

    pub fn isSessionEvent(self: EventType) bool {
        _ = self;
        return false; // All session events removed
    }

    pub fn isNetEvent(self: EventType) bool {
        return switch (self) {
            .NetJoinOk, .NetJoinFail, .NetPeerJoin, .NetPeerLeave, .NetPeerAssignLocalId => true,
            else => false,
        };
    }
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
