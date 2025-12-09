import "./style.css";
import { Toodle } from "@bloop.gg/toodle";
import { start } from "@bloopjs/web";
import { createDrawState, draw } from "./draw";
import { game } from "./game";

// In dev, vite serves wasm from /bloop-wasm/. In prod, it's bundled at ./bloop.wasm
const wasmUrl = import.meta.env.DEV
  ? new URL("/bloop-wasm/bloop.wasm", window.location.href)
  : new URL("./bloop.wasm", import.meta.url);

async function main() {
  const app = await start({
    game,
    engineWasmUrl: wasmUrl,
    startRecording: false,
  });

  const canvas = document.querySelector("canvas");
  if (!canvas) throw new Error("No canvas element found");

  const toodle = await Toodle.attach(canvas, { filter: "nearest" });

  toodle.clearColor = { r: 0.36, g: 0.58, b: 0.99, a: 1 }; // Mario sky blue

  // Load sprites
  await toodle.assets.loadTextures({
    marioWalk: new URL("/sprites/MarioWalk.png", window.location.href),
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

  // HMR support
  if (import.meta.hot) {
    import.meta.hot.accept("./game", async (newModule) => {
      if (newModule?.game) {
        await app.acceptHmr(newModule.game, { wasmUrl });
      }
    });
  }
}

main();
