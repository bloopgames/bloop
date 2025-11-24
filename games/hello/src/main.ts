import "./style.css";
import { handleUpdate, mount, Util } from "@bloopjs/bloop";
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
import.meta.hot?.accept("./game", async (newModule) => {
  app.sim.pause();
  Util.assert(
    newModule?.game,
    `HMR: missing game export on module: ${JSON.stringify(newModule)}`,
  );

  const { sim } = await mount({
    hooks: (newModule.game as any).hooks,
    wasmUrl: new URL("/bloop-wasm/bloop.wasm", window.location.href),
  });
  console.log("mounted sim", sim.id);

  const tape = app.sim.saveTape();
  const snapshot = app.sim.snapshot();

  sim.loadTape(tape);
  sim.restore(snapshot);
  app.sim.unmount();
  app.sim = sim;
  app.game = newModule.game;
  app.game.bag.simId = sim.id;

  newModule.game.context.bag.scale = 40;

  console.log(app.sim.time.frame, sim.time.frame);
});
