import {
  MAX_PLAYERS,
  NET_CTX_PEERS_OFFSET,
  NET_CTX_LAST_ROLLBACK_DEPTH_OFFSET,
  NET_CTX_TOTAL_ROLLBACKS_OFFSET,
  NET_CTX_FRAMES_RESIMULATED_OFFSET,
  NET_CTX_PEER_COUNT_OFFSET,
  NET_CTX_LOCAL_PEER_ID_OFFSET,
  NET_CTX_IN_SESSION_OFFSET,
  NET_CTX_STATUS_OFFSET,
  NET_CTX_MATCH_FRAME_OFFSET,
  NET_CTX_SESSION_START_FRAME_OFFSET,
  NET_CTX_ROOM_CODE_OFFSET,
  NET_CTX_WANTS_ROOM_CODE_OFFSET,
  NET_CTX_WANTS_DISCONNECT_OFFSET,
  PEER_CTX_SIZE,
  PEER_CTX_CONNECTED_OFFSET,
  PEER_CTX_SEQ_OFFSET,
  PEER_CTX_ACK_OFFSET,
} from "../codegen/offsets";

/**
 * Network status values matching Zig NetStatus enum
 */
export type NetStatus =
  | "offline"
  | "local"
  | "join:pending"
  | "connected"
  | "disconnected";

export type NetEvent =
  | { type: "join:ok"; data: { roomCode: string } }
  | { type: "join:fail"; data: { reason: string } }
  | { type: "peer:join"; data: { peerId: number } }
  | { type: "peer:leave"; data: { peerId: number } }
  | { type: "peer:assign_local_id"; data: { peerId: number } }
  | { type: "session:start"; data: Record<string, never> }
  | { type: "session:end"; data: Record<string, never> };

export type NetEventType = Extract<NetEvent, { type: string }>["type"];

/**
 * Peer synchronization state for netcode
 */
export type PeerInfo = {
  isLocal: boolean;
  seq: number; // -1 if no packets received
  ack: number; // -1 if no packets received
};

const STATUS_MAP: Record<number, NetStatus> = {
  0: "offline",
  1: "local",
  2: "join:pending",
  3: "connected",
  4: "disconnected",
};

/**
 * NetCtx struct layout is defined in context.zig.
 * Field offsets are generated in codegen/offsets.ts.
 *
 * All getters read directly from the engine's memory via DataView.
 * State is managed by the Zig engine, not TypeScript.
 */
export class NetContext {
  dataView?: DataView;

  // Pre-allocated peer objects to avoid GC pressure
  #peers: PeerInfo[] = Array.from({ length: MAX_PLAYERS }, () => ({
    isLocal: false,
    seq: -1,
    ack: -1,
  }));
  #peersResult: PeerInfo[] = []; // Reused return array

  constructor(dataView?: DataView) {
    this.dataView = dataView;
  }

  /** Check if dataView is valid (not undefined and not detached) */
  #hasValidBuffer(): boolean {
    if (!this.dataView) return false;
    // Check if buffer is detached (byteLength becomes 0)
    return this.dataView.buffer.byteLength > 0;
  }

  /** Number of peers in the current session (0 if not in a multiplayer session) */
  get peerCount(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint8(NET_CTX_PEER_COUNT_OFFSET);
  }

  /** Local peer ID in the session */
  get localPeerId(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint8(NET_CTX_LOCAL_PEER_ID_OFFSET);
  }

  /** Whether we're in an active multiplayer session */
  get isInSession(): boolean {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint8(NET_CTX_IN_SESSION_OFFSET) !== 0;
  }

  /** Current network status */
  get status(): NetStatus {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    const statusByte = this.dataView!.getUint8(NET_CTX_STATUS_OFFSET);
    return STATUS_MAP[statusByte] ?? "local";
  }

  /** Current match frame (frames since session start, 0 if no session) */
  get matchFrame(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint32(NET_CTX_MATCH_FRAME_OFFSET, true);
  }

  /**
   * The number of frames since the game booted that the session started.
   * Match frame is calculated relative to this.
   */
  get sessionStartFrame(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint32(NET_CTX_SESSION_START_FRAME_OFFSET, true);
  }

  /** Current room code (empty string if not in a room) */
  get roomCode(): string {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    // Read 8 bytes starting at room_code offset, convert to string until null terminator
    const bytes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const byte = this.dataView!.getUint8(NET_CTX_ROOM_CODE_OFFSET + i);
      if (byte === 0) break;
      bytes.push(byte);
    }
    return String.fromCharCode(...bytes);
  }

  /** Game code sets this to request joining a room */
  get wantsRoomCode(): string | undefined {
    if (!this.#hasValidBuffer()) {
      return undefined;
    }
    // Read 8 bytes starting at wants_room_code offset, convert to string until null terminator
    const bytes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const byte = this.dataView!.getUint8(NET_CTX_WANTS_ROOM_CODE_OFFSET + i);
      if (byte === 0) break;
      bytes.push(byte);
    }
    return bytes.length > 0 ? String.fromCharCode(...bytes) : undefined;
  }

  set wantsRoomCode(code: string | undefined) {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    // Clear first
    for (let i = 0; i < 8; i++) {
      this.dataView!.setUint8(NET_CTX_WANTS_ROOM_CODE_OFFSET + i, 0);
    }
    if (code) {
      // Write up to 7 chars (leave room for null terminator)
      for (let i = 0; i < Math.min(code.length, 7); i++) {
        this.dataView!.setUint8(NET_CTX_WANTS_ROOM_CODE_OFFSET + i, code.charCodeAt(i));
      }
    }
  }

  /** Game code sets this to request disconnection */
  get wantsDisconnect(): boolean {
    if (!this.#hasValidBuffer()) {
      return false;
    }
    return this.dataView!.getUint8(NET_CTX_WANTS_DISCONNECT_OFFSET) !== 0;
  }

  set wantsDisconnect(value: boolean) {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    this.dataView!.setUint8(NET_CTX_WANTS_DISCONNECT_OFFSET, value ? 1 : 0);
  }

  /**
   * Get all connected peers in the session.
   * Returns peer info with seq/ack values.
   *
   * For the local peer:
   * - seq = matchFrame (our current frame)
   * - ack = minimum seq across all connected remote peers (-1 if none)
   *
   * For remote peers:
   * - seq = their latest frame we've received (-1 if none)
   * - ack = the frame they've acknowledged from us (-1 if none)
   */
  get peers(): PeerInfo[] {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }

    const dv = this.dataView!;
    const localPeerId = this.localPeerId;
    const matchFrame = this.matchFrame;

    // Calculate local peer ack = min(seq) across connected remotes with data
    let minRemoteSeq = -1;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      if (i === localPeerId) continue;
      const peerOffset = NET_CTX_PEERS_OFFSET + i * PEER_CTX_SIZE;
      if (dv.getUint8(peerOffset + PEER_CTX_CONNECTED_OFFSET) !== 1) continue;
      // seq is now i16 with -1 meaning "no data yet"
      const seq = dv.getInt16(peerOffset + PEER_CTX_SEQ_OFFSET, true);
      if (seq < 0) continue; // No data from this peer yet
      if (minRemoteSeq === -1 || seq < minRemoteSeq) {
        minRemoteSeq = seq;
      }
    }

    // Update pre-allocated peer objects and build result array
    this.#peersResult.length = 0;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const peerOffset = NET_CTX_PEERS_OFFSET + i * PEER_CTX_SIZE;
      if (dv.getUint8(peerOffset + PEER_CTX_CONNECTED_OFFSET) !== 1) continue;

      const peer = this.#peers[i];
      if (!peer) {
        throw new Error(`Unexpected missing peer object at index ${i}`);
      }
      const isLocal = i === localPeerId;
      peer.isLocal = isLocal;

      if (isLocal) {
        peer.seq = matchFrame;
        peer.ack = minRemoteSeq;
      } else {
        // seq and ack are now i16 with -1 meaning "no data yet"
        peer.seq = dv.getInt16(peerOffset + PEER_CTX_SEQ_OFFSET, true);
        peer.ack = dv.getInt16(peerOffset + PEER_CTX_ACK_OFFSET, true);
      }
      this.#peersResult.push(peer);
    }
    return this.#peersResult;
  }

  /** Last rollback depth (how many frames were rolled back) */
  get lastRollbackDepth(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint32(NET_CTX_LAST_ROLLBACK_DEPTH_OFFSET, true);
  }

  /** Total number of rollbacks during this session */
  get totalRollbacks(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint32(NET_CTX_TOTAL_ROLLBACKS_OFFSET, true);
  }

  /** Total frames resimulated during this session */
  get framesResimulated(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    // Read u64 as BigInt then convert to number (safe for reasonable frame counts)
    return Number(this.dataView!.getBigUint64(NET_CTX_FRAMES_RESIMULATED_OFFSET, true));
  }
}
