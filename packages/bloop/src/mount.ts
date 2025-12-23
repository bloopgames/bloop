import {
  DEFAULT_WASM_URL,
  type EnginePointer,
  NetContext,
  type WasmEngine,
} from "@bloopjs/engine";
import { type EngineHooks, Sim } from "./sim";
import { assert } from "./util";

/**
 * An object that can be mounted to the simulation engine.
 * Bloop instances satisfy this interface.
 */
export type Mountable = {
  hooks: EngineHooks;
  /** Get the shared NetContext instance */
  getNet(): NetContext;
};

/**
 * Mount a simulation engine instance - instantiates wasm and sets up hooks and initial state.
 *
 * This is called by app.start on the web.
 */
export async function mount(
  mountable: Mountable,
  options?: MountOptions,
): Promise<MountResult> {
  const wasmUrl = options?.wasmUrl ?? DEFAULT_WASM_URL;
  const startRecording = options?.startRecording ?? true;
  const { maxEvents, maxPacketBytes } = calculateTapeConfig(options?.tape);

  // https://github.com/oven-sh/bun/issues/12434
  const bytes = await fetch(wasmUrl)
    .then((res) => res.arrayBuffer())
    .catch((e) => {
      console.error(`Failed to fetch wasm at ${wasmUrl}`, e);
      throw e;
    });

  // 1mb to 64mb
  // use bun check:wasm to find initial memory page size
  const memory = new WebAssembly.Memory({ initial: 310, maximum: 1000 });

  // Create sim early so we can reference it in callbacks
  let sim: Sim;

  const wasmInstantiatedSource = await WebAssembly.instantiate(bytes, {
    env: {
      memory,
      __systems: function (system_handle: number, ptr: number) {
        mountable.hooks.setBuffer(memory.buffer);
        mountable.hooks.systemsCallback(system_handle, ptr);
      },
      __before_frame: function (ptr: EnginePointer, frame: number) {
        try {
          // Refresh DataViews before beforeFrame hook (memory may have grown)
          mountable.hooks.setBuffer(memory.buffer);
          mountable.hooks.setContext(ptr);
          mountable.hooks.beforeFrame?.(frame);
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
        const serializer = mountable.hooks.serialize();
        return serializer ? serializer.size : 0;
      },
      user_data_serialize: function (ptr: EnginePointer, len: number) {
        const serializer = mountable.hooks.serialize();
        assert(
          len === serializer.size,
          `user_data_serialize length mismatch, expected=${serializer.size} got=${len}`,
        );
        serializer.write(memory.buffer, ptr);
      },
      user_data_deserialize: function (ptr: EnginePointer, len: number) {
        mountable.hooks.deserialize(memory.buffer, ptr, len);
      },
    },
  });
  const wasm = wasmInstantiatedSource.instance.exports as WasmEngine;

  const enginePointer = wasm.initialize();
  sim = new Sim(wasm, memory, {
    serialize: mountable.hooks.serialize,
    netContext: mountable.getNet(),
  });

  if (startRecording) {
    sim.record(maxEvents, maxPacketBytes);
  }

  mountable.hooks.setBuffer(memory.buffer);
  mountable.hooks.setContext(enginePointer);

  return {
    sim,
  };
}

export type TapeOptions = (
  | { maxEvents: number }
  | { duration: number; averageEventsPerFrame?: number }
) & {
  /**
   * Set to true for local-only recording (no network packet buffer).
   * Default: false (allocates 2MB for network packet recording)
   */
  localOnly?: boolean;
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

export type MountResult = {
  sim: Sim;
};

function calculateTapeConfig(tape?: TapeOptions): {
  maxEvents: number;
  maxPacketBytes: number;
} {
  let maxEvents: number;

  if (!tape) {
    maxEvents = 1024; // default
  } else if ("maxEvents" in tape) {
    maxEvents = tape.maxEvents;
  } else {
    // duration-based: frames * average events per frame
    // At 60fps, duration seconds = duration * 60 frames
    const avgEvents = tape.averageEventsPerFrame ?? 2;
    maxEvents = Math.ceil(tape.duration * 60 * avgEvents);
  }

  // Default to network mode (2MB), localOnly mode uses 0 bytes
  const maxPacketBytes = tape?.localOnly ? 0 : Sim.NETWORK_MAX_PACKET_BYTES;

  return { maxEvents, maxPacketBytes };
}
