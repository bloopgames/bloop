import { type Bloop, mount, type Sim } from "@bloopjs/bloop";
import type { Key } from "@bloopjs/engine";
import { mouseButtonCodeToMouseButton } from "@bloopjs/engine";

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
};

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

  const app = new App(opts.sim, opts.game);
  return app;
}

export class App {
  #sim: Sim;
  game: Bloop<any>;
  /** RequestAnimationFrame handle for cancelling */
  #rafHandle: number | null = null;
  #unsubscribe: UnsubscribeFn | null = null;
  #now: number = performance.now();

  constructor(sim: Sim, game: Bloop<any>) {
    this.#sim = sim;
    this.game = game;

    this.subscribe();
  }

  get sim() {
    return this.#sim;
  }

  set sim(sim: Sim) {
    this.#sim = sim;
  }

  /** Subscribe to the browser events and start the render loop */
  subscribe() {
    const handleKeydown = (event: KeyboardEvent) => {
      console.log("got keydown", this.sim.id, event.code);
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

    const handleMousewheel = (event: WheelEvent) => {
      this.sim.emit.mousewheel(event.deltaX, event.deltaY);
    };
    window.addEventListener("wheel", handleMousewheel);

    const playbarHotkeys = (event: KeyboardEvent) => {
      const isPauseHotkey =
        event.key === "Enter" && (event.ctrlKey || event.metaKey);
      if (isPauseHotkey || event.key === "6") {
        this.sim.isPaused ? this.sim.unpause() : this.sim.pause();
        console.log("toggle pause", this.sim.isPaused, this.sim.id);
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
      this.#now = performance.now();
      this.#rafHandle = requestAnimationFrame(frame);
    };
    frame();

    this.#unsubscribe = () => {
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("keyup", handleKeyup);
      window.removeEventListener("mousemove", handleMousemove);
      window.removeEventListener("mousedown", handleMousedown);
      window.removeEventListener("wheel", handleMousewheel);
      window.removeEventListener("keydown", playbarHotkeys);
      if (this.#rafHandle != null) {
        cancelAnimationFrame(this.#rafHandle);
      }
    };
  }

  /** Clean up wasm resources and event listeners */
  cleanup() {
    this.#unsubscribe?.();
    this.sim.unmount();
  }
}

export type UnsubscribeFn = () => void;
