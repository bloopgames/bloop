import type { Log } from "@bloopjs/web";
import { ref } from "vue";
import type { GamePhase } from "./game";

export type FrameNumber = number;
export type PeerId = string;

export type Peer = {
  id: PeerId;
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

export const netStatus = ref<NetStatus>({
  ourId: null,
  remoteId: null,
  rtt: null,
  peers: [],
});

export const logs = ref<Log[]>([]);

// Buzzer game UI state
export const buzzer = ref({
  blockX: 0,
  phase: "waiting" as GamePhase,
  player1Score: 0,
  player2Score: 0,
  winner: null as null | 1 | 2,
  screenWidth: 800,
  screenHeight: 600,
  remoteCursorX: 0,
  remoteCursorY: 0,
});
