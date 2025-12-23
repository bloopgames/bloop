import "./style.css";
import { unwrap } from "@bloopjs/bloop";
import { joinRollbackRoom, logger, start } from "@bloopjs/web";
import { game } from "./game";
import { createRenderer } from "./render";

// In dev, vite serves wasm from /bloop-wasm/. In prod, it's bundled at ./bloop.wasm
const wasmUrl = import.meta.env.DEV
  ? new URL("/bloop-wasm/bloop.wasm", window.location.href)
  : new URL("./bloop.wasm", import.meta.url);

const app = await start({
  game,
  wasmUrl: wasmUrl,
  startRecording: false,
  debugUi: {
    container: unwrap(
      document.getElementById("app"),
      "expected #app container to exist",
    ),
  },
});

// Get canvas from debug UI and set up renderer
const canvas = unwrap(app.canvas, "expected canvas from debug UI");
// Use a getter so HMR can replace the game and renderer stays connected
const render = createRenderer(canvas, () => app.game.bag);

// Join rollback room
joinRollbackRoom("nope", app);

// Game-specific netcode logger
game.system("netcode logger", {
  update({ players }) {
    if (players[0]!.mouse.left.down) {
      logger.log({
        source: "local",
        label: "[PlayerID=0] Mouse Click",
      });
    }

    if (players[1]!.mouse.left.down) {
      logger.log({
        source: "local",
        label: "[PlayerID=1] Mouse Click",
      });
    }
  },
});

// Render game after each frame
app.afterFrame.subscribe(() => {
  render();
});

// Initial render
render();
