import "./style.css";
import { Toodle } from "@bloopjs/toodle";
import { start } from "@bloopjs/web";
import { createDrawState, draw } from "./draw";
import { game } from "./game";

const wasmUrl = import.meta.env.DEV
  ? new URL("/bloop-wasm/bloop.wasm", window.location.href)
  : new URL("./bloop.wasm", import.meta.url);

const statusEl = document.getElementById("status")!;
const inputEl = document.getElementById("tape-input") as HTMLInputElement;

inputEl.addEventListener("change", async () => {
  const file = inputEl.files?.[0];
  if (!file) return;

  statusEl.textContent = "Loading tape...";

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());

    // Start the app with recording disabled (we're loading a tape)
    const app = await start({
      game,
      engineWasmUrl: wasmUrl,
      debugUi: true,
      startRecording: false,
    });

    // Load the tape and pause playback
    app.loadTape(bytes);
    app.sim.pause();

    const canvas = app.canvas;
    if (!canvas) throw new Error("No canvas element found");

    const toodle = await Toodle.attach(canvas, {
      filter: "nearest",
      backend: "webgpu",
      limits: { textureArrayLayers: 5 },
    });

    toodle.clearColor = { r: 0.36, g: 0.58, b: 0.99, a: 1 };

    // Load sprites
    await toodle.assets.registerBundle("main", {
      textures: {
        marioWalk: new URL(
          `${import.meta.env.BASE_URL}sprites/MarioWalk.png`,
          window.location.href,
        ),
      },
      autoLoad: true,
    });

    await toodle.assets.loadFont(
      "ComicNeue",
      new URL("https://toodle.gg/fonts/ComicNeue-Regular-msdf.json"),
    );

    const drawState = createDrawState(toodle);

    requestAnimationFrame(function frame() {
      draw(app.game, toodle, drawState);
      requestAnimationFrame(frame);
    });

    statusEl.textContent = `Loaded tape: ${file.name}. Press Escape to toggle debug UI.`;

    // Hide the file input and show the game
    inputEl.style.display = "none";
    document.querySelector(".container")!.remove();
  } catch (err) {
    statusEl.textContent = `Error loading tape: ${err}`;
    console.error(err);
  }
});
