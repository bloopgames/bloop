import { type Sim } from "@bloopjs/bloop";
import { type Key, mouseButtonCodeToMouseButton } from "@bloopjs/engine";

export type UnsubscribeFn = () => void;

export function connect(sim: Sim, draw?: () => void): UnsubscribeFn {
  let isPaused = false;
  let now = performance.now();
  let frameHandle: number = -1;

  const handleKeydown = (event: KeyboardEvent) => {
    console.log("got a keydown", event.key);
    sim.emit.keydown(event.code as Key);
  };
  window.addEventListener("keydown", handleKeydown);

  const handleKeyup = (event: KeyboardEvent) => {
    sim.emit.keyup(event.code as Key);
  };
  window.addEventListener("keyup", handleKeyup);

  const handleMousemove = (event: MouseEvent) => {
    sim.emit.mousemove(event.clientX, event.clientY);
  };
  window.addEventListener("mousemove", handleMousemove);

  const handleMousedown = (event: MouseEvent) => {
    sim.emit.mousedown(mouseButtonCodeToMouseButton(event.button + 1));
  };
  window.addEventListener("mousedown", handleMousedown);

  const handleMousewheel = (event: WheelEvent) => {
    sim.emit.mousewheel(event.deltaX, event.deltaY);
  };
  window.addEventListener("wheel", handleMousewheel);

  const playbarHotkeys = (event: KeyboardEvent) => {
    const isPauseHotkey =
      event.key === "Enter" && (event.ctrlKey || event.metaKey);
    if (isPauseHotkey || event.key === "6") {
      isPaused = !isPaused;
    }

    if (isPaused) {
      switch (event.key) {
        case ",":
        case "5":
          sim.stepBack();
          break;
        case ".":
        case "7":
          sim.step();
          break;
      }
    }
  };
  window.addEventListener("keydown", playbarHotkeys);

  function frame() {
    if (!isPaused) {
      sim.step(performance.now() - now);
    }
    now = performance.now();
    draw?.();
    frameHandle = requestAnimationFrame(frame);
  }
  frame();

  return () => {
    window.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("keyup", handleKeyup);
    window.removeEventListener("mousemove", handleMousemove);
    window.removeEventListener("mousedown", handleMousedown);
    window.removeEventListener("wheel", handleMousewheel);
    window.removeEventListener("keydown", playbarHotkeys);
    cancelAnimationFrame(frameHandle);
  };
}
