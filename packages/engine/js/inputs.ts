import type { PlatformEvent } from "./events";

export type MouseButton =
  | "Left"
  | "Middle"
  | "Right"
  | "X1"
  | "X2"
  | "X3"
  | "X4"
  | "X5";

export enum MouseButtonCode {
  Left = 0,
  Middle = 1,
  Right = 2,
  X1 = 3,
  X2 = 4,
  X3 = 5,
  X4 = 6,
  X5 = 7,
}

export enum KeyCode {
  None = 0,
  Backquote,
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
}

export type Key =
  | "Backquote"
  | "Backslash"
  | "BracketLeft"
  | "BracketRight"
  | "Comma"
  | "Digit0"
  | "Digit1"
  | "Digit2"
  | "Digit3"
  | "Digit4"
  | "Digit5"
  | "Digit6"
  | "Digit7"
  | "Digit8"
  | "Digit9"
  | "Equal"
  | "IntlBackslash"
  | "IntlRo"
  | "IntlYen"
  | "KeyA"
  | "KeyB"
  | "KeyC"
  | "KeyD"
  | "KeyE"
  | "KeyF"
  | "KeyG"
  | "KeyH"
  | "KeyI"
  | "KeyJ"
  | "KeyK"
  | "KeyL"
  | "KeyM"
  | "KeyN"
  | "KeyO"
  | "KeyP"
  | "KeyQ"
  | "KeyR"
  | "KeyS"
  | "KeyT"
  | "KeyU"
  | "KeyV"
  | "KeyW"
  | "KeyX"
  | "KeyY"
  | "KeyZ"
  | "Minus"
  | "Period"
  | "Quote"
  | "Semicolon"
  | "Slash"
  | "AltLeft"
  | "AltRight"
  | "Backspace"
  | "CapsLock"
  | "ContextMenu"
  | "ControlLeft"
  | "ControlRight"
  | "Enter"
  | "MetaLeft"
  | "MetaRight"
  | "ShiftLeft"
  | "ShiftRight"
  | "Space"
  | "Tab"
  | "Convert"
  | "KanaMode"
  | "Lang1"
  | "Lang2"
  | "Lang3"
  | "Lang4"
  | "Lang5"
  | "NonConvert"
  | "Delete"
  | "End"
  | "Help"
  | "Home"
  | "Insert"
  | "PageDown"
  | "PageUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "NumLock"
  | "Numpad0"
  | "Numpad1"
  | "Numpad2"
  | "Numpad3"
  | "Numpad4"
  | "Numpad5"
  | "Numpad6"
  | "Numpad7"
  | "Numpad8"
  | "Numpad9"
  | "NumpadAdd"
  | "NumpadBackspace"
  | "NumpadClear"
  | "NumpadClearEntry"
  | "NumpadComma"
  | "NumpadDecimal"
  | "NumpadDivide"
  | "NumpadEnter"
  | "NumpadEqual"
  | "NumpadHash"
  | "NumpadMemoryAdd"
  | "NumpadMemoryClear"
  | "NumpadMemoryRecall"
  | "NumpadMemoryStore"
  | "NumpadMemorySubtract"
  | "NumpadMultiply"
  | "NumpadParenLeft"
  | "NumpadParenRight"
  | "NumpadStar"
  | "NumpadSubtract"
  | "Escape"
  | "Fn"
  | "FnLock"
  | "PrintScreen"
  | "ScrollLock"
  | "Pause"
  | "BrowserBack"
  | "BrowserFavorites"
  | "BrowserForward"
  | "BrowserHome"
  | "BrowserRefresh"
  | "BrowserSearch"
  | "BrowserStop"
  | "Eject"
  | "LaunchApp1"
  | "LaunchApp2"
  | "LaunchMail"
  | "MediaPlayPause"
  | "MediaSelect"
  | "MediaStop"
  | "MediaTrackNext"
  | "MediaTrackPrevious"
  | "Power"
  | "Sleep"
  | "AudioVolumeDown"
  | "AudioVolumeMute"
  | "AudioVolumeUp"
  | "WakeUp"
  | "Hyper"
  | "Super"
  | "Turbo"
  | "Abort"
  | "Resume"
  | "Suspend"
  | "Again"
  | "Copy"
  | "Cut"
  | "Find"
  | "Open"
  | "Paste"
  | "Props"
  | "Select"
  | "Undo"
  | "Hiragana"
  | "Katakana"
  | "F1"
  | "F2"
  | "F3"
  | "F4"
  | "F5"
  | "F6"
  | "F7"
  | "F8"
  | "F9"
  | "F10"
  | "F11"
  | "F12"
  | "F13"
  | "F14"
  | "F15"
  | "F16"
  | "F17"
  | "F18"
  | "F19"
  | "F20"
  | "F21"
  | "F22"
  | "F23"
  | "F24"
  | "F25"
  | "F26"
  | "F27"
  | "F28"
  | "F29"
  | "F30"
  | "F31"
  | "F32"
  | "F33"
  | "F34"
  | "F35";

export function keyToKeyCode(key: Key): KeyCode {
  return KeyCode[key];
}

export function keyCodeToKey(code: KeyCode | number): Key {
  return KeyCode[code] as Key;
}

export function mouseButtonToMouseButtonCode(
  button: MouseButton,
): MouseButtonCode {
  return MouseButtonCode[button];
}

export function mouseButtonCodeToMouseButton(
  code: MouseButtonCode | number,
): MouseButton {
  return MouseButtonCode[code] as MouseButton;
}

export type KeyState = {
  down: boolean;
  held: boolean;
  up: boolean;
};
