import {
  DEFAULT_WASM_URL,
  type EnginePointer,
  type WasmEngine,
} from "@bloopjs/engine";
import { type EngineHooks, Runtime } from "./runtime";
import { assert } from "./util";

export async function mount(opts: MountOpts): Promise<MountResult> {
  // https://github.com/oven-sh/bun/issues/12434
  const bytes = await fetch(opts.wasmUrl ?? DEFAULT_WASM_URL)
    .then((res) => res.arrayBuffer())
    .catch((e) => {
      console.error(
        `Failed to fetch wasm at ${opts.wasmUrl ?? DEFAULT_WASM_URL}`,
        e,
      );
      throw e;
    });

  // 1mb to 64mb
  // use bun check:wasm to find initial memory page size
  const memory = new WebAssembly.Memory({ initial: 17, maximum: 1000 });
  const wasmInstantiatedSource = await WebAssembly.instantiate(bytes, {
    env: {
      memory,
      __cb: function (system_handle: number, ptr: number) {
        opts.hooks.setBuffer(memory.buffer);
        opts.hooks.systemsCallback(system_handle, ptr);
      },
      console_log: function (ptr: EnginePointer, len: number) {
        const bytes = new Uint8Array(memory.buffer, ptr, len);
        const string = new TextDecoder("utf-8").decode(bytes);
        console.log(string);
      },
      user_data_len: function () {
        const serializer = opts.hooks.serialize();
        return serializer ? serializer.size : 0;
      },
      user_data_serialize: function (ptr: EnginePointer, len: number) {
        const serializer = opts.hooks.serialize();
        assert(
          len === serializer.size,
          `user_data_serialize length mismatch, expected=${serializer.size} got=${len}`,
        );
        serializer.write(memory.buffer, ptr);
      },
      user_data_deserialize: function (ptr: EnginePointer, len: number) {
        opts.hooks.deserialize(memory.buffer, ptr, len);
      },
    },
  });
  const wasm = wasmInstantiatedSource.instance.exports as WasmEngine;

  const enginePointer = wasm.initialize();
  const runtime = new Runtime(wasm, memory, {
    serialize: opts.hooks.serialize,
  });

  if (opts.startRecording ?? true) {
    runtime.record();
  }

  opts.hooks.setBuffer(memory.buffer);
  opts.hooks.setContext(enginePointer);

  return {
    runtime,
    wasm,
  };
}

export type MountOpts = {
  hooks: EngineHooks;

  wasmUrl?: URL;

  /**
   * Whether to start recording immediately upon mount
   * Defaults to true
   */
  startRecording?: boolean;
};

export type MountResult = {
  runtime: Runtime;
  wasm: WasmEngine;
};
