import {
  DEFAULT_WASM_URL,
  type EnginePointer,
  type Key,
  keyToKeyCode,
  type MouseButton,
  mouseButtonToMouseButtonCode,
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
  #vcr = {
    isRecording: false,
    isPlayingBack: false,
    snapshot: new Uint8Array(),
  };
  #serialize?: SerializeFn;
  #deserialize?: DeserializeFn;
  constructor(
    wasm: WasmEngine,
    memory: WebAssembly.Memory,
    opts?: { serialize?: SerializeFn; deserialize?: DeserializeFn },
  ) {
    this.wasm = wasm;
    this.#memory = memory;
    this.#time = new TimeContext(
      new DataView(this.#memory.buffer, this.wasm.get_time_ctx()),
    );
    this.#serialize = opts?.serialize;
    this.#deserialize = opts?.deserialize;
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
    this.#vcr.isRecording = true;
    this.#vcr.snapshot = this.snapshot();
    this.wasm.start_recording(size, 1024);
  }

  snapshot(): Uint8Array<ArrayBuffer> {
    const serializer = this.#serialize ? this.#serialize() : null;
    const size = serializer ? serializer.size : 0;

    const ptr = this.wasm.take_snapshot(size);

    const header = new Uint32Array(this.#memory.buffer, ptr, 4);
    assert(header[1], `header user length missing`);
    assert(header[2], `header engine length missing`);
    const length = header[1] + header[2];
    const memoryView = new Uint8Array(this.#memory.buffer, ptr, length);

    if (serializer) {
      serializer.write(
        this.#memory.buffer,
        ptr + this.wasm.snapshot_user_data_offset(),
      );
    }
    return memoryView;
  }

  restore(snapshot: Uint8Array) {
    const dataPtr = this.wasm.alloc(snapshot.byteLength);
    assert(
      dataPtr > 0,
      `failed to allocate memory for snapshot restore, pointer=${dataPtr}`,
    );
    const memoryView = new Uint8Array(
      this.#memory.buffer,
      dataPtr,
      snapshot.byteLength,
    );

    const header = new Uint32Array(snapshot.buffer, snapshot.byteOffset, 4);
    assert(header[1], `header user length missing`);
    const userDataLen = header[1];

    console.log({ userDataLen });

    if (this.#deserialize) {
      console.log("Deserializing...");
      this.#deserialize(
        snapshot.buffer,
        snapshot.byteOffset + this.wasm.snapshot_user_data_offset(),
        userDataLen,
      );
    }

    memoryView.set(snapshot);
    this.wasm.restore(dataPtr);
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

  get buffer() {
    return this.#memory.buffer;
  }

  get isRecording(): boolean {
    return this.#vcr.isRecording;
  }

  get isPlayingBack(): boolean {
    return this.#vcr.isPlayingBack;
  }

  get hasHistory(): boolean {
    return this.isRecording || this.isPlayingBack;
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
    deserialize: opts.deserialize,
  });

  runtime.record();

  return {
    runtime,
    wasm,
  };
}
