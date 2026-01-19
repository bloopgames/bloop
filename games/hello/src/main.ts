import "./style.css";
import { Toodle } from "@bloopjs/toodle";
import { start } from "@bloopjs/web";
import { draw as drawFn, loadAssets } from "./draw";
import { game } from "./game";

// For E2E testing, create canvas in light DOM to avoid WebGPU+Shadow DOM issues
const isE2e = new URLSearchParams(window.location.search).has("e2e");
const e2eCanvas = isE2e ? document.createElement("canvas") : undefined;
if (e2eCanvas) {
  // z-index:1 ensures canvas renders above the Shadow DOM debug UI container
  e2eCanvas.style.cssText =
    "position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;";
  document.body.appendChild(e2eCanvas);
}

// 1. Set up simulation
const app = await start({
  game,
  debugUi: isE2e ? { canvas: e2eCanvas, initiallyVisible: false } : true,
});

// 2. Set up rendering
let draw = drawFn;
const canvas = app.canvas;
if (!canvas) throw new Error("Canvas element not found");
const toodle = await Toodle.attach(canvas);
await loadAssets(app.game, toodle);

requestAnimationFrame(function frame() {
  draw(app.game, toodle);
  requestAnimationFrame(frame);
});

// 3. Set up Hot Module Replacement (HMR)
import.meta.hot?.accept("./game", async (newModule) => {
  await app.acceptHmr(newModule?.game);
});
import.meta.hot?.accept("./draw", async (newModule) => {
  draw = newModule?.draw;
});
