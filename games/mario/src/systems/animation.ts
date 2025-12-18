import { reset, step } from "../flipbook";
import type { Player, Pose } from "../game";
import { PhaseSystem } from "./phase";

export const AnimationSystem = PhaseSystem("playing", {
  update({ bag, time }) {
    updatePlayerAnimation(bag.p1, time.dt);
    updatePlayerAnimation(bag.p2, time.dt);
  },
});

function updatePlayerAnimation(player: Player, dt: number) {
  const newPose = determinePose(player);

  if (newPose !== player.pose) {
    player.pose = newPose;
    reset(player.anims[player.pose]);
  }

  if (!player.anims[player.pose]) {
    throw new Error(`No animation found for pose ${player.pose}`);
  }
  step(player.anims[player.pose], dt * 1000);
}

function determinePose(player: Player): Pose {
  if (!player.grounded) return "jump";
  if (player.vx !== 0) return "run";
  return "idle";
}
