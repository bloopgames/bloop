import {
  computed,
  type ReadonlySignal,
  type Signal,
  signal,
} from "@preact/signals";
import type { Log } from "../netcode/logs.ts";

export type FrameNumber = number;

export type Peer = {
  id: string;
  nickname: string;
  ack: FrameNumber;
  seq: FrameNumber;
  lastPacketTime: number;
};

export type NetStatus = {
  ourId: number | null;
  remoteId: number | null;
  rtt: number | null;
  peers: Peer[];
};

export type DebugState = {
  isVisible: Signal<boolean>;
  netStatus: Signal<NetStatus>;
  logs: Signal<Log[]>;
  peer: ReadonlySignal<Peer | null>;
  advantage: ReadonlySignal<number | null>;
};

const isVisible = signal(false);
const netStatus = signal<NetStatus>({
  ourId: null,
  remoteId: null,
  rtt: null,
  peers: [],
});
const logs = signal<Log[]>([]);

export const debugState: DebugState = {
  /** Whether debug UI is visible */
  isVisible,

  /** Network status */
  netStatus,

  /** Log entries */
  logs,

  /** First connected peer (for Stats panel) */
  peer: computed(() => netStatus.value.peers[0] ?? null),

  /** Advantage calculation (seq - ack) */
  advantage: computed(() => {
    const peer = netStatus.value.peers[0];
    return peer ? peer.seq - peer.ack : null;
  }),
};

export function addLog(log: Log): void {
  debugState.logs.value = [...debugState.logs.value, log];
}

export function updatePeer(id: string, updates: Partial<Peer>): void {
  const peers = [...debugState.netStatus.value.peers];
  const idx = peers.findIndex((p) => p.id === id);
  const existing = peers[idx];
  if (idx >= 0 && existing) {
    peers[idx] = {
      id: updates.id ?? existing.id,
      nickname: updates.nickname ?? existing.nickname,
      ack: updates.ack ?? existing.ack,
      seq: updates.seq ?? existing.seq,
      lastPacketTime: updates.lastPacketTime ?? existing.lastPacketTime,
    };
    debugState.netStatus.value = {
      ...debugState.netStatus.value,
      peers,
    };
  }
}

export function addPeer(peer: Peer): void {
  debugState.netStatus.value = {
    ...debugState.netStatus.value,
    peers: [...debugState.netStatus.value.peers, peer],
  };
}

export function removePeer(id: string): void {
  debugState.netStatus.value = {
    ...debugState.netStatus.value,
    peers: debugState.netStatus.value.peers.filter((p) => p.id !== id),
  };
}

export function setLocalId(id: number): void {
  debugState.netStatus.value = {
    ...debugState.netStatus.value,
    ourId: id,
  };
}

export function setRemoteId(id: number): void {
  debugState.netStatus.value = {
    ...debugState.netStatus.value,
    remoteId: id,
  };
}

export function clearLogs(): void {
  debugState.logs.value = [];
}

export function resetState(): void {
  debugState.isVisible.value = false;
  debugState.logs.value = [];
  debugState.netStatus.value = {
    ourId: null,
    remoteId: null,
    rtt: null,
    peers: [],
  };
}
