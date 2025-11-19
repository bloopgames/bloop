import "./style.css";
import { mount, Util } from "@bloopjs/bloop";
import { type Key, mouseButtonCodeToMouseButton } from "@bloopjs/engine";
import { game } from "./game";

let { runtime } = await mount(game);

import.meta.hot?.accept("./game", async (newModule) => {
  Util.assert(
    newModule?.game,
    `HMR: missing game export on module: ${JSON.stringify(newModule)}`,
  );

  const runtime1 = runtime;
  const result = await mount(newModule.game as any);
  runtime = result.runtime;

  runtime.restore(runtime1.snapshot());
  runtime1.unmount();
});

let now = performance.now();
let isPaused = true;

window.addEventListener("keydown", (event) => {
  runtime.emit.keydown(event.key as Key);
});

window.addEventListener("keyup", (event) => {
  runtime.emit.keyup(event.key as Key);
});

window.addEventListener("mousemove", (event) => {
  runtime.emit.mousemove(event.clientX, event.clientY);
});

window.addEventListener("mousedown", (event) => {
  runtime.emit.mousedown(mouseButtonCodeToMouseButton(event.button + 1));
});

window.addEventListener("wheel", (event) => {
  runtime.emit.mousewheel(event.deltaX, event.deltaY);
});

window.addEventListener("keydown", (event) => {
  const isPauseHotkey =
    event.key === "Enter" && (event.ctrlKey || event.metaKey);
  if (isPauseHotkey || event.key === "6") {
    isPaused = !isPaused;
  }

  if (isPaused) {
    switch (event.key) {
      case ",":
      case "5":
        runtime.stepBack();
        break;
      case ".":
      case "7":
        runtime.step();
        break;
    }
  }
});

requestAnimationFrame(function loop() {
  if (!isPaused) {
    runtime.step(performance.now() - now);
  }
  now = performance.now();
  requestAnimationFrame(loop);
});
