import type { Bloop } from "../src/bloop";
import type { BloopSchema } from "../src/data/schema";
import { type MountOptions, mount } from "../src/mount";
import type { Sim } from "../src/sim";
import { unwrap } from "../src/util";

export type GameMaker<S extends BloopSchema> = () => Bloop<S>;

export async function startOnlineMatch<S extends BloopSchema>(
  maker: GameMaker<S>,
  mountOpts?: MountOptions,
): Promise<[Sim, Sim, Bloop<S>, Bloop<S>]> {
  const [game0, game1] = setupGames(maker);

  const { sim: sim0 } = await mount(game0, mountOpts);
  const { sim: sim1 } = await mount(game1, mountOpts);

  setupSession(sim0, sim1);
  return [sim0, sim1, game0, game1];
}

export function setupGames<S extends BloopSchema>(
  maker: GameMaker<S>,
): [Bloop<S>, Bloop<S>] {
  return [maker(), maker()];
}

export function setupSession(sim0: Sim, sim1: Sim) {
  // Set local peer ID and emit peer joins BEFORE session start
  sim0.emit.network("peer:assign_local_id", { peerId: 0 });
  sim0.emit.network("peer:join", { peerId: 0 });
  sim0.emit.network("peer:join", { peerId: 1 });
  sim0.emit.network("session:start", {});

  sim1.emit.network("peer:assign_local_id", { peerId: 1 });
  sim1.emit.network("peer:join", { peerId: 0 });
  sim1.emit.network("peer:join", { peerId: 1 });
  sim1.emit.network("session:start", {});

  sim0.step();
  sim1.step();
}

export function stepBoth(sim0: Sim, sim1: Sim) {
  sim0.emit.packet(unwrap(sim1.getOutboundPacket(0)));
  sim1.emit.packet(unwrap(sim0.getOutboundPacket(1)));
  sim0.step();
  sim1.step();
}

export async function loadTape<S extends BloopSchema>(
  path: string,
  maker: GameMaker<S>,
): Promise<{ sim: Sim; game: Bloop<S> }> {
  const game = maker();
  const { sim } = await mount(game);
  const bytes = await Bun.file(path).bytes();
  sim.loadTape(bytes);
  return {
    sim,
    game,
  };
}
