import type { Key, MouseButton } from "@bloopjs/engine";

export type InputEvent =
  | KeyEvent
  | MouseButtonEvent
  | MouseMoveEvent
  | MouseWheelEvent;

export type KeyEvent = {
  key: Key;
};

export type MouseButtonEvent = {
  button: MouseButton;
};

export type MouseMoveEvent = {
  x: number;
  y: number;
};

export type MouseWheelEvent = {
  x: number;
  y: number;
};
