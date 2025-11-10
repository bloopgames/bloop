import * as Enums from "./codegen/enums";

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
