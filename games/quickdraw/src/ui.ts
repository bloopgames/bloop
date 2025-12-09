import { ref } from "vue";
import type { GamePhase, Peer } from "./game";
import type { Log } from "./netcode/logs";

export const peers = ref<Peer[]>([]);
export const logs = ref<Log[]>([]);

export const ourPeerId = ref<number | null>(null);
export const remotePeerId = ref<number | null>(null);

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
