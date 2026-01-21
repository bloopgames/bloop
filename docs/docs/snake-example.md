---
sidebar_position: 3
---

# Bloop + Your Game

Bloop is designed to be easy to integrate into existing games using TypeScript.

This sample shows the steps you would need to take to add bloop simulation systems to a minimal Snake game in vanilla TypeScript.

## Snake in Vanilla TS

```ts
// Set some constants
const TILE = 20,
  WIDTH = 10,
  HEIGHT = 6,
  MOVE_INTERVAL = 500;

// Set up game state
const snake = [{ x: 5, y: 5 }];
let direction = { x: 1, y: 0 };
let food = { x: 2, y: 2 };
let gameOver = false;
let lastMove = performance.now();

// Listen for browser inputs
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp") direction = { x: 0, y: -1 };
  if (e.key === "ArrowDown") direction = { x: 0, y: 1 };
  if (e.key === "ArrowLeft") direction = { x: -1, y: 0 };
  if (e.key === "ArrowRight") direction = { x: 1, y: 0 };
});

// Get a surface to draw on
const ctx = document.querySelector("canvas")?.getContext("2d");

// Run the game loop
function loop() {
  if (!ctx) throw new Error("Canvas not found");
  if (gameOver) return;

  const now = performance.now();
  if (now - lastMove >= MOVE_INTERVAL) {
    lastMove = now;

    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

    if (
      head.x < 0 ||
      head.x >= WIDTH ||
      head.y < 0 ||
      head.y >= HEIGHT ||
      snake.some((s) => s.x === head.x && s.y === head.y)
    ) {
      gameOver = true;
      alert("Game Over!");
      return;
    }

    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      food = {
        x: Math.floor(Math.random() * WIDTH),
        y: Math.floor(Math.random() * HEIGHT),
      };
    } else {
      snake.pop();
    }
  }

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, TILE * WIDTH, TILE * HEIGHT);
  ctx.fillStyle = "#0f0";
  for (const s of snake) {
    ctx.fillRect(s.x * TILE, s.y * TILE, TILE - 1, TILE - 1);
  }
  ctx.fillStyle = "#f00";
  ctx.fillRect(food.x * TILE, food.y * TILE, TILE - 1, TILE - 1);

  requestAnimationFrame(loop);
}
loop();
```

## Snake with bloop

Here's the same game using bloop for simulation. Note that game logic would typically be in a separate `game.ts` file for hot reloading and unit testing, but we've combined it here for easy comparison.

```ts
import { Bloop } from "@bloopjs/bloop";
import { start } from "@bloopjs/web";

// Get a surface to draw on
const { canvas, ctx } = getCanvasAndContext();

// Set some constants
const TILE = 16,
  WIDTH = 8,
  HEIGHT = 8,
  MOVE_INTERVAL = 500;

// CHANGED Move game state into an object that bloop knows about
const game = Bloop.create({
  bag: {
    snake: [{ x: 2, y: 5 }],
    direction: { x: 1, y: 0 },
    food: { x: 2, y: 2 },
    gameOver: false,
    lastMove: 0,
  },
});

// CHANGED Move state updates to rewindable bloop systems
game.system("input", {
  keydown({ event, bag }) {
    if (event.key === "ArrowUp") bag.direction = { x: 0, y: -1 };
    if (event.key === "ArrowDown") bag.direction = { x: 0, y: 1 };
    if (event.key === "ArrowLeft") bag.direction = { x: -1, y: 0 };
    if (event.key === "ArrowRight") bag.direction = { x: 1, y: 0 };
  },
});
game.system("update", {
  update({ bag, time, rand }) {
    if (time.time - bag.lastMove < MOVE_INTERVAL / 1000) return;
    if (bag.gameOver) return;
    bag.lastMove = time.time;

    const { snake, direction } = bag;
    const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

    if (
      head.x < 0 ||
      head.x >= WIDTH ||
      head.y < 0 ||
      head.y >= HEIGHT ||
      snake.some((s) => s.x === head.x && s.y === head.y)
    ) {
      bag.gameOver = true;
      alert("Game Over!");
      return;
    }

    snake.unshift(head);
    if (head.x === bag.food.x && head.y === bag.food.y) {
      bag.food = {
        x: rand.int(0, WIDTH),
        y: rand.int(0, HEIGHT),
      };
    } else {
      snake.pop();
    }
  },
});

// CHANGED register a simulation loop separately from your rendering loop
// note: you can also manually step the simulation if you want to control timing
await start({ game, debugUi: true, canvas });

// Draw the game state - now just reads from game.bag, decoupled from simulation
function loop() {
  if (game.bag.gameOver) return;

  const { snake, food } = game.bag;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, TILE * WIDTH, TILE * HEIGHT);
  ctx.fillStyle = "#0f0";
  for (const s of snake) {
    ctx.fillRect(s.x * TILE, s.y * TILE, TILE - 1, TILE - 1);
  }
  ctx.fillStyle = "#f00";
  ctx.fillRect(food.x * TILE, food.y * TILE, TILE - 1, TILE - 1);

  requestAnimationFrame(loop);
}
loop();

function getCanvasAndContext() {
  const canvas = document.querySelector("canvas");
  const ctx = canvas?.getContext("2d");

  if (!canvas || !ctx) {
    throw new Error("Canvas or context not found");
  }
  return { canvas, ctx };
}
```

## What we changed

| Vanilla JS | Bloop |
|------------|-------|
| Local variables | `bag` properties |
| `addEventListener("keydown")` | `keydown` system handler |
| Logic in RAF loop | `update` system handler |
| `performance.now()` timing | `time.dt` (delta time in seconds) |
| `Math.random()` | `rand.int()` (deterministic for replay) |
| Rendering mixed with update | Rendering decoupled (reads from `game.bag`) |

## What You Get

By moving your state to `bag` and your logic to systems, you automatically get:

- **Rewind/replay** - scrub through gameplay with the debug UI
- **Deterministic recording** - record and replay gameplay exactly
- **Hot reload** - change code without losing game state
- **Easy Rollback** - adding rollback netcode is 10 lines
- **Testable without browser** - unit test your game logic headlessly
- **Portability** - game logic can be easily ported to mobile, consoles, native desktop