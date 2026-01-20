// Get a surface to draw on
const { canvas, ctx } = getCanvasAndContext();

// Set some constants
const TILE = 16,
  WIDTH = 8,
  HEIGHT = 8,
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

// Run the game loop
function loop() {
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

function getCanvasAndContext() {
  const canvas = document.querySelector("canvas");
  const ctx = canvas?.getContext("2d");

  if (!canvas || !ctx) {
    throw new Error("Canvas or context not found");
  }
  return { canvas, ctx };
}
