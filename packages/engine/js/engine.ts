import { Runtime } from "./runtime";
import type { WasmEngine } from "./wasmEngine";
export type * from "./events";
export type * from "./inputs";

export * as EngineEvents from "./events";
export * as EngineInputs from "./inputs";
export * as EngineTiming from "./timing";

export const DEFAULT_WASM_URL = new URL("../wasm/bloop.wasm", import.meta.url);

export type EnginePointer = number;
export type EngineBuffer = number;
export type EngineLen = number;

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

  snapshot?: () => Uint8Array;
  restore?: (snapshot: Uint8Array) => void;

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
  // https://github.com/oven-sh/bun/issues/12434
  const bytes = await Bun.file(opts.wasmUrl ?? DEFAULT_WASM_URL).arrayBuffer();

  // 1mb to 64mb
  // use bun check:wasm to find initial memory page size
  const memory = new WebAssembly.Memory({ initial: 17, maximum: 1000 });
  const wasmInstantiatedSource = await WebAssembly.instantiate(bytes, {
    env: {
      __cb: function (system_handle: number, ptr: number) {
        opts.systemsCallback(system_handle, ptr);
      },
      console_log: function (ptr: number, len: number) {},
      memory,
    },
  });
  const wasm = wasmInstantiatedSource.instance.exports as WasmEngine;

  wasm.initialize();

  const ptr = wasm.alloc(1);
  wasm.write_byte(ptr);

  return {
    runtime: new Runtime(wasm, memory),
    wasm,
  };
}
