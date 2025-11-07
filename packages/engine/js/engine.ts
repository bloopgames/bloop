import type { PlatformEvent } from "./events";
import type { Key, MouseButton } from "./inputs";
import { Runtime } from "./runtime";
export type * from "./inputs";
export type * from "./events";

export * as EngineEvents from "./events";
export * as EngineInputs from "./inputs";
export * as EngineTiming from "./timing";

export const DEFAULT_WASM_URL = new URL("../wasm/bloop.wasm", import.meta.url);

type EnginePointer = number;

export type WasmEngine = {
  register_systems: (cb_handle: number) => void;
  step: (ms: number) => void;
  alloc: (size: number) => EnginePointer;
  write_byte: (ptr: EnginePointer) => void;
  initialize: () => void;
  time_ctx: () => EnginePointer;
};

export type MountOpts = {
  wasmUrl?: URL;
  /** A callback function for each system */
  // todo - get dt from ptr
  systemsCallback: (ptr: number, events: PlatformEvent[], dt: number) => void;

  // todo - this should be an engine function
  snapshot: () => Uint8Array;
  restore: (snapshot: Uint8Array) => void;
  /** The size of the tape ring buffer. Defaults to 2mb */
  tapeBufferSize?: number;
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
  const bytes = await Bun.file(opts.wasmUrl ?? DEFAULT_WASM_URL).arrayBuffer();

  let frameCounter = 0;
  let snapshot: Uint8Array;
  // todo - get platform events, inputs and dt from byte buffer
  let platformEvents: PlatformEvent[] = [];
  const hackEventsByFrame = new Map<number, PlatformEvent[]>();
  // 1mb to 64mb
  // use bun check:wasm to see initial memory page size
  const memory = new WebAssembly.Memory({ initial: 17, maximum: 1000 });
  const wasmInstantiatedSource = await WebAssembly.instantiate(bytes, {
    env: {
      __cb: function (cb_handle: number, ptr: number, dt: number) {
        opts.systemsCallback(ptr, platformEvents, dt);
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

  // return {
  //   runtime: {
  //     step(ms?: number) {
  //       if (this.isPlayingBack) {
  //         if (!hackEventsByFrame.has(frameCounter)) {
  //           this.isPlayingBack = false;
  //         } else {
  //           platformEvents = [...hackEventsByFrame.get(frameCounter)!];
  //         }
  //       }
  //       wasm.step(ms || Math.floor(1000 / 60));
  //       hackEventsByFrame.set(frameCounter, [...platformEvents]);
  //       platformEvents.splice(0, platformEvents.length);
  //       frameCounter++;
  //     },
  //     seek(frame: number) {
  //       if (frame !== 0) {
  //         throw new Error(`seeking to frame ${frame} not implemented`);
  //       }
  //       opts.restore(snapshot);
  //       frameCounter = frame;
  //     },
  //     stepBack() {
  //       const targetFrame = frameCounter - 1;
  //       this.seek(0);
  //       this.isPlayingBack = true;

  //       while (frameCounter < targetFrame) {
  //         this.step();
  //       }
  //     },
  //     isRecording: true,
  //     isPlayingBack: false,
  //     record() {
  //       snapshot = opts.snapshot();
  //       // take a snapshot
  //       this.isRecording = true;
  //       this.isPlayingBack = false;
  //     },
  //   },
  //   wasm,
  //   emitter: {
  //     keydown(key: Key) {
  //       platformEvents.push({ type: "keydown", key });
  //     },
  //     keyup(key: Key) {
  //       platformEvents.push({ type: "keyup", key });
  //     },
  //     mousemove(x: number, y: number) {
  //       platformEvents.push({ type: "mousemove", x, y });
  //     },
  //     mousedown(button: MouseButton) {
  //       platformEvents.push({ type: "mousedown", button, pressure: 1 });
  //     },
  //     mouseup(button: MouseButton) {
  //       platformEvents.push({ type: "mouseup", button, pressure: 0 });
  //     },
  //     mousewheel(x: number, y: number) {
  //       platformEvents.push({ type: "mousewheel", x, y });
  //     },
  //   },
  // };
}
