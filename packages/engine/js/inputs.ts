import * as Enums from "./codegen/enums";

// todo - move magic number to codegen
export const MOUSE_OFFSET = 256;
export const KEYBOARD_OFFSET = 0;

export type MouseButton = keyof typeof Enums.MouseButton;

export type Key = keyof typeof Enums.Key;

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
