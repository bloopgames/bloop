import * as Enums from "./codegen/enums";

// Re-export layout constants from generated offsets
export {
  MAX_PLAYERS,
  KEY_CTX_SIZE,
  MOUSE_CTX_SIZE,
  PLAYER_INPUTS_SIZE,
  INPUT_CTX_SIZE,
  PLAYER_INPUTS_KEY_CTX_OFFSET,
  PLAYER_INPUTS_MOUSE_CTX_OFFSET,
  MOUSE_CTX_BUTTON_STATES_OFFSET,
} from "./codegen/offsets";

// Backwards compatibility aliases
export {
  PLAYER_INPUTS_KEY_CTX_OFFSET as KEYBOARD_OFFSET,
  KEY_CTX_SIZE as KEYBOARD_SIZE,
  PLAYER_INPUTS_MOUSE_CTX_OFFSET as MOUSE_OFFSET,
  MOUSE_CTX_BUTTON_STATES_OFFSET as MOUSE_BUTTONS_OFFSET,
} from "./codegen/offsets";

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
