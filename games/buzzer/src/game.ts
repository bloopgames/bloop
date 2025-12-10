import { Bloop } from "@bloopjs/bloop";

export type GamePhase = "connecting" | "waiting" | "active" | "won" | "lost";

export type Packet = {
  from: string;
  to: string;
  lastPacketTime: number;
};

export const game = Bloop.create({
  bag: {
    // TODO: Move screen dimensions to engine context via resize events
    screenWidth: 800,
    screenHeight: 600,

    // Buzzer game state
    buzzDelay: 3, // Time before background changes (seconds)
    blockX: 400, // Position of oscillating block (initialized to center)
    blockSpeed: 400, // Pixels per second (takes 1s to travel ~400px)
    blockDirection: 1, // 1 for right, -1 for left
    phase: "connecting" as GamePhase,
    timer: 0, // Elapsed time in current phase (seconds)
    player1Score: 0,
    player2Score: 0,
    winner: null as null | 1 | 2, // Which player won the round
    winnerDisplayTime: 0.5, // How long to display winner (seconds)

    // Remote player cursor position
    remoteCursorX: 0,
    remoteCursorY: 0,
  },
});

// Update game state each frame
game.system("update timer and block", {
  update({ bag, time, peerCount }) {
    // Transition from connecting to waiting when session is active (2 peers)
    if (bag.phase === "connecting" && peerCount >= 2) {
      bag.phase = "waiting";
      bag.timer = 0;
    }

    // Don't update during connecting phase
    if (bag.phase === "connecting") return;

    bag.timer += time.dt;

    // Oscillate the block (time.dt is in seconds)
    bag.blockX += bag.blockSpeed * bag.blockDirection * time.dt;

    // Bounce at screen edges
    // Block travels from 25% to 75% of screen width (50% range, takes 1 second at 400px/s on 800px screen)
    const minX = bag.screenWidth * 0.25;
    const maxX = bag.screenWidth * 0.75;
    if (bag.blockX > maxX) {
      bag.blockX = maxX;
      bag.blockDirection = -1;
    } else if (bag.blockX < minX) {
      bag.blockX = minX;
      bag.blockDirection = 1;
    }

    // State transitions based on timer
    if (bag.phase === "waiting") {
      if (bag.timer >= bag.buzzDelay) {
        bag.phase = "active";
        bag.timer = 0;
      }
    } else if (bag.phase === "won" || bag.phase === "lost") {
      if (bag.timer >= bag.winnerDisplayTime) {
        // Start new round
        bag.phase = "waiting";
        bag.timer = 0;
        bag.winner = null;
      }
    }
  },
});

// Handle player inputs
game.system("handle inputs", {
  update({ bag, players }) {
    // Don't process inputs during connecting phase
    if (bag.phase === "connecting") return;

    // Player 1 = local player (players[0])
    // Player 2 = remote peer (players[1])
    const player1Input = players[0]?.mouse.left.down ?? false;
    const player2Input = players[1]?.mouse.left.down ?? false;

    if (bag.phase === "waiting") {
      // Clicking before buzzer = lose
      if (player1Input || player2Input) {
        bag.phase = "lost";
        bag.timer = 0;
      }
    } else if (bag.phase === "active") {
      // First to click after buzzer wins
      if (player1Input) {
        bag.phase = "won";
        bag.winner = 1;
        bag.player1Score++;
        bag.timer = 0;
      } else if (player2Input) {
        bag.phase = "won";
        bag.winner = 2;
        bag.player2Score++;
        bag.timer = 0;
      }
    }
  },
});

// Sync remote player cursor position
game.system("sync remote cursor", {
  update({ bag, players }) {
    const remoteMouse = players[1]?.mouse;
    if (remoteMouse) {
      bag.remoteCursorX = remoteMouse.x;
      bag.remoteCursorY = remoteMouse.y;
    }
  },
});
