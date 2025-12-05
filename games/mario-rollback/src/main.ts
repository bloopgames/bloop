import "./style.css";
import { Toodle } from "@bloopjs/toodle";
import { start } from "@bloopjs/web";
import { createDrawState, draw } from "./draw";
import { game } from "./game";

const monorepoWasmUrl = new URL("/bloop-wasm/bloop.wasm", window.location.href);

async function main() {
  const app = await start({
    game,
    engineWasmUrl: monorepoWasmUrl,
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
        await app.acceptHmr(newModule.game, { wasmUrl: monorepoWasmUrl });
      }
    });
  }
}

main();
