import type { PeerId } from "./protocol.ts";

export type Log = {
  source: "webrtc" | "ws" | "local" | "rollback";
  /** absolute frame number since the start of the sim */
  frame_number: number;
  /** relative frame number since the start of the current session */
  match_frame: number | null;
  timestamp: number;
  severity: LogSeverity;
  label?: string;
  json?: any;
  // webrtc stuff
  direction?: LogDirection;
  from?: PeerId;
  to?: PeerId;
  reliable?: boolean;
  packet?: {
    size: number;
    bytes: Uint8Array;
  };
};

export type LogOpts = Partial<Log> & {
  source: "webrtc" | "ws" | "local" | "rollback";
};

export type LogDirection = "inbound" | "outbound";

export type LogSeverity = "debug" | "log" | "warn" | "error";

export type OnLogCallback = (severity: LogSeverity, log: LogOpts) => void;

export const logger = {
  onLog: null as OnLogCallback | null,

  log(opts: LogOpts) {
    this.onLog?.("log", opts);
  },

  warn(opts: LogOpts) {
    this.onLog?.("warn", opts);
  },

  error(opts: LogOpts) {
    this.onLog?.("error", opts);
  },
};
