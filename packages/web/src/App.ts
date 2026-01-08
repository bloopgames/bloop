import {
  type Bloop,
  type LoadTapeOptions,
  type MountOptions,
  mount,
  type Sim,
} from "@bloopjs/bloop";
import type { Key } from "@bloopjs/engine";
import { mouseButtonCodeToMouseButton, readTapeHeader } from "@bloopjs/engine";
import { DebugUi, type DebugUiOptions } from "./debugui/mod.ts";
import {
  debugState,
  triggerHmrFlash,
  wirePlaybarHandlers,
  wireTapeDragDrop,
} from "./debugui/state.ts";
import {
  joinRoom as joinRoomInternal,
  type RoomEvents,
} from "./netcode/broker";
import { logger } from "./netcode/logs.ts";
import { reconcile } from "./netcode/reconcile.ts";

export type StartOptions = {
  /** A bloop game instance */
  game: Bloop<any>;
  /** A pre-mounted sim instance, defaults to mount with default options */
  sim?: Sim;
  /** An override url to use to fetch the engine wasm */
  wasmUrl?: URL;
  /** Whether the sim should pause before running the first frame, defaults to false */
  startPaused?: boolean;
  /** Whether the sim should be recording to tape from initialization, defaults to true */
  startRecording?: boolean;
  /** URL for the WebRTC signaling broker (e.g. "wss://broker.example.com/ws") */
  brokerUrl?: string;
  /** Enable debug UI with optional configuration */
  debugUi?: boolean | DebugUiOptions;
  /** Tape recording options */
  tape?: MountOptions["tape"];
};

const DEFAULT_BROKER_URL = "wss://webrtc-divine-glade-8064.fly.dev/ws";

/** Start a bloop game on the web */
export async function start(opts: StartOptions): Promise<App> {
  if (!opts.sim) {
    const { sim } = await mount(opts.game, {
      startRecording: opts.startRecording ?? true,
      wasmUrl: opts.wasmUrl,
    });
    opts.sim = sim;
  }

  const debugOpts = opts.debugUi
    ? typeof opts.debugUi === "boolean"
      ? { initiallyVisible: true }
      : opts.debugUi
    : undefined;

  const app = new App(
    opts.sim,
    opts.game,
    opts.brokerUrl ?? DEFAULT_BROKER_URL,
    debugOpts,
  );

  return app;
}

/**
 * The main application class for running a bloop game in the browser
 *
 * This class handles translating browser events and APIs to bloopjs and the wasm engine.
 *
 * Usually instantiated with the start() function
 */
export class App {
  #sim: Sim;
  game: Bloop<any>;
  /** URL for the WebRTC signaling broker */
  readonly brokerUrl: string;
  /** RequestAnimationFrame handle for cancelling */
  #rafHandle: number | null = null;
  #unsubscribe: UnsubscribeFn | null = null;
  #now: number = performance.now();
  #debugUi: DebugUi | null = null;

  #abortController: AbortController = new AbortController();

  constructor(
    sim: Sim,
    game: Bloop<any>,
    brokerUrl: string,
    debugUiOpts?: DebugUiOptions,
  ) {
    this.#sim = sim;
    this.game = game;
    this.brokerUrl = brokerUrl;

    if (debugUiOpts) {
      this.#initDebugUi(debugUiOpts);
    }

    this.game.hooks.beforeFrame = (frame: number) => {
      logger.frameNumber = this.#sim.time.frame;
      logger.matchFrame = this.game.context.net.matchFrame;
      this.beforeFrame.notify(frame);
    };

    this.subscribe();

    reconcile(this, this.#abortController.signal).catch((err) => {
      console.error("Error in lemmyloop:", err);
    });
  }

  /** The simulation instance associated with this app */
  get sim(): Sim {
    return this.#sim;
  }

  set sim(sim: Sim) {
    this.#sim = sim;
  }

  /** Initialize debug UI (creates shadow DOM and mounts Preact) */
  #initDebugUi(opts: DebugUiOptions = {}): DebugUi {
    if (this.#debugUi) return this.#debugUi;
    this.#debugUi = new DebugUi(opts);

    // Wire up playbar handlers and drag-drop
    wirePlaybarHandlers(this);
    wireTapeDragDrop(this.#debugUi.canvas, this);

    return this.#debugUi;
  }

  /** Access debug UI instance */
  get debugUi(): DebugUi | null {
    return this.#debugUi;
  }

  /** Get the canvas element from debug UI (for game rendering) */
  get canvas(): HTMLCanvasElement | null {
    return this.#debugUi?.canvas ?? null;
  }

  /** Join a multiplayer room via the broker */
  joinRoom(roomId: string, callbacks: RoomEvents): void {
    joinRoomInternal(this.brokerUrl, roomId, callbacks);
  }

  /** Load a tape for replay */
  loadTape(tape: Uint8Array, options?: LoadTapeOptions): void {
    const header = readTapeHeader(tape);
    this.sim.loadTape(tape, options);
    this.sim.seek(header.startFrame);
    this.sim.pause();

    // Update debug state with tape info
    debugState.tapeStartFrame.value = header.startFrame;
    debugState.tapeFrameCount.value = header.frameCount;
    debugState.tapeUtilization.value = 1; // Loaded tape is "full"
    debugState.playheadPosition.value = 0;
    debugState.isPlaying.value = false;
  }

  /** Event listeners for before a frame is processed */
  beforeFrame: ReturnType<typeof createListener> = createListener<[number]>();
  /** Event listeners for after a frame is processed */
  afterFrame: ReturnType<typeof createListener> = createListener<[number]>();
  /** Event listeners for HMR events */
  onHmr: ReturnType<typeof createListener> = createListener<[HmrEvent]>();

  /** Subscribe to the browser events and start the render loop */
  subscribe(): void {
    // TODO: move this logic to the engine
    // Skip emitting input events during replay to avoid filling the event buffer
    const shouldEmitInputs = () => !this.sim.isReplaying;

    const handleKeydown = (event: KeyboardEvent) => {
      if (shouldEmitInputs()) this.sim.emit.keydown(event.code as Key);
    };
    window.addEventListener("keydown", handleKeydown);

    const handleKeyup = (event: KeyboardEvent) => {
      if (shouldEmitInputs()) this.sim.emit.keyup(event.code as Key);
    };
    window.addEventListener("keyup", handleKeyup);

    const handleMousemove = (event: MouseEvent) => {
      if (shouldEmitInputs())
        this.sim.emit.mousemove(event.clientX, event.clientY);
    };
    window.addEventListener("mousemove", handleMousemove);

    const handleMousedown = (event: MouseEvent) => {
      if (shouldEmitInputs())
        this.sim.emit.mousedown(mouseButtonCodeToMouseButton(event.button + 1));
    };
    window.addEventListener("mousedown", handleMousedown);

    const handleMouseup = (event: MouseEvent) => {
      if (shouldEmitInputs())
        this.sim.emit.mouseup(mouseButtonCodeToMouseButton(event.button + 1));
    };
    window.addEventListener("mouseup", handleMouseup);

    const handleMousewheel = (event: WheelEvent) => {
      if (shouldEmitInputs())
        this.sim.emit.mousewheel(event.deltaX, event.deltaY);
    };
    window.addEventListener("wheel", handleMousewheel);

    // Touch events for mobile support
    const handleTouchstart = (event: TouchEvent) => {
      if (!shouldEmitInputs()) return;
      const touch = event.touches[0];
      if (touch) {
        this.sim.emit.mousemove(touch.clientX, touch.clientY);
        this.sim.emit.mousedown("Left");
      }
    };
    window.addEventListener("touchstart", handleTouchstart);

    const handleTouchend = () => {
      if (shouldEmitInputs()) this.sim.emit.mouseup("Left");
    };
    window.addEventListener("touchend", handleTouchend);

    const handleTouchmove = (event: TouchEvent) => {
      if (!shouldEmitInputs()) return;
      const touch = event.touches[0];
      if (touch) {
        this.sim.emit.mousemove(touch.clientX, touch.clientY);
      }
    };
    window.addEventListener("touchmove", handleTouchmove);

    const playbarHotkeys = (event: KeyboardEvent) => {
      // Ctrl/Cmd+S to save tape
      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
        event.preventDefault();
        if (this.sim.hasHistory) {
          const tape = this.sim.saveTape();
          const blob = new Blob([tape], { type: "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `tape-${Date.now()}.bloop`;
          a.click();
          URL.revokeObjectURL(url);
        }
        return;
      }

      const isPauseHotkey =
        event.key === "Enter" && (event.ctrlKey || event.metaKey);
      if (isPauseHotkey || event.key === "6") {
        this.sim.isPaused ? this.sim.unpause() : this.sim.pause();
      }

      if (this.sim.hasHistory) {
        switch (event.key) {
          case "4":
          case ";":
            debugState.onJumpBack.value?.();
            break;
          case ",":
          case "5":
            if (this.sim.isPaused) this.sim.stepBack();
            break;
          case ".":
          case "7":
            if (this.sim.isPaused) this.sim.seek(this.sim.time.frame + 1);
            break;
          case "8":
          case "'":
            debugState.onJumpForward.value?.();
            break;
        }
      }
    };
    window.addEventListener("keydown", playbarHotkeys);

    // FPS calculation
    let fpsFrames = 0;
    let fpsLastTime = performance.now();

    const frame = () => {
      const stepStart = performance.now();
      const ticks = this.sim.step(stepStart - this.#now);

      // Always update frame number (even when paused/stepping)
      debugState.frameNumber.value = this.sim.time.frame;

      // Update performance metrics only when we actually ran simulation
      if (ticks > 0) {
        const stepEnd = performance.now();
        debugState.frameTime.value = stepEnd - stepStart;

        // Measure snapshot size when debug UI is visible (letterboxed mode)
        if (debugState.layoutMode.value === "letterboxed") {
          const bag = this.game.bag;
          if (bag) {
            debugState.snapshotSize.value = JSON.stringify(bag).length;
          }
        }

        // Calculate FPS every second
        fpsFrames++;
        const elapsed = stepEnd - fpsLastTime;
        if (elapsed >= 1000) {
          debugState.fps.value = Math.round((fpsFrames * 1000) / elapsed);
          fpsFrames = 0;
          fpsLastTime = stepEnd;
        }
      }

      // Update tape playback state
      debugState.isPlaying.value = !this.sim.isPaused;
      if (this.sim.hasHistory && debugState.tapeFrameCount.value > 0) {
        const currentFrame = this.sim.time.frame;
        const startFrame = debugState.tapeStartFrame.value;
        const frameCount = debugState.tapeFrameCount.value;
        const position = (currentFrame - startFrame) / frameCount;
        debugState.playheadPosition.value = Math.max(0, Math.min(1, position));

        // Auto-pause at end of tape
        if (
          this.sim.isReplaying &&
          !this.sim.isPaused &&
          currentFrame >= startFrame + frameCount
        ) {
          this.sim.pause();
        }
      }

      if (!this.sim.isPaused) {
        try {
          this.afterFrame.notify(this.sim.time.frame);
        } catch (e) {
          console.error("Error in afterFrame listeners:", e);
        }
      }
      this.#now = performance.now();
      this.#rafHandle = requestAnimationFrame(frame);
    };
    frame();

    this.#unsubscribe = () => {
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("keyup", handleKeyup);
      window.removeEventListener("mousemove", handleMousemove);
      window.removeEventListener("mousedown", handleMousedown);
      window.removeEventListener("mouseup", handleMouseup);
      window.removeEventListener("wheel", handleMousewheel);
      window.removeEventListener("keydown", playbarHotkeys);
      window.removeEventListener("touchstart", handleTouchstart);
      window.removeEventListener("touchend", handleTouchend);
      window.removeEventListener("touchmove", handleTouchmove);
      if (this.#rafHandle != null) {
        cancelAnimationFrame(this.#rafHandle);
      }
    };
  }

  /** Clean up wasm resources and event listeners */
  cleanup(): void {
    this.#unsubscribe?.();
    this.sim.unmount();
    this.beforeFrame.unsubscribeAll();
    this.afterFrame.unsubscribeAll();
    this.onHmr.unsubscribeAll();
    this.#debugUi?.unmount();
    this.#abortController.abort();
  }

  /**
   * Accept Hot Module Replacement when running in a vite dev server
   *
   * @example
   *
   * ```ts
   * import.meta.hot?.accept("./game", async (newModule) => {
   *   await app.acceptHmr(newModule?.game, {
   *   wasmUrl: monorepoWasmUrl,
   *   files: ["./game"],
   * });
   * ```
   */
  async acceptHmr(
    module: any,
    opts?: MountOptions & { files?: string[] },
  ): Promise<void> {
    const game = (module.game ?? module) as Bloop<any>;
    if (!game.hooks) {
      throw new Error(
        `HMR: missing game.hooks export on module: ${JSON.stringify(module)}`,
      );
    }

    // load session from the current sim
    this.sim.pause();
    const { sim } = await mount(game, {
      wasmUrl: new URL("/bloop-wasm/bloop.wasm", window.location.href),
      ...opts,
    });
    sim.cloneSession(this.sim);
    this.sim.unmount();
    this.sim = sim;
    this.game = game;

    // Trigger HMR flash and notify listeners
    triggerHmrFlash();
    this.onHmr.notify({ files: opts?.files ?? [] });
  }
}

function createListener<T extends any[]>(): {
  subscribe: (callback: (...args: T) => void) => UnsubscribeFn;
  notify: (...args: T) => void;
  unsubscribeAll: UnsubscribeFn;
} {
  const listeners = new Set<(...args: T) => void>();

  const subscribe = (callback: (...args: T) => void): (() => void) => {
    listeners.add(callback);

    // Return unsubscribe function
    return () => {
      listeners.delete(callback);
    };
  };

  const notify = (...args: T): void => {
    listeners.forEach((callback) => {
      callback(...args);
    });
  };

  return {
    subscribe,
    notify,
    unsubscribeAll: () => listeners.clear(),
  };
}

export type UnsubscribeFn = () => void;

export type HmrEvent = {
  files: string[];
};
