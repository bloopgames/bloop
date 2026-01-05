import "./style.css";
import { Toodle } from "@bloopjs/toodle";
import { start } from "@bloopjs/web";
import { createDrawState, draw } from "./draw";
import { game } from "./game";

const wasmUrl = import.meta.env.DEV
  ? new URL("/bloop-wasm/bloop.wasm", window.location.href)
  : new URL("./bloop.wasm", import.meta.url);

const DB_NAME = "mario-tapes";
const STORE_NAME = "tapes";
const TAPE_KEY = "last";

const statusEl = document.getElementById("status")!;
const inputEl = document.getElementById("tape-input") as HTMLInputElement;
const replayBtn = document.getElementById("replay-last") as HTMLButtonElement;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
  });
}

async function loadTape(bytes: Uint8Array, fileName: string) {
  statusEl.textContent = "Loading tape...";

  // Start the app with recording disabled (we're loading a tape)
  const app = await start({
    game,
    wasmUrl: wasmUrl,
    debugUi: true,
    startRecording: false,
  });

  import.meta.hot?.accept("./game", async (newModule) => {
    await app.acceptHmr(newModule?.game, {
      wasmUrl,
      files: ["./game"],
    });
  });

  // Load the tape and pause playback
  app.loadTape(bytes);
  app.sim.pause();

  const canvas = app.canvas;
  if (!canvas) throw new Error("No canvas element found");

  const toodle = await Toodle.attach(canvas, {
    filter: "nearest",
    backend: "webgpu",
    limits: { textureArrayLayers: 5 },
  });

  toodle.clearColor = { r: 0.36, g: 0.58, b: 0.99, a: 1 };

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
    "Roboto",
    new URL("https://toodle.gg/fonts/Roboto-Regular-msdf.json"),
  );

  const drawState = createDrawState(toodle);

  requestAnimationFrame(function frame() {
    draw(app.game, toodle, drawState);
    requestAnimationFrame(frame);
  });

  statusEl.textContent = `Loaded tape: ${fileName}. Press Escape to toggle debug UI.`;

  // Hide the file input and show the game
  inputEl.style.display = "none";
  replayBtn.style.display = "none";
  document.querySelector(".container")!.remove();
}

async function saveTapeToStorage(
  bytes: Uint8Array,
  fileName: string,
): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ bytes, fileName }, TAPE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadTapeFromStorage(): Promise<{
  bytes: Uint8Array;
  fileName: string;
} | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(TAPE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

// Check for saved tape on page load
loadTapeFromStorage().then((savedTape) => {
  if (savedTape) {
    replayBtn.style.display = "block";
    replayBtn.textContent = `Replay last tape (${savedTape.fileName})`;
  }
});

replayBtn.addEventListener("click", async () => {
  const saved = await loadTapeFromStorage();
  if (!saved) {
    statusEl.textContent = "No saved tape found";
    return;
  }

  try {
    await loadTape(saved.bytes, saved.fileName);
  } catch (err) {
    statusEl.textContent = `Error loading tape: ${err}`;
    console.error(err);
  }
});

inputEl.addEventListener("change", async () => {
  const file = inputEl.files?.[0];
  if (!file) return;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await saveTapeToStorage(bytes, file.name);
    await loadTape(bytes, file.name);
  } catch (err) {
    statusEl.textContent = `Error loading tape: ${err}`;
    console.error(err);
  }
});
