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

const MAX_PEERS = 12;
const PEERS_ARRAY_OFFSET = 32; // After _pad at offset 29-31
const PEER_CTX_SIZE = 8; // connected(1) + packet_count(1) + seq(2) + ack(2) + ack_count(1) + pad(1)

// Rollback stats offsets (after peers array at 32 + 12*8 = 128)
const LAST_ROLLBACK_DEPTH_OFFSET = 128;
const TOTAL_ROLLBACKS_OFFSET = 132;
const FRAMES_RESIMULATED_OFFSET = 136;

// Offsets within PeerCtx struct
const PEER_CONNECTED_OFFSET = 0;
const PEER_PACKET_COUNT_OFFSET = 1;
const PEER_SEQ_OFFSET = 2;
const PEER_ACK_OFFSET = 4;
const PEER_ACK_COUNT_OFFSET = 6;

const STATUS_MAP: Record<number, NetStatus> = {
  0: "offline",
  1: "local",
  2: "join:pending",
  3: "connected",
  4: "disconnected",
};

/**
 * NetCtx struct layout (from context.zig):
 * - peer_count: u8 (offset 0)
 * - local_peer_id: u8 (offset 1)
 * - in_session: u8 (offset 2)
 * - status: u8 (offset 3)
 * - match_frame: u32 (offset 4)
 * - session_start_frame: u32 (offset 8)
 * - room_code: [8]u8 (offset 12)
 *
 * All getters read directly from the engine's memory via DataView.
 * State is managed by the Zig engine, not TypeScript.
 */
export class NetContext {
  dataView?: DataView;

  // Pre-allocated peer objects to avoid GC pressure
  #peers: PeerInfo[] = Array.from({ length: MAX_PEERS }, () => ({
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
    return this.dataView!.getUint8(0);
  }

  /** Local peer ID in the session */
  get localPeerId(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint8(1);
  }

  /** Whether we're in an active multiplayer session */
  get isInSession(): boolean {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint8(2) !== 0;
  }

  /** Current network status */
  get status(): NetStatus {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    const statusByte = this.dataView!.getUint8(3);
    return STATUS_MAP[statusByte] ?? "local";
  }

  /** Current match frame (frames since session start, 0 if no session) */
  get matchFrame(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint32(4, true);
  }

  /**
   * The number of frames since the game booted that the session started.
   * Match frame is calculated relative to this.
   */
  get sessionStartFrame(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint32(8, true);
  }

  /** Current room code (empty string if not in a room) */
  get roomCode(): string {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    // Read 8 bytes starting at offset 12, convert to string until null terminator
    const bytes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const byte = this.dataView!.getUint8(12 + i);
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
    // Read 8 bytes starting at offset 20, convert to string until null terminator
    const bytes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const byte = this.dataView!.getUint8(20 + i);
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
      this.dataView!.setUint8(20 + i, 0);
    }
    if (code) {
      // Write up to 7 chars (leave room for null terminator)
      for (let i = 0; i < Math.min(code.length, 7); i++) {
        this.dataView!.setUint8(20 + i, code.charCodeAt(i));
      }
    }
  }

  /** Game code sets this to request disconnection */
  get wantsDisconnect(): boolean {
    if (!this.#hasValidBuffer()) {
      return false;
    }
    return this.dataView!.getUint8(28) !== 0;
  }

  set wantsDisconnect(value: boolean) {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    this.dataView!.setUint8(28, value ? 1 : 0);
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

    // Calculate local peer ack = min(seq) across connected remotes with packets
    let minRemoteSeq = -1;
    for (let i = 0; i < MAX_PEERS; i++) {
      if (i === localPeerId) continue;
      const peerOffset = PEERS_ARRAY_OFFSET + i * PEER_CTX_SIZE;
      if (dv.getUint8(peerOffset + PEER_CONNECTED_OFFSET) !== 1) continue;
      if (dv.getUint8(peerOffset + PEER_PACKET_COUNT_OFFSET) === 0) continue;
      const seq = dv.getUint16(peerOffset + PEER_SEQ_OFFSET, true);
      if (minRemoteSeq === -1 || seq < minRemoteSeq) {
        minRemoteSeq = seq;
      }
    }

    // Update pre-allocated peer objects and build result array
    this.#peersResult.length = 0;
    for (let i = 0; i < MAX_PEERS; i++) {
      const peerOffset = PEERS_ARRAY_OFFSET + i * PEER_CTX_SIZE;
      if (dv.getUint8(peerOffset + PEER_CONNECTED_OFFSET) !== 1) continue;

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
        const packetCount = dv.getUint8(peerOffset + PEER_PACKET_COUNT_OFFSET);
        const ackCount = dv.getUint8(peerOffset + PEER_ACK_COUNT_OFFSET);
        peer.seq = packetCount === 0 ? -1 : dv.getUint16(peerOffset + PEER_SEQ_OFFSET, true);
        peer.ack = ackCount === 0 ? -1 : dv.getUint16(peerOffset + PEER_ACK_OFFSET, true);
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
    return this.dataView!.getUint32(LAST_ROLLBACK_DEPTH_OFFSET, true);
  }

  /** Total number of rollbacks during this session */
  get totalRollbacks(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    return this.dataView!.getUint32(TOTAL_ROLLBACKS_OFFSET, true);
  }

  /** Total frames resimulated during this session */
  get framesResimulated(): number {
    if (!this.#hasValidBuffer()) {
      throw new Error("NetContext dataView is not valid");
    }
    // Read u64 as BigInt then convert to number (safe for reasonable frame counts)
    return Number(this.dataView!.getBigUint64(FRAMES_RESIMULATED_OFFSET, true));
  }
}
