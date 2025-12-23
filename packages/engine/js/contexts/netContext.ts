import { createNetWants, type NetWants } from "../net-wants";

/**
 * Network status values matching Zig NetStatus enum
 */
export type NetStatus =
  | "offline"
  | "local"
  | "join:pending"
  | "connected"
  | "disconnected";

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
 */
export class NetContext {
  dataView?: DataView;

  /** Game code writes to this, platform reads it */
  wants: NetWants = createNetWants();

  // TypeScript-side state for net events (until proper engine integration)
  #roomCodeOverride?: string;
  #statusOverride?: NetStatus;
  #peerCountOverride?: number;
  #inSessionOverride?: boolean;

  constructor(dataView?: DataView) {
    this.dataView = dataView;
  }

  /** Number of peers in the current session (0 if not in a multiplayer session) */
  get peerCount(): number {
    if (this.#peerCountOverride !== undefined) {
      return this.#peerCountOverride;
    }
    if (!this.dataView) {
      throw new Error("NetContext DataView is not initialized");
    }
    return this.dataView.getUint8(0);
  }

  /** Local peer ID in the session */
  get localPeerId(): number {
    if (!this.dataView) {
      throw new Error("NetContext DataView is not initialized");
    }
    return this.dataView.getUint8(1);
  }

  get isInSession(): boolean {
    if (this.#inSessionOverride !== undefined) {
      return this.#inSessionOverride;
    }
    if (!this.dataView) {
      throw new Error("NetContext DataView is not initialized");
    }
    return this.dataView.getUint8(2) !== 0;
  }

  /** Current network status */
  get status(): NetStatus {
    if (this.#statusOverride !== undefined) {
      return this.#statusOverride;
    }
    if (!this.dataView) {
      return "local"; // Default before dataView is set
    }
    const statusByte = this.dataView.getUint8(3);
    return STATUS_MAP[statusByte] ?? "local";
  }

  /** Current match frame (frames since session start, 0 if no session) */
  get matchFrame(): number {
    if (!this.dataView) {
      throw new Error("NetContext DataView is not initialized");
    }
    return this.dataView.getUint32(4, true);
  }

  /** Session start frame (absolute frame number) */
  get sessionStartFrame(): number {
    if (!this.dataView) {
      throw new Error("NetContext DataView is not initialized");
    }
    return this.dataView.getUint32(8, true);
  }

  /** Current room code (empty string if not in a room) */
  get roomCode(): string {
    if (this.#roomCodeOverride !== undefined) {
      return this.#roomCodeOverride;
    }
    if (!this.dataView) {
      return "";
    }
    // Read 8 bytes starting at offset 12, convert to string until null terminator
    const bytes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const byte = this.dataView.getUint8(12 + i);
      if (byte === 0) break;
      bytes.push(byte);
    }
    return String.fromCharCode(...bytes);
  }

  // ─────────────────────────────────────────────────────────────
  // Internal setters for network event processing
  // ─────────────────────────────────────────────────────────────

  /** @internal Set room code */
  _setRoomCode(code: string): void {
    this.#roomCodeOverride = code;
  }

  /** @internal Set status */
  _setStatus(status: NetStatus): void {
    this.#statusOverride = status;
  }

  /** @internal Set peer count */
  _setPeerCount(count: number): void {
    this.#peerCountOverride = count;
  }

  /** @internal Set in_session flag */
  _setInSession(inSession: boolean): void {
    this.#inSessionOverride = inSession;
  }
}
