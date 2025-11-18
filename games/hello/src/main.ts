import "./style.css";
import { mount } from "@bloopjs/bloop";
import { game } from "./game";

const { runtime } = await mount(game);

let now = performance.now();

requestAnimationFrame(function loop() {
  runtime.step(performance.now() - now);
  now = performance.now();
  requestAnimationFrame(loop);
});
