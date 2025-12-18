import { Bloop } from "@bloopjs/bloop";
import * as cfg from "./config";
import type { Flipbook } from "./flipbook";
import { CollisionSystem } from "./systems/collision";
import { InputsSystem } from "./systems/inputs";
import { PhaseSystem } from "./systems/phase";
import { PhysicsSystem } from "./systems/physics";

export type Player = {
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  score: number;
  poses: Record<Pose, Flipbook>;
};

function createPlayer(x: number): Player {
  return {
    x,
    y: cfg.GROUND_Y,
    vy: 0,
    grounded: true,
    score: 0,
    poses: {} as Record<Pose, Flipbook>,
  };
}

export type Pose = "idle" | "run" | "jump";

export type Phase = "title" | "waiting" | "playing";

export const game = Bloop.create({
  bag: {
    phase: "title" as Phase,
    mode: null as "local" | "online" | null,
    p1: createPlayer(cfg.P1_START_X),
    p2: createPlayer(cfg.P2_START_X),
    block: {
      x: (cfg.BLOCK_MIN_X + cfg.BLOCK_MAX_X) / 2,
      direction: 1 as 1 | -1,
    },
    coin: {
      visible: true as boolean,
      hitTime: 0,
      winner: null as 1 | 2 | null,
      x: (cfg.BLOCK_MIN_X + cfg.BLOCK_MAX_X) / 2,
      y: 0,
    },
  },
});

export function resetGameState(bag: typeof game.bag) {
  bag.p1 = createPlayer(cfg.P1_START_X);
  bag.p2 = createPlayer(cfg.P2_START_X);
  bag.block = { x: (cfg.BLOCK_MIN_X + cfg.BLOCK_MAX_X) / 2, direction: 1 };
  bag.coin = {
    visible: false,
    x: (cfg.BLOCK_MIN_X + cfg.BLOCK_MAX_X) / 2,
    y: 0,
    hitTime: 0,
    winner: null,
  };
}

// Handle online session transitions (runs in all phases)
game.system("session-watcher", {
  update({ bag, net }) {
    // Waiting for connection → connected, start playing
    if (bag.phase === "waiting" && net.isInSession) {
      resetGameState(bag);
      bag.phase = "playing";
    }

    // Was playing online → disconnected, back to title
    if (bag.phase === "playing" && bag.mode === "online" && !net.isInSession) {
      bag.phase = "title";
      bag.mode = null;
    }
  },
});

game.system(
  "title-screen",
  PhaseSystem("title", {
    keydown({ bag, event }) {
      if (event.key === "Space") {
        // Local multiplayer - start immediately
        bag.mode = "local";
        bag.phase = "playing";
        resetGameState(bag);
      }
    },
  }),
);

game.system("inputs", InputsSystem);

game.system("physics", PhysicsSystem);

game.system("collision", CollisionSystem);

// Block movement (oscillates left/right)
game.system(
  "block",
  PhaseSystem("playing", {
    update({ bag }) {
      const block = bag.block;
      block.x += cfg.BLOCK_SPEED * block.direction;

      if (block.x >= cfg.BLOCK_MAX_X) {
        block.x = cfg.BLOCK_MAX_X;
        block.direction = -1;
      } else if (block.x <= cfg.BLOCK_MIN_X) {
        block.x = cfg.BLOCK_MIN_X;
        block.direction = 1;
      }
    },
  }),
);

game.system(
  "coin",
  PhaseSystem("playing", {
    update({ bag, time }) {
      // Coin follows block unless coin animation is active
      if (!bag.coin.visible) {
        bag.coin.x = bag.block.x;
        bag.coin.y = cfg.BLOCK_Y + cfg.BLOCK_SIZE;
        return;
      }

      bag.coin.y += cfg.COIN_V_Y;
      if (time.time - bag.coin.hitTime >= cfg.COIN_VISIBLE_DURATION) {
        bag.coin.visible = false;
      }
    },
  }),
);

export type GameSystem = Parameters<typeof game.system>[1];
