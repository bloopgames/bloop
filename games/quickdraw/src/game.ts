import { Bloop, Util } from "@bloopjs/bloop";
import { peers } from "./ui";

export type Peer = {
  id: PeerId;
  nickname: string;
  inAck: FrameNumber;
  outAck: FrameNumber;
  stats: PeerStats;
};

export type FrameNumber = number;
export type PeerId = string;

export type Packet = {
  from: string;
  to: string;
  data: Uint8Array;
};

export type PeerStats = {
  /** Packet round trip time */
  rtt: Stat;
  /** Frame delta times */
  dt: Stat;
  /** Number of inputs ahead */
  inputsAhead: Stat;
  /** Number of inputs behind */
  inputsBehind: Stat;
};

export type Stat = {
  history: number[];
  average: number;
  last: number;
};

export const game = Bloop.create({
  bag: {
    localPeerId: "" as PeerId,
    peers: [] as Peer[],
    outbound: [] as Packet[],
  },
});

game.system("run", {
  update({ bag, inputs }) {
    if (inputs.keys.a.down) {
      bag.peers.push(makePeer(crypto.randomUUID()));
    }

    Util.logPerSecond(
      performance.now(),
      "Running game loop",
      bag.peers.length,
      "peers connected"
    );
  },
});

game.system("update ui", {
  update({ bag }) {
    peers.value = [...bag.peers];
  },
});

export function makePeer(id: PeerId) {
  return {
    id,
    nickname: id.substring(0, 6),
    inAck: -1,
    outAck: -1,
    stats: {
      rtt: { history: [], average: 0, last: 0 },
      dt: { history: [], average: 0, last: 0 },
      inputsAhead: { history: [], average: 0, last: 0 },
      inputsBehind: { history: [], average: 0, last: 0 },
    },
  };
}
