import type { WasmEngine } from "./engine";
import { TimeContext } from "./timing";

/**
 * The runtime is a portable runtime that is responsible for:
 *
 * * Moving the engine forward and backward in time
 * * Maintaining a js-friendly view of engine memory
 */
export class Runtime {
  wasm: WasmEngine;
  #memory: WebAssembly.Memory;
  #time: TimeContext;
  #vcrState = {
    isRecording: false,
    isPlayingBack: false,
  };

  constructor(wasm: WasmEngine, memory: WebAssembly.Memory) {
    this.wasm = wasm;
    this.#memory = memory;
    this.#time = new TimeContext(
      new DataView(this.#memory.buffer, this.wasm.time_ctx()),
    );
  }

  step(ms: number) {
    this.wasm.step(ms);
  }

  get time(): TimeContext {
    if (this.#time.dataView.buffer !== this.#memory.buffer) {
      // update the data view to the latest memory buffer
      this.#time.dataView = new DataView(
        this.#memory.buffer,
        this.wasm.time_ctx(),
      );
    }
    return this.#time;
  }

  get buffer() {
    return this.#memory.buffer;
  }

  get isRecording(): boolean {
    return this.#vcrState.isRecording;
  }

  get isPlayingBack(): boolean {
    return this.#vcrState.isPlayingBack;
  }

  // record: () => void;
  // isRecording?: boolean;
  // isPlayingBack?: boolean;
  // step: (ms?: number) => void;
  // seek: (frame: number) => void;
  // stepBack: () => void;
}

// export type Runtime = {
//   record: () => void;
//   isRecording?: boolean;
//   isPlayingBack?: boolean;
//   step: (ms?: number) => void;
//   seek: (frame: number) => void;
//   stepBack: () => void;
// };
