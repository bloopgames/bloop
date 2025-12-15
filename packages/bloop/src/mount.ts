import {
  DEFAULT_WASM_URL,
  type EnginePointer,
  type WasmEngine,
} from "@bloopjs/engine";
import { type EngineHooks, Sim } from "./sim";
import { assert } from "./util";

/**
 * Mount a simulation engine instance - instantiates wasm and sets up hooks and initial state.
 *
 * This is called by app.start on the web.
 */
export async function mount(
  opts: MountOpts,
  options?: MountOptions,
): Promise<MountResult> {
  const wasmUrl = options?.wasmUrl ?? opts.wasmUrl ?? DEFAULT_WASM_URL;
  const startRecording = options?.startRecording ?? opts.startRecording ?? true;
  const maxEvents = calculateMaxEvents(options?.tape);
  const maxPacketBytes = options?.tape?.maxPacketBytes;

  // https://github.com/oven-sh/bun/issues/12434
  const bytes = await fetch(wasmUrl)
    .then((res) => res.arrayBuffer())
    .catch((e) => {
      console.error(`Failed to fetch wasm at ${wasmUrl}`, e);
      throw e;
    });

  // 1mb to 64mb
  // use bun check:wasm to find initial memory page size
  const memory = new WebAssembly.Memory({ initial: 236, maximum: 1000 });

  // Create sim early so we can reference it in callbacks
  let sim: Sim;

  const wasmInstantiatedSource = await WebAssembly.instantiate(bytes, {
    env: {
      memory,
      __systems: function (system_handle: number, ptr: number) {
        opts.hooks.setBuffer(memory.buffer);
        opts.hooks.systemsCallback(system_handle, ptr);
      },
      __before_frame: function (ptr: EnginePointer, frame: number) {
        try {
          // Refresh DataViews before beforeFrame hook (memory may have grown)
          opts.hooks.setBuffer(memory.buffer);
          opts.hooks.setContext(ptr);
          opts.hooks.beforeFrame?.(frame);
        } catch (e) {
          console.error("Error in beforeFrame hook:", e);
        }
      },
      __on_tape_full: function (_ctxPtr: number) {
        if (!sim) {
          throw new Error("Sim not initialized in on_tape_full");
        }
        const tapeBytes = sim.saveTape();
        if (sim.onTapeFull) {
          sim.onTapeFull(tapeBytes);
        } else {
          const size = tapeBytes.length / 1024;
          const duration = sim.time.time;
          const kbPerSecond = size / duration;

          console.warn("Tape full. Recording stopped", {
            size: `${(tapeBytes.length / 1024).toFixed(0)}kb`,
            duration: `${sim.time.time.toFixed(2)}s`,
            kbPerSecond: `${kbPerSecond.toFixed(2)} kb/s`,
          });
        }
      },
      console_log: function (ptr: EnginePointer, len: number) {
        const bytes = new Uint8Array(memory.buffer, ptr, len);
        const string = new TextDecoder("utf-8").decode(bytes);
        console.log(string);
      },
      __user_data_len: function () {
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
  sim = new Sim(wasm, memory, {
    serialize: opts.hooks.serialize,
  });

  if (startRecording) {
    sim.record(maxEvents, maxPacketBytes);
  }

  opts.hooks.setBuffer(memory.buffer);
  opts.hooks.setContext(enginePointer);

  return {
    sim,
  };
}

export type TapeOptions = (
  | { maxEvents: number }
  | { duration: number; averageEventsPerFrame?: number }
) & {
  /**
   * Maximum packet buffer size in bytes
   * Default: 64KB (sufficient for local recording)
   * For network sessions, use Sim.NETWORK_MAX_PACKET_BYTES (2MB)
   */
  maxPacketBytes?: number;
};

export type MountOptions = {
  /**
   * Whether to start recording immediately upon mount
   * Defaults to true
   */
  startRecording?: boolean;

  /**
   * Tape configuration options
   */
  tape?: TapeOptions;

  /**
   * Custom WASM URL (for advanced use cases)
   */
  wasmUrl?: URL;
};

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
  sim: Sim;
};

function calculateMaxEvents(tape?: TapeOptions): number {
  if (!tape) return 1024; // default

  if ("maxEvents" in tape) {
    return tape.maxEvents;
  }

  // duration-based: frames * average events per frame
  // At 60fps, duration seconds = duration * 60 frames
  const avgEvents = tape.averageEventsPerFrame ?? 2;
  return Math.ceil(tape.duration * 60 * avgEvents);
}
