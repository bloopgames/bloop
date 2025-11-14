import type * as Enums from "./codegen/enums";
import type { EngineOk, EnginePointer } from "./engine";

export type WasmEngine = {
  initialize: () => void;
  alloc: (size: number) => EnginePointer;
  free: (ptr: EnginePointer, size: number) => void;
  register_systems: (cb_handle: number) => void;

  get_time_ctx: () => EnginePointer;

  /**
   * Step forward one simulation frame
   */
  step: (ms: number) => void;
  /**
   * Seek to a specific frame number
   */
  seek: (frame: number) => void;

  // Input platform events
  emit_keydown: (key: Enums.Key) => void;
  emit_keyup: (key: Enums.Key) => void;
  emit_mousedown: (button: Enums.MouseButton) => void;
  emit_mouseup: (button: Enums.MouseButton) => void;
  emit_mousemove: (x: number, y: number) => void;
  emit_mousewheel: (x: number, y: number) => void;

  /**
   * Start recording inputs to tape
   */
  start_recording: (data_len: number, max_events: number) => EngineOk;
  /**
   * Returns a pointer to the snapshot data.
   */
  take_snapshot: (size: number) => EnginePointer;
  /** Restores the engine state from a snapshot */
  restore: (ptr: EnginePointer) => void;

  snapshot_user_data_offset: () => number;
};
