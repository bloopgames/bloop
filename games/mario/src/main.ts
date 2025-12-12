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
    startRecording: false,
    debugUi: true,
  });

  const canvas = document.querySelector("canvas");
  if (!canvas) throw new Error("No canvas element found");

  const toodle = await Toodle.attach(canvas, { filter: "nearest" });

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

  function handleKeyDown(e: KeyboardEvent) {
    const { bag } = game;

    if (bag.phase !== "title") return;

    if (e.key === " ") {
      // Local multiplayer - start immediately
      bag.mode = "local";
      bag.phase = "playing";
      resetGameState(bag);
    } else if (e.key === "Enter" && !networkJoined) {
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
  }

  window.addEventListener("keydown", handleKeyDown);

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
