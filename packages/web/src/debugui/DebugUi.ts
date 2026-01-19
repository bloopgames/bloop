import { type ComponentChild, h, render } from "preact";
import { Root } from "./components/Root.tsx";
import { cycleLayout, type DebugState, debugState } from "./state.ts";
import { styles } from "./styles.ts";

export type DebugUiOptions = {
  /** Hotkey to toggle debug mode (default: 'Escape') */
  hotkey?: string;
  /** Initial debug visibility (default: false, or true if ?debug in URL) */
  initiallyVisible?: boolean;
  /** Container element to mount to (default: document.body) */
  container?: HTMLElement;
  /** External canvas element to use (for E2E testing with WebGPU in headless mode) */
  canvas?: HTMLCanvasElement;
};

export class DebugUi {
  #host: HTMLElement;
  #shadow: ShadowRoot;
  #canvas: HTMLCanvasElement;
  #mountPoint: HTMLElement;
  #cleanup: (() => void) | null = null;
  #hotkey: string;

  constructor(options: DebugUiOptions = {}) {
    this.#hotkey = options.hotkey ?? "Escape";
    const container = options.container ?? document.body;
    const initiallyVisible =
      options.initiallyVisible ??
      new URLSearchParams(window.location.search).has("debug");

    // Create host element
    this.#host = document.createElement("bloop-debug-ui");
    this.#host.style.cssText =
      "display:block;width:100%;height:100%;position:absolute;top:0;left:0;overflow:hidden;overscroll-behavior:none;";

    // Attach shadow DOM
    this.#shadow = this.#host.attachShadow({ mode: "open" });

    // Inject styles
    const styleEl = document.createElement("style");
    styleEl.textContent = styles;
    this.#shadow.appendChild(styleEl);

    // Create mount point
    this.#mountPoint = document.createElement("div");
    this.#mountPoint.id = "debug-root";
    this.#mountPoint.style.cssText = "width:100%;height:100%;";
    this.#shadow.appendChild(this.#mountPoint);

    // Initialize state
    debugState.layoutMode.value = initiallyVisible ? "letterboxed" : "off";

    // Use provided canvas or create a new one (game renders here)
    this.#canvas = options.canvas ?? document.createElement("canvas");

    // Render Preact app
    this.#render();

    // Append to container
    container.appendChild(this.#host);

    // Set up hotkey listener
    this.#cleanup = this.#setupHotkey();

    // Re-render when layoutMode changes
    debugState.layoutMode.subscribe(() => {
      this.#render();
    });
  }

  #render(): void {
    render(
      Root({ canvas: this.#canvas, hotkey: this.#hotkey }),
      this.#mountPoint,
    );
  }

  #setupHotkey(): () => void {
    const handler = (e: KeyboardEvent) => {
      if (e.key === this.#hotkey) {
        cycleLayout();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }

  /** The canvas element for game rendering */
  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  /** Access to state signals for external updates */
  get state(): DebugState {
    return debugState;
  }

  /** Whether the debug panel is currently visible */
  get isVisible(): boolean {
    return debugState.isVisible.value;
  }

  set isVisible(value: boolean) {
    debugState.layoutMode.value = value ? "letterboxed" : "off";
  }

  unmount(): void {
    this.#cleanup?.();
    render(null, this.#mountPoint);
    this.#host.remove();
  }
}
