import "./style.css";
import { handleUpdate, mount, Util } from "@bloopjs/bloop";
import { Colors, Toodle } from "@bloopjs/toodle";
import { connect } from "@bloopjs/web";
import { game } from "./game";

const canvas = document.querySelector("canvas");
Util.assert(canvas instanceof HTMLCanvasElement, "Canvas element not found");
const toodle = await Toodle.attach(canvas);

const monorepoWasmUrl = new URL("/bloop-wasm/bloop.wasm", window.location.href);

let { sim } = await mount({
  hooks: game.hooks,
  wasmUrl: monorepoWasmUrl,
});
let unsubscribe = connect(sim);

requestAnimationFrame(function frame() {
  const bag = game.context.bag;
  toodle.startFrame();
  toodle.draw(
    toodle.shapes.Circle({
      idealSize: { width: 100, height: 100 },
      scale: bag.scale,
      position: { x: bag.x, y: bag.y },
      color: Colors.web.rebeccaPurple,
    }),
  );
  toodle.endFrame();
  requestAnimationFrame(frame);
});

import.meta.hot?.accept("./game", async (newModule) => {
  sim = await handleUpdate(newModule, sim, {
    wasmUrl: monorepoWasmUrl,
  });
  unsubscribe();
  unsubscribe = connect(sim);
});
