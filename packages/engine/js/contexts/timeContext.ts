export class TimeContext {
  dataView?: DataView;

  constructor(dataView?: DataView) {
    this.dataView = dataView;
  }

  /** The current frame number, eg after processing frame 0, this will be 1 */
  get frame(): number {
    if (!this.dataView) {
      throw new Error("TimeContext DataView is not initialized");
    }
    return this.dataView.getUint32(0, true);
  }

  /** The number of seconds since the last frame */
  get dt(): number {
    if (!this.dataView) {
      throw new Error("TimeContext DataView is not initialized");
    }
    return this.dataView.getUint32(4, true) / 1000;
  }

  /** The total number of seconds since the engine started */
  get time(): number {
    if (!this.dataView) {
      throw new Error("TimeContext DataView is not initialized");
    }
    return this.dataView.getUint32(8, true) / 1000;
  }
}
