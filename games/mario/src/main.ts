import "./style.css";
import { Toodle } from "@bloopjs/toodle";
import { joinRollbackRoom, start } from "@bloopjs/web";
import { createChromaticAberrationEffect } from "./chromatic-aberration";
import { createDrawState, draw as drawFn } from "./draw";
import { game } from "./game";

// In dev, vite serves wasm from /bloop-wasm/. In prod, it's bundled at ./bloop.wasm
const wasmUrl = import.meta.env.DEV
  ? new URL("/bloop-wasm/bloop.wasm", window.location.href)
  : new URL("./bloop.wasm", import.meta.url);

let draw = drawFn;

const app = await start({
  game,
  engineWasmUrl: wasmUrl,
  startRecording: false,
  debugUi: {
    initiallyVisible: false,
  },
});

const canvas = app.canvas;
if (!canvas) throw new Error("No canvas element found");

const toodle = await Toodle.attach(canvas, {
  filter: "nearest",
  backend: "webgpu",
  limits: { textureArrayLayers: 5 },
});

toodle.clearColor = { r: 0.36, g: 0.58, b: 0.99, a: 1 }; // Mario sky blue

// Load sprites
const spriteUrl = (name: string) =>
  new URL(
    `${import.meta.env.BASE_URL}sprites/${name}.png`,
    window.location.href,
  );

await toodle.assets.registerBundle("main", {
  textures: {
    marioIdle: spriteUrl("MarioIdle"),
    marioWalk: spriteUrl("MarioWalk"),
    marioJump: spriteUrl("MarioJump"),
    marioSkid: spriteUrl("MarioSkid"),
  },
  autoLoad: true,
});

await toodle.assets.loadFont(
  "ComicNeue",
  new URL("https://toodle.gg/fonts/ComicNeue-Regular-msdf.json"),
);

const drawState = createDrawState(toodle);

requestAnimationFrame(function frame() {
  draw(app.game, toodle, drawState);
  requestAnimationFrame(frame);
});

let networkJoined = false;

// Debug: Press R to start recording mid-game
window.addEventListener("keydown", (e) => {
  if (e.key === "r" && !app.sim.isRecording) {
    app.sim.record();
    console.log("Started recording at frame", app.sim.time.frame);
  }
});

// Debug: Press G to toggle glitch effect
const glitchEffect = createChromaticAberrationEffect(toodle);
let glitchEnabled = false;
window.addEventListener("keydown", (e) => {
  if (e.key === "g") {
    glitchEnabled = !glitchEnabled;
    toodle.postprocess = glitchEnabled ? glitchEffect : null;
  }
});

game.system("title-input", {
  update({ bag, inputs }) {
    if (bag.phase !== "title") return;

    if ((inputs.keys.enter.down || inputs.mouse.left.down) && !networkJoined) {
      // Online multiplayer - wait for connection
      bag.mode = "online";
      bag.phase = "waiting";
      networkJoined = true;

      // Phase transitions are handled by the session-watcher system
      joinRollbackRoom("mario-demo", app, {
        onSessionStart() {
          bag.phase = "playing";

          app.sim.record(100_000);
          console.log(
            "Network session started, recording at frame",
            app.sim.time.frame,
          );
        },
        onSessionEnd() {
          networkJoined = false;
        },
      });
    }
  },
});

// HMR support
if (import.meta.hot) {
  import.meta.hot.accept("./game", async (newModule) => {
    if (newModule?.game) {
      await app.acceptHmr(newModule.game, { wasmUrl });
    }
  });

  import.meta.hot.accept("./draw", async (newModule) => {
    if (newModule?.draw && newModule?.createDrawState) {
      draw = newModule.draw;
    }
  });
}
