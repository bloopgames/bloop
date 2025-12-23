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
  tick: (is_resimulating: boolean) => void;
  /**
   * Seek to a specific frame number (inclusive).
   * Seeking to frame 1 will run events for frame 0 and frame 1.
   */
  seek: (frame: number) => void;
  /**
   * Start recording inputs to tape
   */
  start_recording: (
    data_len: number,
    max_events: number,
    max_packet_bytes: number,
  ) => EngineOk;
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
  emit_mousedown: (
    button: Enums.MouseButton,
    source: Enums.InputSource,
  ) => void;
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
   * Get pointer to net context struct
   */
  get_net_ctx: () => EnginePointer;

  // Network / Packets
  /**
   * Set local peer ID for packet encoding
   */
  session_set_local_peer: (peer_id: number) => void;
  /**
   * Mark a peer as connected for packet management
   */
  session_peer_connect: (peer_id: number) => void;
  /**
   * Mark a peer as disconnected
   */
  session_peer_disconnect: (peer_id: number) => void;
  /**
   * Build an outbound packet for a target peer
   * Call get_outbound_packet() and get_outbound_packet_len() to retrieve the packet
   */
  build_outbound_packet: (target_peer: number) => void;
  /**
   * Get pointer to the outbound packet buffer
   */
  get_outbound_packet: () => EnginePointer;
  /**
   * Get length of the outbound packet
   */
  get_outbound_packet_len: () => number;
  /**
   * Process a received packet
   * @returns 0 on success, error code otherwise
   */
  receive_packet: (ptr: EnginePointer, len: number) => number;
  /**
   * Get seq for a peer (latest frame received from them)
   */
  get_peer_seq: (peer: number) => number;
  /**
   * Get ack for a peer (latest frame they acked from us)
   */
  get_peer_ack: (peer: number) => number;

  // Network events
  /**
   * Emit NetJoinOk event - successfully joined a room
   * @param room_code_ptr Pointer to room code string in WASM memory
   * @param len Length of the room code (max 8)
   */
  emit_net_join_ok: (room_code_ptr: EnginePointer, len: number) => void;
  /**
   * Emit NetJoinFail event - failed to join a room
   * @param reason Reason code (0=unknown, 1=timeout, 2=room_full, etc.)
   */
  emit_net_join_fail: (reason: number) => void;
  /**
   * Emit NetPeerJoin event - a peer joined the room
   * @param peer_id Numeric peer ID (0-11)
   */
  emit_net_peer_join: (peer_id: number) => void;
  /**
   * Emit NetPeerLeave event - a peer left the room
   * @param peer_id Numeric peer ID (0-11)
   */
  emit_net_peer_leave: (peer_id: number) => void;
};
