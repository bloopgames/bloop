import type {
  KeyEvent,
  MouseButtonEvent,
  MousePositionEvent,
  MouseWheelEvent,
} from "@bloopjs/engine";
import type { Context } from "./context";
import type { GameSchema } from "./schema";

export type System<GS extends GameSchema = GameSchema> = {
  update?: () => void;

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

  keyheld?: (
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
      event: MousePositionEvent;
    },
  ) => void;

  mousewheel?: (
    context: Context<GS> & {
      event: MouseWheelEvent;
    },
  ) => void;
};
