import { type MountOpts, mount } from "./mount";
import type { Sim } from "./sim";
import { assert } from "./util";

export async function handleUpdate(
  newModule: any,
  oldSim: Sim,
  mountOptions?: Partial<MountOpts>,
): Promise<Sim> {
  assert(
    newModule?.game,
    `HMR: missing game export on module: ${JSON.stringify(newModule)}`,
  );

  const { sim } = await mount({
    hooks: (newModule.game as any).hooks,
    ...mountOptions,
  });
  console.log("mounted sim", sim.id);

  const tape = oldSim.saveTape();
  const snapshot = oldSim.snapshot();

  sim.loadTape(tape);
  sim.restore(snapshot);
  oldSim.unmount();
  return sim;
}
