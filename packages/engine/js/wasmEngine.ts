import type * as Enums from "./codegen/enums";
import type { EngineOk, EnginePointer } from "./engine";

export type WasmEngine = {
  /** Initialize the engine and return a pointer to the callback context */
  initialize: () => EnginePointer;
  alloc: (size: number) => EnginePointer;
  free: (ptr: EnginePointer, size: number) => void;
  register_systems: (cb_handle: number) => void;

  get_time_ctx: () => EnginePointer;
  get_events_ptr: () => EnginePointer;

  /**
   * Step forward one simulation frame
   */
  step: (ms: number) => number;
  /**
   * Run a single simulation frame. step wraps this in an accumulator
   */
  tick: () => void;
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

  // Input platform events (all take source as second/last parameter)
  emit_keydown: (key: Enums.Key, source: Enums.InputSource) => void;
  emit_keyup: (key: Enums.Key, source: Enums.InputSource) => void;
  emit_mousedown: (button: Enums.MouseButton, source: Enums.InputSource) => void;
  emit_mouseup: (button: Enums.MouseButton, source: Enums.InputSource) => void;
  emit_mousemove: (x: number, y: number, source: Enums.InputSource) => void;
  emit_mousewheel: (x: number, y: number, source: Enums.InputSource) => void;

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

  // Session / Rollback
  /**
   * Initialize a multiplayer session with rollback support
   * @param peer_count Number of peers in the session
   * @param user_data_len Size of user data to include in snapshots
   */
  session_init: (peer_count: number, user_data_len: number) => EngineOk;
  /**
   * End the current session
   */
  session_end: () => void;
  /**
   * Emit inputs for a peer at a given match frame
   * @param peer Peer ID (0-indexed)
   * @param match_frame Frame number relative to session start
   * @param events_ptr Pointer to Event array in WASM memory
   * @param events_len Number of events
   */
  session_emit_inputs: (
    peer: number,
    match_frame: number,
    events_ptr: EnginePointer,
    events_len: number,
  ) => void;
  /**
   * Get current match frame (frames since session start)
   */
  get_match_frame: () => number;
  /**
   * Get confirmed frame (latest frame where all peers have sent inputs)
   */
  get_confirmed_frame: () => number;
  /**
   * Get the latest confirmed frame for a specific peer
   */
  get_peer_frame: (peer: number) => number;
  /**
   * Get rollback depth (match_frame - confirmed_frame)
   */
  get_rollback_depth: () => number;
};
