// Tape header parsing (ABI matches packages/engine/src/tapes.zig TapeHeader struct)
const TAPE_MAGIC = 0x54415045; // "TAPE" in ASCII

export type TapeHeader = {
  magic: number;
  version: number;
  startFrame: number;
  frameCount: number;
  eventCount: number;
};

export function readTapeHeader(tape: Uint8Array): TapeHeader {
  const view = new DataView(tape.buffer, tape.byteOffset, tape.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== TAPE_MAGIC) {
    throw new Error(
      `Invalid tape format: expected magic ${TAPE_MAGIC.toString(16)}, got ${magic.toString(16)}`,
    );
  }
  return {
    magic,
    version: view.getUint16(4, true),
    startFrame: view.getUint32(8, true),
    frameCount: view.getUint16(12, true),
    eventCount: view.getUint16(14, true),
  };
}
