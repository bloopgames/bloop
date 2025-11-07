export type TimingSnapshot = {
  /** The number of seconds (usually fractional) since the last frame */
  dt: number;
  /** The total number of seconds since the engine started */
  time: number;
  /** The number of frames rendered since the engine started */
  frame: number;

  /** The current frame rate of the engine in frames per second */
  // fps: number;
  /** The number of frames rendered since the engine started */
  highResFrame: bigint;
  /** The total number of milliseconds since the engine started */
  highResTime: bigint;
};

export const TIMING_SNAPSHOT_SIZE = 32;

// these functions should go in engine
export function encodeTimingSnapshot(
  ts: TimingSnapshot,
  target: Uint8Array,
): number {
  if (target.byteLength !== TIMING_SNAPSHOT_SIZE) {
    throw new Error("Target buffer must be exactly 32 bytes");
  }
  const view = new DataView(
    target.buffer,
    target.byteOffset,
    target.byteLength,
  );
  view.setFloat32(0, ts.dt, true);
  view.setFloat32(4, ts.time, true);
  view.setBigUint64(8, ts.highResFrame, true);
  view.setBigUint64(16, ts.highResTime, true);
  view.setUint32(24, ts.frame, true);
  return TIMING_SNAPSHOT_SIZE;
}

export function decodeTimingSnapshot(
  source: Uint8Array,
  target: TimingSnapshot,
): number {
  if (source.byteLength !== TIMING_SNAPSHOT_SIZE) {
    throw new Error(
      `Source buffer must be exactly ${TIMING_SNAPSHOT_SIZE} bytes`,
    );
  }
  const view = new DataView(
    source.buffer,
    source.byteOffset,
    source.byteLength,
  );
  target.dt = view.getFloat32(0, true);
  target.time = view.getFloat32(4, true);
  target.highResFrame = view.getBigUint64(8, true);
  target.highResTime = view.getBigUint64(16, true);
  target.frame = view.getUint32(24, true);

  return TIMING_SNAPSHOT_SIZE;
}
