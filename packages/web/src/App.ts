import { type Bloop, type MountOpts, mount, type Sim } from "@bloopjs/bloop";
import type { Key } from "@bloopjs/engine";
import { mouseButtonCodeToMouseButton } from "@bloopjs/engine";
import {
  joinRoom as joinRoomInternal,
  type RoomEvents,
} from "./netcode/broker";
import { logger } from "./netcode/logs.ts";
import { DebugUi, type DebugUiOptions } from "./debugui/mod.ts";

export type StartOptions = {
  /** A bloop game instance */
  game: Bloop<any>;
  /** A pre-mounted sim instance, defaults to mount with default options */
  sim?: Sim;
  /** An override url to use to fetch the engine wasm */
  engineWasmUrl?: URL;
  /** Whether the sim should pause before running the first frame, defaults to false */
  startPaused?: boolean;
  /** Whether the sim should be recording to tape from initialization, defaults to true */
  startRecording?: boolean;
  /** URL for the WebRTC signaling broker (e.g. "wss://broker.example.com/ws") */
  brokerUrl?: string;
  /** Enable debug UI with optional configuration */
  debugUi?: boolean | DebugUiOptions;
};

const DEFAULT_BROKER_URL = "wss://webrtc-divine-glade-8064.fly.dev/ws";

/** Start a bloop game on the web */
export async function start(opts: StartOptions): Promise<App> {
  if (!opts.sim) {
    const { sim } = await mount({
      hooks: opts.game.hooks,
      startRecording: opts.startRecording ?? true,
      wasmUrl: opts.engineWasmUrl,
    });
    opts.sim = sim;
  }

  const debugOpts = opts.debugUi
    ? typeof opts.debugUi === "boolean"
      ? {}
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
      logger.matchFrame = this.#sim.wasm.get_match_frame();
      this.beforeFrame.notify(frame);
    };

    this.subscribe();
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

  /** Event listeners for before a frame is processed */
  beforeFrame: ReturnType<typeof createListener> = createListener<[number]>();
  /** Event listeners for after a frame is processed */
  afterFrame: ReturnType<typeof createListener> = createListener<[number]>();

  /** Subscribe to the browser events and start the render loop */
  subscribe(): void {
    const handleKeydown = (event: KeyboardEvent) => {
      this.sim.emit.keydown(event.code as Key);
    };
    window.addEventListener("keydown", handleKeydown);

    const handleKeyup = (event: KeyboardEvent) => {
      this.sim.emit.keyup(event.code as Key);
    };
    window.addEventListener("keyup", handleKeyup);

    const handleMousemove = (event: MouseEvent) => {
      this.sim.emit.mousemove(event.clientX, event.clientY);
    };
    window.addEventListener("mousemove", handleMousemove);

    const handleMousedown = (event: MouseEvent) => {
      this.sim.emit.mousedown(mouseButtonCodeToMouseButton(event.button + 1));
    };
    window.addEventListener("mousedown", handleMousedown);

    const handleMouseup = (event: MouseEvent) => {
      this.sim.emit.mouseup(mouseButtonCodeToMouseButton(event.button + 1));
    };
    window.addEventListener("mouseup", handleMouseup);

    const handleMousewheel = (event: WheelEvent) => {
      this.sim.emit.mousewheel(event.deltaX, event.deltaY);
    };
    window.addEventListener("wheel", handleMousewheel);

    // Touch events for mobile support
    const handleTouchstart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) {
        this.sim.emit.mousemove(touch.clientX, touch.clientY);
        this.sim.emit.mousedown("Left");
      }
    };
    window.addEventListener("touchstart", handleTouchstart);

    const handleTouchend = () => {
      this.sim.emit.mouseup("Left");
    };
    window.addEventListener("touchend", handleTouchend);

    const handleTouchmove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) {
        this.sim.emit.mousemove(touch.clientX, touch.clientY);
      }
    };
    window.addEventListener("touchmove", handleTouchmove);

    const playbarHotkeys = (event: KeyboardEvent) => {
      const isPauseHotkey =
        event.key === "Enter" && (event.ctrlKey || event.metaKey);
      if (isPauseHotkey || event.key === "6") {
        this.sim.isPaused ? this.sim.unpause() : this.sim.pause();
      }

      if (this.sim.isPaused) {
        switch (event.key) {
          case ",":
          case "5":
            this.sim.stepBack();
            break;
          case ".":
          case "7":
            this.sim.step();
            break;
        }
      }
    };
    window.addEventListener("keydown", playbarHotkeys);

    const frame = () => {
      this.sim.step(performance.now() - this.#now);
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
    this.#debugUi?.unmount();
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
   * });
   * ```
   */
  async acceptHmr(module: any, opts?: Partial<MountOpts>): Promise<void> {
    const game = (module.game ?? module) as Bloop<any>;
    if (!game.hooks) {
      throw new Error(
        `HMR: missing game.hooks export on module: ${JSON.stringify(module)}`,
      );
    }

    // load session from the current sim
    this.sim.pause();
    const { sim } = await mount({
      hooks: game.hooks,
      wasmUrl: new URL("/bloop-wasm/bloop.wasm", window.location.href),
      ...opts,
    });
    sim.cloneSession(this.sim);
    this.sim.unmount();
    this.sim = sim;
    this.game = game;
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
