import type { PlatformEvent } from "./engine";
import {
  keyToKeyCode,
  mouseButtonToMouseButtonCode,
  type Key,
  type MouseButton,
} from "./inputs";
import { TimeContext } from "./contexts/timeContext";
import type { WasmEngine } from "./wasmEngine";

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
  #platformEvents: PlatformEvent[] = [];
  #vcr = {
    isRecording: false,
    isPlayingBack: false,
    snapshot: new Uint8Array(),
  };

  constructor(wasm: WasmEngine, memory: WebAssembly.Memory) {
    this.wasm = wasm;
    this.#memory = memory;
    this.#time = new TimeContext(
      new DataView(this.#memory.buffer, this.wasm.time_ctx()),
    );
  }

  step(ms?: number) {
    this.wasm.step(ms ?? 16);
  }

  stepBack() {
    throw new Error("Not implemented");
  }

  record() {
    this.#vcr.isRecording = true;
    this.#vcr.snapshot = this.snapshot();
  }

  snapshot(): Uint8Array<ArrayBuffer> {
    const ptr = this.wasm.snapshot();
    const length = new Uint32Array(this.#memory.buffer, ptr, 4)[0];
    return new Uint8Array(this.#memory.buffer, ptr + 4, length);
  }

  restore(snapshot: Uint8Array) {
    this.wasm.restore(snapshot.byteOffset, snapshot.byteLength);
  }

  get time(): TimeContext {
    if (
      !this.#time.dataView ||
      this.#time.dataView.buffer !== this.#memory.buffer
    ) {
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
    return this.#vcr.isRecording;
  }

  get isPlayingBack(): boolean {
    return this.#vcr.isPlayingBack;
  }

  emit = {
    keydown: (key: Key) => {
      this.wasm.emit_keydown(keyToKeyCode(key));
    },
    keyup: (key: Key) => {
      this.wasm.emit_keyup(keyToKeyCode(key));
    },
    mousemove: (x: number, y: number) => {
      this.wasm.emit_mousemove(x, y);
    },
    mousedown: (button: MouseButton) => {
      this.wasm.emit_mousedown(mouseButtonToMouseButtonCode(button));
    },
    mouseup: (button: MouseButton) => {
      this.wasm.emit_mouseup(mouseButtonToMouseButtonCode(button));
    },
    mousewheel: (x: number, y: number) => {
      this.wasm.emit_mousewheel(x, y);
    },
  };
}
