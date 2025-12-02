import { ref } from "vue";
import type { Peer } from "./game";
import type { Log } from "./netcode/logs";

export const peers = ref<Peer[]>([]);
export const logs = ref<Log[]>([]);
