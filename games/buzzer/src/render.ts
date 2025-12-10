import type { Bloop } from "@bloopjs/bloop";
import type { GamePhase } from "./game";

type GameBag = {
  screenWidth: number;
  screenHeight: number;
  blockX: number;
  phase: GamePhase;
  player1Score: number;
  player2Score: number;
  winner: null | 1 | 2;
  remoteCursorX: number;
  remoteCursorY: number;
};

const BG_COLORS: Record<GamePhase, string> = {
  waiting: "#ff6b6b", // Red - wait
  active: "#51cf66", // Green - click now
  won: "#4dabf7", // Blue - winner
  lost: "#ff8787", // Light red - too early
};

const PHASE_MESSAGES: Record<GamePhase, string> = {
  waiting: "WAIT...",
  active: "CLICK NOW!",
  won: "YOU WIN!",
  lost: "TOO EARLY!",
};

export function createRenderer(
  canvas: HTMLCanvasElement,
  game: Bloop<GameBag>,
) {
  const ctx = canvas.getContext("2d")!;

  // Handle resize
  function resize() {
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      game.bag.screenWidth = canvas.width;
      game.bag.screenHeight = canvas.height;
      game.bag.blockX = canvas.width / 2;
    }
  }

  resize();
  window.addEventListener("resize", resize);

  return function render() {
    const bag = game.bag;
    const { width, height } = canvas;

    // Background based on phase
    ctx.fillStyle = BG_COLORS[bag.phase];
    ctx.fillRect(0, 0, width, height);

    // Oscillating block
    const blockSize = Math.min(width, height) * 0.05;
    ctx.fillStyle = "white";
    ctx.fillRect(
      bag.blockX - blockSize / 2,
      height / 2 - blockSize / 2,
      blockSize,
      blockSize,
    );

    // Phase message (centered)
    let message = PHASE_MESSAGES[bag.phase];
    if (bag.phase === "won" && bag.winner === 2) {
      message = "THEY WIN!";
    }

    ctx.fillStyle = "white";
    ctx.font = `bold ${Math.min(width, height) * 0.1}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(message, width / 2, height / 2);

    // Score display (top center)
    ctx.font = `${Math.min(width, height) * 0.04}px sans-serif`;
    ctx.fillText(
      `You: ${bag.player1Score}  |  Them: ${bag.player2Score}`,
      width / 2,
      height * 0.1,
    );

    // Remote cursor indicator (orange circle)
    if (bag.remoteCursorX > 0 && bag.remoteCursorY > 0) {
      ctx.beginPath();
      ctx.arc(bag.remoteCursorX, bag.remoteCursorY, 10, 0, Math.PI * 2);
      ctx.fillStyle = "orange";
      ctx.fill();
    }

    // Instructions (bottom, only during waiting)
    if (bag.phase === "waiting") {
      ctx.font = `${Math.min(width, height) * 0.025}px sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText(
        "Wait for green, then click as fast as you can!",
        width / 2,
        height * 0.9,
      );
    }
  };
}
