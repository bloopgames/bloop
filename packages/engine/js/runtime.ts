import type { WasmEngine } from "./engine";

/**
 * The runtime is a portable runtime that is responsible for:
 *
 * * Moving the engine forward and backward in time
 * * Maintaining a js-friendly view of engine memory
 */
export class Runtime {
  wasm: WasmEngine;
  #memory: WebAssembly.Memory;
  #vcrState = {
    isRecording: false,
    isPlayingBack: false,
  };

  constructor(wasm: WasmEngine, memory: WebAssembly.Memory) {
    this.wasm = wasm;
    this.#memory = memory;
  }

  step(ms: number) {
    this.wasm.step(ms);
  }

  // pause() {

  // }

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
