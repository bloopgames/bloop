import wasmUrl from "./bloop.wasm";
import type { PlatformEvent } from "./events";
import type { Key, MouseButton } from "./inputs";
export type * from "./inputs";
export type * from "./events";

export * as EngineInputs from "./inputs";

export type WasmEngine = {
  register_systems: (cb_handle: number) => void;
  step: (ms: number) => void;
};

export type SystemsCallback = (events: PlatformEvent[]) => void;

export type MountOpts = {
  systemsCallback: SystemsCallback;
};

export type Runtime = {
  step: (ms?: number) => void;
};

/**
 * Emits platform events to the engine
 */
export type Emitter = {
  keydown: (key: Key) => void;
  keyup: (key: Key) => void;
  mousemove(x: number, y: number): void;
  mousedown(button: MouseButton): void;
  mouseup(button: MouseButton): void;
  mousewheel(x: number, y: number): void;
};

export type MountResult = {
  runtime: Runtime;
  wasm: WasmEngine;
  emitter: Emitter;
};

export async function mount(opts: MountOpts): Promise<MountResult> {
  // https://github.com/oven-sh/bun/issues/12434
  const bytes = await Bun.file(wasmUrl).arrayBuffer();

  const platformEvents: PlatformEvent[] = [];
  const wasmInstantiatedSource = await WebAssembly.instantiate(bytes, {
    env: {
      __cb: function (a: number) {
        opts.systemsCallback(platformEvents);
        platformEvents.splice(0, platformEvents.length);
      },
      console_log: function (ptr: number, len: number) {},
    },
  });
  const wasm = wasmInstantiatedSource.instance.exports as WasmEngine;

  return {
    runtime: {
      step(ms?: number) {
        wasm.step(ms || Math.floor(1000 / 60));
      },
    },
    wasm,
    emitter: {
      keydown(key: Key) {
        platformEvents.push({ type: "keydown", key });
      },
      keyup(key: Key) {
        platformEvents.push({ type: "keyup", key });
      },
      mousemove(x: number, y: number) {
        platformEvents.push({ type: "mousemove", x, y });
      },
      mousedown(button: MouseButton) {
        platformEvents.push({ type: "mousedown", button, pressure: 1 });
      },
      mouseup(button: MouseButton) {
        platformEvents.push({ type: "mouseup", button, pressure: 0 });
      },
      mousewheel(x: number, y: number) {
        platformEvents.push({ type: "mousewheel", x, y });
      },
    },
  };
}
