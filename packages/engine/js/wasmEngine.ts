import type * as Enums from "./codegen/enums";
import type { EngineOk, EnginePointer } from "./engine";

export type WasmEngine = {
  /** Initialize the engine and return a pointer to the callback context */
  initialize: () => EnginePointer;
  alloc: (size: number) => EnginePointer;
  free: (ptr: EnginePointer, size: number) => void;
  register_systems: (cb_handle: number) => void;

  get_time_ctx: () => EnginePointer;

  /**
   * Step forward one simulation frame
   */
  step: (ms: number) => void;
  /**
   * Seek to a specific frame number (inclusive).
   * Seeking to frame 1 will run events for frame 0 and frame 1.
   */
  seek: (frame: number) => void;
  /**
   * Start recording inputs to tape
   */
  start_recording: (data_len: number, max_events: number) => EngineOk;
  /**
   * Stop recording inputs
   */
  stop_recording: () => EngineOk;
  /**
   * Whether the engine is currently recording to tape
   */
  is_recording: () => boolean;
  /**
   * Whether the engine is currently replaying from tape
   */
  is_replaying: () => boolean;

  // Input platform events
  emit_keydown: (key: Enums.Key) => void;
  emit_keyup: (key: Enums.Key) => void;
  emit_mousedown: (button: Enums.MouseButton) => void;
  emit_mouseup: (button: Enums.MouseButton) => void;
  emit_mousemove: (x: number, y: number) => void;
  emit_mousewheel: (x: number, y: number) => void;

  /**
   * Returns a pointer to the snapshot data.
   */
  take_snapshot: (data_len: number) => EnginePointer;
  /**
   * Restores the engine state from a snapshot
   */
  restore: (ptr: EnginePointer) => void;

  /**
   * Returns a pointer to the current tape data
   */
  get_tape_ptr: () => EnginePointer;
  /**
   * Returns the length of the current tape data
   */
  get_tape_len: () => number;
  /**
   * Loads a tape from the given pointer and length
   */
  load_tape: (ptr: EnginePointer, len: number) => EngineOk;

  /**
   * Deinitialize the engine
   * Free all memory associated with it
   */
  deinit: () => void;
};
