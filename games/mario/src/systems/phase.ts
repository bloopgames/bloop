import type { GameSystem, Phase } from "../game";

export function PhaseSystem(phase: Phase, system: GameSystem): GameSystem {
  const original = system.update;
  return {
    ...system,
    update(ctx) {
      if (ctx.bag.phase !== phase) return;
      original?.(ctx);
    },
  };
}
