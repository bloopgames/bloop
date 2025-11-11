import type { EngineBuffer, EngineLen, EnginePointer } from "./engine";
import type * as Enums from "./codegen/enums";

export type WasmEngine = {
  initialize: () => void;
  alloc: (size: number) => EnginePointer;
  register_systems: (cb_handle: number) => void;

  time_ctx: () => EnginePointer;

  step: (ms: number) => void;

  // Input platform events
  emit_keydown: (key: Enums.Key) => void;
  emit_keyup: (key: Enums.Key) => void;
  emit_mousedown: (button: Enums.MouseButton) => void;
  emit_mouseup: (button: Enums.MouseButton) => void;
  emit_mousemove: (x: number, y: number) => void;
  emit_mousewheel: (x: number, y: number) => void;

  /** Returns a pointer to the snapshot data. */
  snapshot: () => EngineBuffer;
  /** Restores the engine state from a snapshot */
  restore: (ptr: EnginePointer, len: EngineLen) => void;
};
