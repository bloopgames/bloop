import type { Context } from "./context";
import type { BloopSchema } from "./data/schema";
import type {
  KeyEvent,
  MouseButtonEvent,
  MouseMoveEvent,
  MouseWheelEvent,
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
};
