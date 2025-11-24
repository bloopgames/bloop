import "./style.css";
import { Util } from "@bloopjs/bloop";
import { Toodle } from "@bloopjs/toodle";
import { start } from "@bloopjs/web";
import { draw } from "./draw";
import { game } from "./game";

// 1. Set up simulation
const app = await start({
  game,
  // temp - use a monorepo dev wasm url instead of cdn
  engineWasmUrl: new URL("/bloop-wasm/bloop.wasm", window.location.href),
});

// 2. Set up rendering
const canvas = document.querySelector("canvas");
Util.assert(canvas instanceof HTMLCanvasElement, "Canvas element not found");
const toodle = await Toodle.attach(canvas);
requestAnimationFrame(function frame() {
  draw(app.game, toodle);
  requestAnimationFrame(frame);
});

// 3. Set up HMR

// import.meta.hot?.accept("./game", async (newModule) => {
//   sim = await handleUpdate(newModule, sim, {
//     wasmUrl: monorepoWasmUrl,
//   });
//   unsubscribe();
//   unsubscribe = connect(sim);
// });
