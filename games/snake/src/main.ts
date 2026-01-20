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
