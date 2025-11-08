import { assert } from "../assert";

export class TimeContext {
  dataView?: DataView;

  constructor(dataView?: DataView) {
    this.dataView = dataView;
  }

  /** The number of fixed timestep frames processed */
  get frame(): number {
    assert(this.dataView, "DataView is not initialized");
    return this.dataView.getUint32(0, true);
  }

  /** The number of seconds since the last frame */
  get dt(): number {
    assert(this.dataView, "DataView is not initialized");
    return this.dataView.getUint32(4, true) / 1000;
  }

  /** The total number of seconds since the engine started */
  get time(): number {
    assert(this.dataView, "DataView is not initialized");
    return this.dataView.getUint32(8, true) / 1000;
  }
}
