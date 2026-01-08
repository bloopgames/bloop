import {
  SCREEN_CTX_WIDTH_OFFSET,
  SCREEN_CTX_HEIGHT_OFFSET,
  SCREEN_CTX_PHYSICAL_WIDTH_OFFSET,
  SCREEN_CTX_PHYSICAL_HEIGHT_OFFSET,
  SCREEN_CTX_PIXEL_RATIO_OFFSET,
} from "../codegen/offsets";

export class ScreenContext {
  dataView?: DataView;

  constructor(dataView?: DataView) {
    this.dataView = dataView;
  }

  /** Logical width in CSS pixels */
  get width(): number {
    if (!this.dataView) {
      throw new Error("ScreenContext DataView is not initialized");
    }
    return this.dataView.getUint32(SCREEN_CTX_WIDTH_OFFSET, true);
  }

  /** Logical height in CSS pixels */
  get height(): number {
    if (!this.dataView) {
      throw new Error("ScreenContext DataView is not initialized");
    }
    return this.dataView.getUint32(SCREEN_CTX_HEIGHT_OFFSET, true);
  }

  /** Physical width in device pixels */
  get physicalWidth(): number {
    if (!this.dataView) {
      throw new Error("ScreenContext DataView is not initialized");
    }
    return this.dataView.getUint32(SCREEN_CTX_PHYSICAL_WIDTH_OFFSET, true);
  }

  /** Physical height in device pixels */
  get physicalHeight(): number {
    if (!this.dataView) {
      throw new Error("ScreenContext DataView is not initialized");
    }
    return this.dataView.getUint32(SCREEN_CTX_PHYSICAL_HEIGHT_OFFSET, true);
  }

  /** Device pixel ratio (physical pixels / logical pixels) */
  get pixelRatio(): number {
    if (!this.dataView) {
      throw new Error("ScreenContext DataView is not initialized");
    }
    return this.dataView.getFloat32(SCREEN_CTX_PIXEL_RATIO_OFFSET, true);
  }
}
