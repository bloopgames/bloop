import * as cfg from "../config";
import { PhaseSystem } from "./phase";

export const CollisionSystem = PhaseSystem("playing", {
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

      if (hitX && hitY && bag.coin.visible === false) {
        // Bonk! Stop upward movement
        p.vy = 0;
        p.y = blockBottom - cfg.PLAYER_HEIGHT;

        p.score += 1;

        bag.coin.hitTime = time.time;
        bag.coin.visible = true;
        bag.coin.winner = p === bag.p1 ? 1 : 2;
      }
    }
  },
});
