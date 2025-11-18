import {
  DEFAULT_WASM_URL,
  type EnginePointer,
  type Key,
  keyToKeyCode,
  type MouseButton,
  mouseButtonToMouseButtonCode,
  SNAPSHOT_HEADER_ENGINE_LEN_OFFSET,
  SNAPSHOT_HEADER_LEN,
  SNAPSHOT_HEADER_USER_LEN_OFFSET,
  TimeContext,
  type WasmEngine,
} from "@bloopjs/engine";
import { assert } from "./util";

export type MountOpts = {
  wasmUrl?: URL;
  /**
   * A callback function to run logic for a given frame
   */
  systemsCallback: (system_handle: number, ptr: EnginePointer) => void;

  /**
   * Sets buffer to the latest engine memory buffer
   *
   * Note that if the engine wasm memory grows, all dataviews into the memory must be updated
   */
  setBuffer: (buffer: ArrayBuffer) => void;

  /**
   * Whether to start recording immediately upon mount
   * Defaults to true
   */
  startRecording?: boolean;

  /**
   * Optional hook to serialize some data when snapshotting
   */
  serialize?: SerializeFn;

  /**
   * Optional hook to deserialize some data when restoring
   */
  deserialize?: DeserializeFn;
};

export type SerializeFn = () => {
  size: number;
  write(buffer: ArrayBufferLike, ptr: EnginePointer): void;
};

export type DeserializeFn = (
  buffer: ArrayBufferLike,
  ptr: EnginePointer,
  size: number,
) => void;

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
  #serialize?: SerializeFn;
  constructor(
    wasm: WasmEngine,
    memory: WebAssembly.Memory,
    opts?: { serialize?: SerializeFn },
  ) {
    this.wasm = wasm;
    this.#memory = memory;
    this.#time = new TimeContext(
      new DataView(this.#memory.buffer, this.wasm.get_time_ctx()),
    );
    this.#serialize = opts?.serialize;
  }

  step(ms?: number) {
    this.wasm.step(ms ?? 16);
  }

  stepBack() {
    if (this.time.frame === 0) {
      return;
    }
    this.seek(this.time.frame - 1);
  }

  seek(frame: number) {
    assert(
      this.hasHistory,
      "Not recording or playing back, can't seek to frame",
    );
    this.wasm.seek(frame);
  }

  record() {
    const serializer = this.#serialize ? this.#serialize() : null;
    const size = serializer ? serializer.size : 0;
    this.wasm.start_recording(size, 1024);
  }

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

  restore(snapshot: Uint8Array) {
    const dataPtr = this.wasm.alloc(snapshot.byteLength);
    assert(
      dataPtr > 0,
      `failed to allocate ${snapshot.byteLength} bytes for snapshot restore, pointer=${dataPtr}`,
    );

    // copy snapshot into wasm memory
    const memoryView = new Uint8Array(
      this.#memory.buffer,
      dataPtr,
      snapshot.byteLength,
    );
    memoryView.set(snapshot);

    // restore the snapshot
    this.wasm.restore(dataPtr);

    // free the allocated memory
    this.wasm.free(dataPtr, snapshot.byteLength);
  }

  get time(): TimeContext {
    if (
      !this.#time.dataView ||
      this.#time.dataView.buffer !== this.#memory.buffer
    ) {
      // update the data view to the latest memory buffer
      this.#time.dataView = new DataView(
        this.#memory.buffer,
        this.wasm.get_time_ctx(),
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
        opts.setBuffer(memory.buffer);
        opts.systemsCallback(system_handle, ptr);
      },
      console_log: function (ptr: EnginePointer, len: number) {
        const bytes = new Uint8Array(memory.buffer, ptr, len);
        const string = new TextDecoder("utf-8").decode(bytes);
        console.log(string);
      },
      user_data_len: function () {
        const serializer = opts.serialize ? opts.serialize() : null;
        return serializer ? serializer.size : 0;
      },
      user_data_serialize: function (ptr: EnginePointer, len: number) {
        if (!opts.serialize) {
          return;
        }
        const serializer = opts.serialize();
        if (len !== serializer.size) {
          throw new Error(
            `user_data_write length mismatch, expected=${serializer.size} got=${len}`,
          );
        }
        serializer.write(memory.buffer, ptr);
      },
      user_data_deserialize: function (ptr: EnginePointer, len: number) {
        if (!opts.deserialize) {
          return;
        }
        opts.deserialize(memory.buffer, ptr, len);
      },
    },
  });
  const wasm = wasmInstantiatedSource.instance.exports as WasmEngine;

  wasm.initialize();

  const runtime = new Runtime(wasm, memory, {
    serialize: opts.serialize,
  });

  if (opts.startRecording ?? true) {
    runtime.record();
  }

  return {
    runtime,
    wasm,
  };
}
