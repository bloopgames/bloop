export class NetContext {
  dataView?: DataView;

  constructor(dataView?: DataView) {
    this.dataView = dataView;
  }

  /** Number of peers in the current session (0 if not in a multiplayer session) */
  get peerCount(): number {
    if (!this.dataView) {
      throw new Error("NetContext DataView is not initialized");
    }
    return this.dataView.getUint8(0);
  }

  get isInSession(): boolean {
    return this.peerCount > 0;
  }

  /** Current match frame (frames since session start, 0 if no session) */
  get matchFrame(): number {
    if (!this.dataView) {
      throw new Error("NetContext DataView is not initialized");
    }
    return this.dataView.getUint32(4, true);
  }
}
