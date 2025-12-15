import "./style.css";
import { Toodle } from "@bloopjs/toodle";
import { joinRollbackRoom, start } from "@bloopjs/web";
import { createDrawState, draw } from "./draw";
import { game, resetGameState } from "./game";

// In dev, vite serves wasm from /bloop-wasm/. In prod, it's bundled at ./bloop.wasm
const wasmUrl = import.meta.env.DEV
  ? new URL("/bloop-wasm/bloop.wasm", window.location.href)
  : new URL("./bloop.wasm", import.meta.url);

async function main() {
  const app = await start({
    game,
    engineWasmUrl: wasmUrl,
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
  await toodle.assets.registerBundle("main", {
    textures: {
      marioWalk: new URL(
        `${import.meta.env.BASE_URL}sprites/MarioWalk.png`,
        window.location.href,
      ),
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

  game.system("title-input", {
    keydown({ bag, event }) {
      if (bag.phase !== "title") return;

      // todo - do this in the game logic to keep tapes working for online sessions
      if (event.key === "Enter" && !networkJoined) {
        // Online multiplayer - wait for connection
        bag.mode = "online";
        bag.phase = "waiting";
        networkJoined = true;

        // Phase transitions are handled by the session-watcher system
        joinRollbackRoom("mario-demo", app, {
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
  }
}

main();
