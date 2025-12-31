/**
 * Network status values matching Zig NetStatus enum
 */
export type NetStatus =
  | "offline"
  | "local"
  | "join:pending"
  | "connected"
  | "disconnected";

export type NetWants = {
  roomCode?: string;
  disconnect?: boolean;
};

export type NetEvent =
  | { type: "join:ok"; data: { roomCode: string } }
  | { type: "join:fail"; data: { reason: string } }
  | { type: "peer:join"; data: { peerId: number } }
  | { type: "peer:leave"; data: { peerId: number } }
  | { type: "session:start"; data: Record<string, never> }
  | { type: "session:end"; data: Record<string, never> };

export type NetEventType = Extract<NetEvent, { type: string }>["type"];

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

  /** Game code writes to this, platform reads it */
  wants: NetWants = {};

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

  /** Session start frame (absolute frame number) */
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
}
