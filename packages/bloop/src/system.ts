import type { NetEvent } from "@bloopjs/engine";
import type { Context } from "./context";
import type { BloopSchema } from "./data/schema";
import type {
  KeyEvent,
  MouseButtonEvent,
  MouseMoveEvent,
  MouseWheelEvent,
  ResizeEvent,
} from "./events";

export type System<GS extends BloopSchema = BloopSchema> = {
  label?: string;

  update?: (context: Context<GS>) => void;

  keydown?: (
    context: Context<GS> & {
      event: KeyEvent;
    },
  ) => void;

  keyup?: (
    context: Context<GS> & {
      event: KeyEvent;
    },
  ) => void;

  mousedown?: (
    context: Context<GS> & {
      event: MouseButtonEvent;
    },
  ) => void;

  mouseup?: (
    context: Context<GS> & {
      event: MouseButtonEvent;
    },
  ) => void;

  mousemove?: (
    context: Context<GS> & {
      event: MouseMoveEvent;
    },
  ) => void;

  mousewheel?: (
    context: Context<GS> & {
      event: MouseWheelEvent;
    },
  ) => void;

  /** Handle network events (join:ok, peer:join, etc.) */
  netcode?: (
    context: Context<GS> & {
      event: NetEvent;
    },
  ) => void;

  /** Handle screen/viewport resize events */
  resize?: (
    context: Context<GS> & {
      event: ResizeEvent;
    },
  ) => void;
};
