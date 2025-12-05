import type { PeerId } from "./protocol";

export type Log = {
  source: "webrtc" | "ws" | "local" | "rollback";
  /** absolute frame number since the start of the sim */
  frame_number: number;
  /** relative frame number since the start of the current session */
  match_frame: number | null;
  timestamp: number;
  severity: "debug" | "log" | "warn" | "error";
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

export type Logger = {
  log: (log: LogOpts) => void;
  warn: (log: LogOpts) => void;
  error: (log: LogOpts) => void;
};
