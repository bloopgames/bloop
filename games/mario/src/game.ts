import { Bloop } from "@bloopjs/bloop";
import {
  BLOCK_MAX_X,
  BLOCK_MIN_X,
  BLOCK_SIZE,
  BLOCK_SPEED,
  BLOCK_Y,
  GRAVITY,
  GROUND_Y,
  JUMP_VELOCITY,
  MAX_FALL_SPEED,
  MOVE_SPEED,
  P1_START_X,
  P2_START_X,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
} from "./config";

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
    y: GROUND_Y,
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
    p1: createPlayer(P1_START_X),
    p2: createPlayer(P2_START_X),
    block: {
      x: (BLOCK_MIN_X + BLOCK_MAX_X) / 2,
      direction: 1 as 1 | -1,
    },
    coin: {
      visible: true as boolean,
      x: (BLOCK_MIN_X + BLOCK_MAX_X) / 2,
    },
  },
});

export function resetGameState(bag: typeof game.bag) {
  bag.p1 = createPlayer(P1_START_X);
  bag.p2 = createPlayer(P2_START_X);
  bag.block = { x: (BLOCK_MIN_X + BLOCK_MAX_X) / 2, direction: 1 };
  bag.coin = { visible: true, x: (BLOCK_MIN_X + BLOCK_MAX_X) / 2 };
}

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

// Player 1 input: WASD
PhaseSystem("playing", "inputs", {
  update({ bag, players, net }) {
    const p1 = bag.p1;
    const p2 = bag.p2;

    // Horizontal movement
    if (players[0].keys.a.held) p1.x -= MOVE_SPEED;
    if (players[0].keys.d.held) p1.x += MOVE_SPEED;
    // Jump
    if (players[0].keys.w.down && p1.grounded) {
      p1.vy = JUMP_VELOCITY;
      p1.grounded = false;
    }

    // Horizontal movement
    if (players[1].keys.a.held) p2.x -= MOVE_SPEED;
    if (players[1].keys.d.held) p2.x += MOVE_SPEED;
    // Jump
    if (players[1].keys.w.down && p2.grounded) {
      p2.vy = JUMP_VELOCITY;
      p2.grounded = false;
    }

    if (!net.isInSession) {
      // locally, control second player with ijkl
      // Horizontal movement
      if (players[0].keys.j.held) p2.x -= MOVE_SPEED;
      if (players[0].keys.l.held) p2.x += MOVE_SPEED;
      // Jump
      if (players[0].keys.i.down && p2.grounded) {
        p2.vy = JUMP_VELOCITY;
        p2.grounded = false;
      }
    }
  },
});

// Player 2 input: IJKL local or WASD remote
PhaseSystem("playing", "p2-input", {
  update({ bag, players, net }) {
    const p = bag.p2;

    if (net.peerCount >= 2) {
      // Remote player uses WASD
      if (players[1].keys.a.held) p.x -= MOVE_SPEED;
      if (players[1].keys.d.held) p.x += MOVE_SPEED;

      // Jump
      if (players[1].keys.w.down && p.grounded) {
        p.vy = JUMP_VELOCITY;
        p.grounded = false;
      }
    } else {
      // Horizontal movement
      if (players[0].keys.j.held) p.x -= MOVE_SPEED;
      if (players[0].keys.l.held) p.x += MOVE_SPEED;

      // Jump
      if (players[0].keys.i.down && p.grounded) {
        p.vy = JUMP_VELOCITY;
        p.grounded = false;
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
        p.vy -= GRAVITY;
        p.vy = Math.max(p.vy, -MAX_FALL_SPEED);
      }

      // Apply velocity
      p.y += p.vy;

      // Ground collision (ground is below, so check <=)
      if (p.y <= GROUND_Y) {
        p.y = GROUND_Y;
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
    block.x += BLOCK_SPEED * block.direction;

    if (block.x >= BLOCK_MAX_X) {
      block.x = BLOCK_MAX_X;
      block.direction = -1;
    } else if (block.x <= BLOCK_MIN_X) {
      block.x = BLOCK_MIN_X;
      block.direction = 1;
    }

    // Coin follows block
    if (bag.coin.visible) {
      bag.coin.x = block.x;
    }
  },
});

// Collision: player head hits block from below (Y+ is up)
PhaseSystem("playing", "collision", {
  update({ bag }) {
    const block = bag.block;

    for (const p of [bag.p1, bag.p2]) {
      // Only check if player is moving upward (positive vy)
      if (p.vy <= 0) continue;

      // Check if player's head intersects with block
      // Player's feet are at p.y, head is at p.y + PLAYER_HEIGHT
      const playerTop = p.y + PLAYER_HEIGHT;
      const playerLeft = p.x - PLAYER_WIDTH / 2;
      const playerRight = p.x + PLAYER_WIDTH / 2;

      // Block bottom is at BLOCK_Y, top is at BLOCK_Y + BLOCK_SIZE
      const blockBottom = BLOCK_Y;
      const blockLeft = block.x - BLOCK_SIZE / 2;
      const blockRight = block.x + BLOCK_SIZE / 2;

      // AABB collision - head hitting bottom of block
      const hitX = playerRight > blockLeft && playerLeft < blockRight;
      const hitY =
        playerTop > blockBottom && playerTop < blockBottom + BLOCK_SIZE;

      if (hitX && hitY) {
        // Bonk! Stop upward movement
        p.vy = 0;
        p.y = blockBottom - PLAYER_HEIGHT;

        // Award coin if visible
        if (bag.coin.visible) {
          bag.coin.visible = false;
          p.score += 1;
        }
      }
    }
  },
});

// Respawn coin after delay (simple: respawn when both players grounded)
PhaseSystem("playing", "coin-respawn", {
  update({ bag }) {
    if (!bag.coin.visible && bag.p1.grounded && bag.p2.grounded) {
      bag.coin.visible = true;
    }
  },
});

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
