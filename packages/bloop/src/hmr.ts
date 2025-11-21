import { mount, type MountOpts } from "./mount";
import type { Runtime } from "./runtime";
import { assert } from "./util";

export async function handleUpdate(newModule: any, oldRuntime: Runtime, mountOptions?: Partial<MountOpts>) {
  assert(
    newModule?.game,
    `HMR: missing game export on module: ${JSON.stringify(newModule)}`,
  );

  const { runtime } = await mount({hooks: (newModule.game as any).hooks, ...mountOptions});

  const tape = oldRuntime.saveTape();
  const snapshot = oldRuntime.snapshot();

  runtime.loadTape(tape);
  runtime.restore(snapshot);
  oldRuntime.unmount();
  return runtime;
}
