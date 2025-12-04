import type { PeerId } from "./protocol";

export type Log = {
  source: "webrtc" | "ws" | "local";
  frame_number: number;
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
  source: "webrtc" | "ws" | "local";
};

export type LogDirection = "inbound" | "outbound";

export type Logger = {
  log: (log: LogOpts) => void;
  warn: (log: LogOpts) => void;
  error: (log: LogOpts) => void;
};
