import "./style.css";
import { Toodle } from "@bloopjs/toodle";
import { start } from "@bloopjs/web";
import { draw } from "./draw";
import { game } from "./game";

// temp - use a monorepo dev wasm url instead of cdn
const monorepoWasmUrl = new URL("/bloop-wasm/bloop.wasm", window.location.href);

// 1. Set up simulation
const app = await start({
  game,
  engineWasmUrl: monorepoWasmUrl,
});

// 2. Set up rendering
const canvas = document.querySelector("canvas");
if (!canvas) throw new Error("Canvas element not found");
const toodle = await Toodle.attach(canvas);
requestAnimationFrame(function frame() {
  draw(app.game, toodle);
  requestAnimationFrame(frame);
});

// 3. Set up Hot Module Replacement (HMR)
import.meta.hot?.accept("./game", async (newModule) => {
  await app.acceptHmr(newModule?.game, {
    wasmUrl: monorepoWasmUrl,
  });
});
