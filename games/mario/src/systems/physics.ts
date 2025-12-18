import * as cfg from "../config";
import { PhaseSystem } from "./phase";

// Gravity for both players
export const PhysicsSystem = PhaseSystem("playing", {
  update({ bag }) {
    for (const p of [bag.p1, bag.p2]) {
      if (!p.grounded) {
        p.vy -= cfg.GRAVITY;
        p.vy = Math.max(p.vy, -cfg.MAX_FALL_SPEED);
      }

      p.y += p.vy;

      if (p.y <= cfg.GROUND_Y) {
        p.y = cfg.GROUND_Y;
        p.vy = 0;
        p.grounded = true;
      }
    }
  },
});
