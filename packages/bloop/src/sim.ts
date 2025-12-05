import {
  type EnginePointer,
  type Key,
  keyToKeyCode,
  type MouseButton,
  mouseButtonToMouseButtonCode,
  SNAPSHOT_HEADER_ENGINE_LEN_OFFSET,
  SNAPSHOT_HEADER_USER_LEN_OFFSET,
  TimeContext,
  type WasmEngine,
} from "@bloopjs/engine";
import { assert } from "./util";

const originalConsole = (globalThis as any).console;

const noop = () => {};

const stubConsole = Object.fromEntries(
  Object.keys(originalConsole).map((key) => [key, noop])
) as unknown as Console;

function muteConsole() {
  (globalThis.console as unknown as Console) = stubConsole;
}

function unmuteConsole() {
  (globalThis.console as unknown as Console) = originalConsole;
}

export type EngineHooks = {
  /**
   * Hook to serialize some data when snapshotting
   */
  serialize: SerializeFn;
  /**
   * Hook to deserialize some data when restoring
   */
  deserialize: DeserializeFn;
  /**
   * A callback function to run logic for a given frame
   */
  systemsCallback: SystemsCallback;
  /**
   * Sets buffer to the latest engine memory buffer
   *
   * Note that if the engine wasm memory grows, all dataviews into the memory must be updated
   */
  setBuffer: (buffer: ArrayBuffer) => void;
  /**
   * Sets the context pointer
   */
  setContext: (ptr: EnginePointer) => void;
  /**
   * Called from the engine right before each simulation step.
   */
  beforeFrame?: (frame: number) => void;
};

export type SystemsCallback = (
  system_handle: number,
  ptr: EnginePointer
) => void;

export type SerializeFn = () => {
  size: number;
  write(buffer: ArrayBufferLike, ptr: EnginePointer): void;
};

export type DeserializeFn = (
  buffer: ArrayBufferLike,
  ptr: EnginePointer,
  size: number
) => void;

/**
 * Sim is a portable simulation that is responsible for:
 *
 * * Moving the engine forward and backward in time
 * * Maintaining a js-friendly view of engine memory
 * * Pausing and unpausing game logic
 */
export class Sim {
  wasm: WasmEngine;
  id: string;
  #memory: WebAssembly.Memory;
  #time: TimeContext;
  #serialize?: SerializeFn;
  #isPaused: boolean = false;

  constructor(
    wasm: WasmEngine,
    memory: WebAssembly.Memory,
    opts?: { serialize?: SerializeFn }
  ) {
    this.wasm = wasm;
    this.#memory = memory;
    this.#time = new TimeContext(
      new DataView(this.#memory.buffer, this.wasm.get_time_ctx())
    );

    this.id = `${Math.floor(Math.random() * 1_000_000)}`;

    this.#serialize = opts?.serialize;
  }

  step(ms?: number): number {
    if (this.#isPaused && !this.isReplaying) {
      // console.log({ paused: this.#isPaused, isReplaying: this.isReplaying });
      return 0;
    }
    return this.wasm.step(ms ?? 16);
  }

  /**
   * Run a single simulation frame. step wraps this in an accumulator.
   * Use this for rollback resimulation to avoid re-entrancy issues with step().
   */
  tick(): void {
    this.wasm.tick();
  }

  /**
   * Clone a session from another running sim.
   * This dumps a snapshot at the current frame and the tape data from the source
   *
   * @param source
   */
  cloneSession(source: Sim): void {
    this.loadTape(source.saveTape());
    this.restore(source.snapshot());
  }

  pause() {
    this.#isPaused = true;
  }

  unpause() {
    this.#isPaused = false;
  }

  get isPaused(): boolean {
    return this.#isPaused;
  }

  stepBack() {
    if (this.time.frame === 0) {
      return;
    }

    this.seek(this.time.frame - 1);
  }

  /**
   * Seek to the start of a given frame
   * @param frame - frame number to replay to
   */
  seek(frame: number, inclusive?: boolean) {
    assert(
      this.hasHistory,
      "Not recording or playing back, can't seek to frame"
    );

    const targetFrame = inclusive ? frame + 1 : frame;

    const shouldMute = frame < this.time.frame;
    if (shouldMute) {
      muteConsole();
    }
    this.wasm.seek(targetFrame);
    if (shouldMute) {
      unmuteConsole();
    }
  }

  record() {
    const serializer = this.#serialize ? this.#serialize() : null;
    const size = serializer ? serializer.size : 0;
    const result = this.wasm.start_recording(size, 1_000_000);
    if (result !== 0) {
      throw new Error(`failed to start recording, error code=${result}`);
    }
  }

  /**
   * Snapshot the current game state into a byte array
   */
  snapshot(): Uint8Array<ArrayBuffer> {
    const serializer = this.#serialize ? this.#serialize() : null;
    const size = serializer ? serializer.size : 0;

    const ptr = this.wasm.take_snapshot(size);
    const header = new Uint32Array(this.#memory.buffer, ptr, 4);
    const userLenIndex =
      SNAPSHOT_HEADER_USER_LEN_OFFSET / Uint32Array.BYTES_PER_ELEMENT;
    const engineLenIndex =
      SNAPSHOT_HEADER_ENGINE_LEN_OFFSET / Uint32Array.BYTES_PER_ELEMENT;
    assert(header[userLenIndex], `header user length missing`);
    assert(header[engineLenIndex], `header engine length missing`);
    const length = header[userLenIndex] + header[engineLenIndex];
    const memoryView = new Uint8Array(this.#memory.buffer, ptr, length);

    const copy = new Uint8Array(length);
    copy.set(memoryView);

    return copy;
  }

  /**
   * Get a recording of the current tape to linear memory
   */
  saveTape(): Uint8Array<ArrayBuffer> {
    const tapeLen = this.wasm.get_tape_len();
    const tapePtr = this.wasm.get_tape_ptr();
    const memoryView = new Uint8Array(this.#memory.buffer, tapePtr, tapeLen);

    const copy = new Uint8Array(tapeLen);
    copy.set(memoryView);

    return copy;
  }

  /**
   * Load a tape
   */
  loadTape(tape: Uint8Array) {
    const tapePtr = this.wasm.alloc(tape.byteLength);
    assert(
      tapePtr > 0,
      `failed to allocate ${tape.byteLength} bytes for tape load, pointer=${tapePtr}`
    );

    // copy tape into wasm memory
    const memoryView = new Uint8Array(
      this.#memory.buffer,
      tapePtr,
      tape.byteLength
    );
    memoryView.set(tape);

    // load the tape
    this.wasm.stop_recording();
    const result = this.wasm.load_tape(tapePtr, tape.byteLength);
    assert(result === 0, `failed to load tape, error code=${result}`);

    // free the allocated memory
    this.wasm.free(tapePtr, tape.byteLength);
  }

  /**
   * Restore the game state from a snapshot byte array
   */
  restore(snapshot: Uint8Array) {
    const dataPtr = this.wasm.alloc(snapshot.byteLength);
    assert(
      dataPtr > 0,
      `failed to allocate ${snapshot.byteLength} bytes for snapshot restore, pointer=${dataPtr}`
    );

    // copy snapshot into wasm memory
    const memoryView = new Uint8Array(
      this.#memory.buffer,
      dataPtr,
      snapshot.byteLength
    );
    memoryView.set(snapshot);

    // restore the snapshot
    this.wasm.restore(dataPtr);

    // free the allocated memory
    this.wasm.free(dataPtr, snapshot.byteLength);
  }

  /**
   * Unmount the simulation and free all associated memory
   */
  unmount() {
    this.wasm.deinit();
  }

  get time(): TimeContext {
    if (
      !this.#time.dataView ||
      this.#time.dataView.buffer !== this.#memory.buffer
    ) {
      // update the data view to the latest memory buffer
      this.#time.dataView = new DataView(
        this.#memory.buffer,
        this.wasm.get_time_ctx()
      );
    }
    return this.#time;
  }

  get buffer(): ArrayBuffer {
    return this.#memory.buffer;
  }

  get isRecording(): boolean {
    return this.wasm.is_recording();
  }

  get isReplaying(): boolean {
    return this.wasm.is_replaying();
  }

  get hasHistory(): boolean {
    return this.isRecording || this.isReplaying;
  }

  emit = {
    keydown: (key: Key): void => {
      this.wasm.emit_keydown(keyToKeyCode(key));
    },
    keyup: (key: Key): void => {
      this.wasm.emit_keyup(keyToKeyCode(key));
    },
    mousemove: (x: number, y: number): void => {
      this.wasm.emit_mousemove(x, y);
    },
    mousedown: (button: MouseButton): void => {
      this.wasm.emit_mousedown(mouseButtonToMouseButtonCode(button));
    },
    mouseup: (button: MouseButton): void => {
      this.wasm.emit_mouseup(mouseButtonToMouseButtonCode(button));
    },
    mousewheel: (x: number, y: number): void => {
      this.wasm.emit_mousewheel(x, y);
    },
  };
}
