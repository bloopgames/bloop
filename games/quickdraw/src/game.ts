import { Bloop } from "@bloopjs/bloop";
import { buzzer } from "./ui";

export type GamePhase = "waiting" | "active" | "won" | "lost";

export type Peer = {
  id: PeerId;
  nickname: string;
  inAck: FrameNumber;
  outAck: FrameNumber;
  stats: PeerStats;
};

export type FrameNumber = number;
export type PeerId = string;

export type Packet = {
  from: string;
  to: string;
  data: Uint8Array;
};

export type PeerStats = {
  /** Packet round trip time */
  rtt: Stat;
  /** Frame delta times */
  dt: Stat;
  /** Number of inputs ahead */
  inputsAhead: Stat;
  /** Number of inputs behind */
  inputsBehind: Stat;
};

export type Stat = {
  history: number[];
  average: number;
  last: number;
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
    phase: "waiting" as GamePhase,
    timer: 0, // Elapsed time in current phase (seconds)
    player1Score: 0,
    player2Score: 0,
    winner: null as null | 1 | 2, // Which player won the round
    winnerDisplayTime: 0.5, // How long to display winner (seconds)

    // Networking state (for later)
    localPeerId: "" as PeerId,
    peers: [] as Peer[],
    outbound: [] as Packet[],
  },
});

// Update game state each frame
game.system("update timer and block", {
  update({ bag, time }) {
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
  update({ bag, inputs }) {
    const player1Input = inputs.mouse.left.down || inputs.keys.a.down;
    const player2Input = inputs.keys.l.down;

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

// Update UI state from bag every frame
game.system("update ui", {
  update({ bag }) {
    buzzer.value.blockX = bag.blockX;
    buzzer.value.phase = bag.phase;
    buzzer.value.player1Score = bag.player1Score;
    buzzer.value.player2Score = bag.player2Score;
    buzzer.value.winner = bag.winner;
    buzzer.value.screenWidth = bag.screenWidth;
    buzzer.value.screenHeight = bag.screenHeight;
  },
});

export function makePeer(id: PeerId) {
  return {
    id,
    nickname: id.substring(0, 6),
    inAck: -1,
    outAck: -1,
    stats: {
      rtt: { history: [], average: 0, last: 0 },
      dt: { history: [], average: 0, last: 0 },
      inputsAhead: { history: [], average: 0, last: 0 },
      inputsBehind: { history: [], average: 0, last: 0 },
    },
  };
}
