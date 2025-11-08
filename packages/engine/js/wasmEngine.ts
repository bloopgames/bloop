import type { EngineBuffer, EngineLen, EnginePointer } from "./engine";
import type { KeyCode, MouseButtonCode } from "./inputs";

export type WasmEngine = {
  initialize: () => void;
  alloc: (size: number) => EnginePointer;
  register_systems: (cb_handle: number) => void;

  time_ctx: () => EnginePointer;

  step: (ms: number) => void;

  // Input platform events
  emit_keydown: (key: KeyCode) => void;
  emit_keyup: (key: KeyCode) => void;
  emit_mousedown: (button: MouseButtonCode) => void;
  emit_mouseup: (button: MouseButtonCode) => void;
  emit_mousemove: (x: number, y: number) => void;
  emit_mousewheel: (x: number, y: number) => void;

  /** Returns a pointer to the snapshot data. First 4 bytes are the length. */
  snapshot: () => EngineBuffer;
  /** Restores the engine state from a snapshot */
  restore: (ptr: EnginePointer, len: EngineLen) => void;
};
