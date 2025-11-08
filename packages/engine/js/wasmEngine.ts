import type { EngineBuffer, EngineLen, EnginePointer } from "./engine";

export type WasmEngine = {
  register_systems: (cb_handle: number) => void;
  step: (ms: number) => void;
  alloc: (size: number) => EnginePointer;
  write_byte: (ptr: EnginePointer) => void;
  initialize: () => void;
  time_ctx: () => EnginePointer;
  /** Returns a pointer to the snapshot data. First 4 bytes are the length. */
  snapshot: () => EngineBuffer;
  restore: (ptr: EnginePointer, len: EngineLen) => void;
};
