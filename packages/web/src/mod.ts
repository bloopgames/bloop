import { type Runtime } from "@bloopjs/bloop";
import { type Key, mouseButtonCodeToMouseButton } from "@bloopjs/engine";

export function connect(runtime: Runtime) {
  let isPaused = true;
  let now = performance.now();
  let frameHandle: number = -1;

  const handleKeydown = (event: KeyboardEvent) => {
    runtime.emit.keydown(event.key as Key);
  };
  window.addEventListener("keydown", handleKeydown);

  const handleKeyup = (event: KeyboardEvent) => {
    runtime.emit.keyup(event.key as Key);
  };
  window.addEventListener("keyup", handleKeyup);

  const handleMousemove = (event: MouseEvent) => {
    runtime.emit.mousemove(event.clientX, event.clientY);
  };
  window.addEventListener("mousemove", handleMousemove);

  const handleMousedown = (event: MouseEvent) => {
    runtime.emit.mousedown(mouseButtonCodeToMouseButton(event.button + 1));
  };
  window.addEventListener("mousedown", handleMousedown);

  const handleMousewheel = (event: WheelEvent) => {
    runtime.emit.mousewheel(event.deltaX, event.deltaY);
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
          runtime.stepBack();
          break;
        case ".":
        case "7":
          runtime.step();
          break;
      }
    }
  };
  window.addEventListener("keydown", playbarHotkeys);

  function frame() {
    if (!isPaused) {
      runtime.step(performance.now() - now);
    }
    now = performance.now();
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
