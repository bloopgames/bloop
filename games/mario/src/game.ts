import { Bloop } from "@bloopjs/bloop";
import * as cfg from "./config";

type Player = {
  x: number;
  y: number;
  vy: number;
  grounded: boolean;
  score: number;
};

function createPlayer(x: number): Player {
  return {
    x,
    y: cfg.GROUND_Y,
    vy: 0,
    grounded: true,
    score: 0,
  };
}

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

PhaseSystem("title", "title-screen", {
  keydown({ bag, event }) {
    if (event.key === "Space") {
      // Local multiplayer - start immediately
      bag.mode = "local";
      bag.phase = "playing";
      resetGameState(bag);
    }
  },
});

// Player 1 input: WASD
PhaseSystem("playing", "inputs", {
  update({ bag, players, net }) {
    const p1 = bag.p1;
    const p2 = bag.p2;

    // Horizontal movement
    if (players[0].keys.a.held) p1.x -= cfg.MOVE_SPEED;
    if (players[0].keys.d.held) p1.x += cfg.MOVE_SPEED;
    // Jump
    const wantsJump = players[0].keys.w.down || players[0].mouse.left.down;
    if (wantsJump && p1.grounded) {
      p1.vy = cfg.JUMP_VELOCITY;
      p1.grounded = false;
    }

    // Horizontal movement
    if (players[1].keys.a.held) p2.x -= cfg.MOVE_SPEED;
    if (players[1].keys.d.held) p2.x += cfg.MOVE_SPEED;
    // Jump
    if (players[1].keys.w.down && p2.grounded) {
      p2.vy = cfg.JUMP_VELOCITY;
      p2.grounded = false;
    }

    if (!net.isInSession) {
      // locally, control second player with ijkl
      // Horizontal movement
      if (players[0].keys.j.held) p2.x -= cfg.MOVE_SPEED;
      if (players[0].keys.l.held) p2.x += cfg.MOVE_SPEED;
      // Jump
      if (players[0].keys.i.down && p2.grounded) {
        p2.vy = cfg.JUMP_VELOCITY;
        p2.grounded = false;
      }
    }
  },
});

// Physics for both players (Y+ is up)
PhaseSystem("playing", "physics", {
  update({ bag }) {
    for (const p of [bag.p1, bag.p2]) {
      // Apply gravity (pulls down, so subtract)
      if (!p.grounded) {
        p.vy -= cfg.GRAVITY;
        p.vy = Math.max(p.vy, -cfg.MAX_FALL_SPEED);
      }

      // Apply velocity
      p.y += p.vy;

      // Ground collision (ground is below, so check <=)
      if (p.y <= cfg.GROUND_Y) {
        p.y = cfg.GROUND_Y;
        p.vy = 0;
        p.grounded = true;
      }
    }
  },
});

// Block movement (oscillates left/right)
PhaseSystem("playing", "block", {
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
});

// Collision: player head hits block from below (Y+ is up)
PhaseSystem("playing", "collision", {
  update({ bag, time }) {
    const block = bag.block;

    for (const p of [bag.p1, bag.p2]) {
      // Only check if player is moving upward (positive vy)
      if (p.vy <= 0) continue;

      // Check if player's head intersects with block
      // Player's feet are at p.y, head is at p.y + PLAYER_HEIGHT
      const playerTop = p.y + cfg.PLAYER_HEIGHT;
      const playerLeft = p.x - cfg.PLAYER_WIDTH / 2;
      const playerRight = p.x + cfg.PLAYER_WIDTH / 2;

      // Block bottom is at BLOCK_Y, top is at BLOCK_Y + BLOCK_SIZE
      const blockBottom = cfg.BLOCK_Y;
      const blockLeft = block.x - cfg.BLOCK_SIZE / 2;
      const blockRight = block.x + cfg.BLOCK_SIZE / 2;

      // AABB collision - head hitting bottom of block
      const hitX = playerRight > blockLeft && playerLeft < blockRight;
      const hitY =
        playerTop > blockBottom && playerTop < blockBottom + cfg.BLOCK_SIZE;

      if (hitX && hitY) {
        // Bonk! Stop upward movement
        p.vy = 0;
        p.y = blockBottom - cfg.PLAYER_HEIGHT;

        p.score += 1;

        bag.coin.hitTime = time.time;
        bag.coin.visible = true;
      }
    }
  },
});

PhaseSystem("playing", "coin", {
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
});

type GameSystem = Parameters<typeof game.system>[1];

function PhaseSystem(phase: Phase, name: string, system: GameSystem) {
  const original = system.update;
  game.system(name, {
    ...system,
    update(ctx) {
      if (ctx.bag.phase !== phase) return;
      original?.(ctx);
    },
  });
}
