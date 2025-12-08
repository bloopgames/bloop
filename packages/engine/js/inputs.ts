import * as Enums from "./codegen/enums";

// Constants for memory layout
// TODO: move magic numbers to codegen
export const MAX_PLAYERS = 12;

// Per-player offsets (relative to start of PlayerInputs)
export const KEYBOARD_OFFSET = 0;
export const KEYBOARD_SIZE = 256;
export const MOUSE_OFFSET = 256; // After keyboard
export const MOUSE_BUTTONS_OFFSET = 16; // Within MouseCtx, after x, y, wheel_x, wheel_y (4 floats = 16 bytes)

// PlayerInputs size = KeyCtx (256) + MouseCtx (24) = 280 bytes
export const PLAYER_INPUTS_SIZE = 280;

// InputCtx layout: players[12] = 12 * 280 = 3360 bytes
export const INPUT_CTX_SIZE = MAX_PLAYERS * PLAYER_INPUTS_SIZE;

export const EVENT_PAYLOAD_SIZE = 8;
export const EVENT_PAYLOAD_ALIGN = 4;

export type MouseButton = keyof typeof Enums.MouseButton;
export type Key = keyof typeof Enums.Key;
export type InputSource = keyof typeof Enums.InputSource;

export function keyToKeyCode(key: Key): Enums.Key {
  return Enums.Key[key];
}

export function keyCodeToKey(code: Enums.Key | number): Key {
  return Enums.Key[code] as Key;
}

export function mouseButtonToMouseButtonCode(
  button: MouseButton,
): Enums.MouseButton {
  return Enums.MouseButton[button];
}

export function mouseButtonCodeToMouseButton(
  code: Enums.MouseButton | number,
): MouseButton {
  return Enums.MouseButton[code] as MouseButton;
}

export function inputSourceToInputSourceCode(
  source: InputSource,
): Enums.InputSource {
  return Enums.InputSource[source];
}

export function inputSourceCodeToInputSource(
  code: Enums.InputSource | number,
): InputSource {
  return Enums.InputSource[code] as InputSource;
}

export type KeyState = {
  down: boolean;
  held: boolean;
  up: boolean;
};

export type MouseState = {
  left: KeyState;
  middle: KeyState;
  right: KeyState;
  wheel: { x: number; y: number };
  x: number;
  y: number;
};
