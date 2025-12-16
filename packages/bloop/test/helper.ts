import type { Sim } from "../src/sim";
import { unwrap } from "../src/util";

export function setupSession(sim0: Sim, sim1: Sim) {
  sim0.sessionInit(2);
  sim0.net.setLocalPeer(0);
  sim0.net.connectPeer(1);

  sim1.sessionInit(2);
  sim1.net.setLocalPeer(1);
  sim1.net.connectPeer(0);
}

export function stepBoth(sim0: Sim, sim1: Sim) {
  sim0.net.receivePacket(unwrap(sim1.net.getOutboundPacket(0)));
  sim1.net.receivePacket(unwrap(sim0.net.getOutboundPacket(1)));
  sim0.step();
  sim1.step();
}
