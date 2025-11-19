import "./style.css";
import { mount } from "@bloopjs/bloop";
import { type Key, mouseButtonCodeToMouseButton } from "@bloopjs/engine";
import { game } from "./game";

const { runtime } = await mount(game);

let now = performance.now();
let isPaused = true;

const originalConsole = window.console;

const noop = () => {};

const stubConsole = Object.fromEntries(
  Object.keys(originalConsole).map((key) => [key, noop]),
) as unknown as Console;

function muteConsole() {
  (window.console as unknown as Console) = stubConsole;
}

function unmuteConsole() {
  (window.console as unknown as Console) = originalConsole;
}

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
        muteConsole();
        runtime.stepBack();
        unmuteConsole();
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
