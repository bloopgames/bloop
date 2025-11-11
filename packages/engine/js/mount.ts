import type { EnginePointer } from "./engine";
import { Runtime } from "./runtime";
import type { WasmEngine } from "./wasmEngine";

export const DEFAULT_WASM_URL = new URL("../wasm/bloop.wasm", import.meta.url);

export type MountOpts = {
  wasmUrl?: URL;
  /**
   * A callback function for each system
   *
   * @param ptr - A pointer to the engine context
   *
   * ptr[0] - pointer to time context
   * ptr[1] - pointer to input snapshot
   * ptr[2] - pointer to events buffer
   */
  systemsCallback: (system_handle: number, ptr: EnginePointer) => void;

  /**
   * Sets buffer to the latest engine memory buffer
   *
   * Note that if the engine wasm memory grows, all dataviews into the memory must be updated
   */
  setBuffer: (buffer: ArrayBuffer) => void;

  /**
   * Optional hook to serialize some data when snapshotting
   *
   * @param alloc - allocator function to allocate shared memory in the engine
   * note that you must use the provided allocator to allocate memory that the engine can read
   *
   * @example
   *
   * serialize(alloc) {
   *   const size = 4;
   *   const ptr = alloc(size);
   *   const data = new Uint8Array(memory.buffer, ptr, size);
   *   data[0] = 0xDE;
   *   data[1] = 0xAD;
   *   data[2] = 0xBE;
   *   data[3] = 0xEF;
   *   return { ptr, length: size };
   * }
   */
  serialize?: (alloc: (size: number) => EnginePointer) => {
    ptr: EnginePointer;
    length: number;
  };
  /**
   * Optional hook to deserialize some data when restoring
   *
   * @param ptr - pointer to the data you serialized in engine memory
   * @param length - length of the data you serialized in bytes
   */
  deserialize?: (ptr: EnginePointer, length: number) => void;

  /** Options for tape recording, not yet implemented */
  tape?: {
    /** Whether to start recording on frame 0 */
    enabled?: boolean;
    /**
     * How often to take snapshots.
     * More snapshots = faster rewind, less snapshots = less memory usage
     */
    snapshotInterval?: number;
    /**
     * The size of the event buffer in bytes
     */
    eventBufferSize?: number;
  };
};

export type MountResult = {
  runtime: Runtime;
  wasm: WasmEngine;
};

export async function mount(opts: MountOpts): Promise<MountResult> {
  if (
    (opts.serialize && !opts.deserialize) ||
    (!opts.serialize && opts.deserialize)
  ) {
    throw new Error("Snapshot and restore hooks must be provided together");
  }

  // https://github.com/oven-sh/bun/issues/12434
  const bytes = await Bun.file(opts.wasmUrl ?? DEFAULT_WASM_URL).arrayBuffer();

  // 1mb to 64mb
  // use bun check:wasm to find initial memory page size
  const memory = new WebAssembly.Memory({ initial: 17, maximum: 1000 });
  const wasmInstantiatedSource = await WebAssembly.instantiate(bytes, {
    env: {
      __cb: function (system_handle: number, ptr: number) {
        opts.setBuffer(memory.buffer);
        opts.systemsCallback(system_handle, ptr);
      },
      console_log: function (ptr: number, len: number) {
        const bytes = new Uint8Array(memory.buffer, ptr, len);
        const string = new TextDecoder("utf-8").decode(bytes);
        console.log(string);
      },
      memory,
    },
  });
  const wasm = wasmInstantiatedSource.instance.exports as WasmEngine;

  wasm.initialize();

  return {
    runtime: new Runtime(wasm, memory, {
      serialize: opts.serialize,
      deserialize: opts.deserialize,
    }),
    wasm,
  };
}
