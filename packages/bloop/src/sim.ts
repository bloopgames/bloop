import {
  type EnginePointer,
  type Key,
  keyToKeyCode,
  type MouseButton,
  mouseButtonToMouseButtonCode,
  NetContext,
  type NetEvent,
  type NetEventType,
  SNAPSHOT_HEADER_ENGINE_LEN_OFFSET,
  SNAPSHOT_HEADER_USER_LEN_OFFSET,
  TimeContext,
  type WasmEngine,
} from "@bloopjs/engine";
import { Net } from "./net";
import { assert } from "./util";

const originalConsole = (globalThis as any).console;

const noop = () => {};

const stubConsole = Object.fromEntries(
  Object.keys(originalConsole).map((key) => [key, noop]),
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
  ptr: EnginePointer,
) => void;

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
 * Sim is a portable simulation that is responsible for:
 *
 * * Moving the engine forward and backward in time
 * * Maintaining a js-friendly view of engine memory
 * * Pausing and unpausing game logic
 * * Managing recording and tapes
 */
export class Sim {
  wasm: WasmEngine;
  id: string;
  #memory: WebAssembly.Memory;
  #time: TimeContext;
  #serialize?: SerializeFn;
  #isPaused: boolean = false;
  #pendingNetEvents: NetEvent[] = [];

  /**
   * Shared network context - same instance as game.context.net.
   * Provides access to network state (status, roomCode, wants, etc.)
   */
  readonly net: NetContext;

  /**
   * Internal network API for packet management (used by platform).
   * @internal
   */
  readonly _netInternal: Net;

  /**
   * Callback fired when tape buffer fills up and recording stops.
   * The tape data is passed so you can save it before clearing.
   */
  onTapeFull?: (tape: Uint8Array) => void;

  /**
   * Callback to notify the game of network events.
   * Set by the Bloop instance to dispatch events to system handlers.
   * @internal
   */
  _onNetEvent?: (event: NetEvent) => void;

  constructor(
    wasm: WasmEngine,
    memory: WebAssembly.Memory,
    opts?: { serialize?: SerializeFn; netContext?: NetContext },
  ) {
    this.wasm = wasm;
    this.#memory = memory;
    this.#time = new TimeContext(
      new DataView(this.#memory.buffer, this.wasm.get_time_ctx()),
    );

    this.id = `${Math.floor(Math.random() * 1_000_000)}`;

    this.#serialize = opts?.serialize;
    this.net = opts?.netContext ?? new NetContext();
    this._netInternal = new Net(wasm, memory);
  }

  step(ms?: number): number {
    if (this.#isPaused) {
      return 0;
    }
    // Process pending network events before stepping
    this.#processNetEvents();
    return this.wasm.step(ms ?? 16);
  }

  /**
   * Process pending network events and update NetContext state
   */
  #processNetEvents(): void {
    for (const event of this.#pendingNetEvents) {
      // Update NetContext state based on event type
      switch (event.type) {
        case "join:ok":
          this.net._setRoomCode(event.data.roomCode);
          this.net._setStatus("connected");
          // Set self as first peer
          this.net._setPeerCount(1);
          break;
        case "join:fail":
          this.net._setStatus("local");
          break;
        case "peer:join":
          // Increment peer count and mark as in session when another peer joins
          this.net._setPeerCount(this.net.peerCount + 1);
          if (this.net.peerCount >= 2) {
            this.net._setInSession(true);
          }
          break;
        case "peer:leave":
          this.net._setPeerCount(Math.max(0, this.net.peerCount - 1));
          if (this.net.peerCount <= 1) {
            this.net._setInSession(false);
          }
          break;
        case "session:start":
          this.net._setInSession(true);
          break;
        case "session:end":
          this.net._setInSession(false);
          this.net._setRoomCode("");
          this.net._setStatus("local");
          break;
      }

      // Dispatch to game handler
      this._onNetEvent?.(event);
    }
    this.#pendingNetEvents = [];
  }

  /**
   * Run a single simulation frame. step wraps this in an accumulator.
   * Use this for advanced use cases where you need to execute a single frame outside of the engine.
   * Consider `step()` for normal frame advancement. And `seek()` for moving to specific frames within a tape.
   */
  tick(isResimulating?: boolean): void {
    this.wasm.tick(isResimulating ?? false);
  }

  /**
   * Clone a session from another running sim.
   * This dumps a snapshot at the current frame and the tape data from the source
   *
   * @param source
   */
  cloneSession(source: Sim): void {
    if (source.isRecording) {
      this.loadTape(source.saveTape());
    }
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
      "Not recording or playing back, can't seek to frame",
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
   * Packet buffer size (2MB) for network session recording
   */
  static readonly NETWORK_MAX_PACKET_BYTES = 2 * 1024 * 1024;

  /**
   * Start recording the simulation at the current frame
   * @param maxEvents Maximum number of events to record
   * @param maxPacketBytes Maximum packet buffer size (0 for local-only, 2MB default for network)
   */
  record(
    maxEvents: number = 1024,
    maxPacketBytes: number = Sim.NETWORK_MAX_PACKET_BYTES,
  ) {
    const serializer = this.#serialize ? this.#serialize() : null;
    const size = serializer ? serializer.size : 0;
    const result = this.wasm.start_recording(size, maxEvents, maxPacketBytes);
    if (result !== 0) {
      throw new Error(`failed to start recording, error code=${result}`);
    }
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
      `failed to allocate ${tape.byteLength} bytes for tape load, pointer=${tapePtr}`,
    );

    // copy tape into wasm memory
    const memoryView = new Uint8Array(
      this.#memory.buffer,
      tapePtr,
      tape.byteLength,
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
        this.wasm.get_time_ctx(),
      );
    }
    return this.#time;
  }

  get buffer(): ArrayBuffer {
    return this.#memory.buffer;
  }

  get isRecording(): boolean {
    return Boolean(this.wasm.is_recording());
  }

  get isReplaying(): boolean {
    return Boolean(this.wasm.is_replaying());
  }

  get hasHistory(): boolean {
    return this.isRecording || this.isReplaying;
  }

  emit = {
    keydown: (key: Key, peerId: number = 0): void => {
      this.wasm.emit_keydown(keyToKeyCode(key), peerId);
    },
    keyup: (key: Key, peerId: number = 0): void => {
      this.wasm.emit_keyup(keyToKeyCode(key), peerId);
    },
    mousemove: (x: number, y: number, peerId: number = 0): void => {
      this.wasm.emit_mousemove(x, y, peerId);
    },
    mousedown: (button: MouseButton, peerId: number = 0): void => {
      this.wasm.emit_mousedown(mouseButtonToMouseButtonCode(button), peerId);
    },
    mouseup: (button: MouseButton, peerId: number = 0): void => {
      this.wasm.emit_mouseup(mouseButtonToMouseButtonCode(button), peerId);
    },
    mousewheel: (x: number, y: number, peerId: number = 0): void => {
      this.wasm.emit_mousewheel(x, y, peerId);
    },
    /**
     * Emit a network event (join:ok, peer:join, etc.)
     * Events are queued and processed at the start of the next step.
     */
    network: <T extends NetEventType>(
      type: T,
      data: Extract<NetEvent, { type: T }>["data"],
    ): void => {
      this.#pendingNetEvents.push({ type, data } as NetEvent);
    },
  };

  // ─────────────────────────────────────────────────────────────
  // Session / Rollback
  // ─────────────────────────────────────────────────────────────

  /**
   * Initialize a multiplayer session with rollback support.
   * Captures current frame as session start frame.
   *
   * @param peerCount Number of peers in the session
   */
  sessionInit(peerCount: number): void {
    const serializer = this.#serialize ? this.#serialize() : null;
    const size = serializer ? serializer.size : 0;
    const result = this.wasm.session_init(peerCount, size);
    assert(result === 0, `failed to initialize session, error code=${result}`);
  }

  /**
   * End the current session and clean up rollback state.
   */
  sessionEnd(): void {
    this.wasm.session_end();
  }
}
