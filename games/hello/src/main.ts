import "./style.css";
import { Toodle } from "@bloopjs/toodle";
import { start } from "@bloopjs/web";
import { draw as drawFn } from "./draw";
import { game } from "./game";

// 1. Set up simulation
const app = await start({
  game,
});

// 2. Set up rendering
let draw = drawFn;
const canvas = document.querySelector("canvas");
if (!canvas) throw new Error("Canvas element not found");
const toodle = await Toodle.attach(canvas);
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
