import type { EnginePointer } from "./engine";
import type * as Enums from "./codegen/enums";

export type WasmEngine = {
  initialize: () => void;
  alloc: (size: number) => EnginePointer;
  free: (ptr: EnginePointer, size: number) => void;
  register_systems: (cb_handle: number) => void;

  get_time_ctx: () => EnginePointer;

  step: (ms: number) => void;

  // Input platform events
  emit_keydown: (key: Enums.Key) => void;
  emit_keyup: (key: Enums.Key) => void;
  emit_mousedown: (button: Enums.MouseButton) => void;
  emit_mouseup: (button: Enums.MouseButton) => void;
  emit_mousemove: (x: number, y: number) => void;
  emit_mousewheel: (x: number, y: number) => void;

  /** Returns a pointer to the snapshot data. */
  snapshot: (size: number) => EnginePointer;
  /** Restores the engine state from a snapshot */
  restore: (ptr: EnginePointer) => void;
  snapshot_user_data_offset: () => number;
};
