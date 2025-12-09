import type { PeerId } from "./protocol.ts";

export type Log = {
  source: "webrtc" | "ws" | "local" | "rollback";
  /** absolute frame number since the start of the sim */
  frame_number: number;
  /** relative frame number since the start of the current session */
  match_frame: number | null;
  /** unix timestamp */
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
  source: Log["source"];
};

export type LogDirection = "inbound" | "outbound";

export type LogSeverity = "debug" | "log" | "warn" | "error";

export type OnLogCallback = (log: Log) => void;

export type Logger = {
  onLog: OnLogCallback | null;

  matchFrame: number;
  frameNumber: number;

  log(opts: LogOpts): void;
  warn(opts: LogOpts): void;
  error(opts: LogOpts): void;
}

export const logger: Logger = {
  onLog: null as OnLogCallback | null,

  matchFrame: -1,
  frameNumber: -1,

  log(opts: LogOpts) {
    this.onLog?.({
      ...opts,
      frame_number: this.frameNumber,
      match_frame: this.matchFrame >= 0 ? this.matchFrame : null,
      timestamp: Date.now(),
      severity: "log",
    });
  },

  warn(opts: LogOpts) {
    this.onLog?.({
      ...opts,
      frame_number: this.frameNumber,
      match_frame: this.matchFrame >= 0 ? this.matchFrame : null,
      timestamp: Date.now(),
      severity: "warn",
    });
  },

  error(opts: LogOpts) {
    this.onLog?.({
      ...opts,
      frame_number: this.frameNumber,
      match_frame: this.matchFrame >= 0 ? this.matchFrame : null,
      timestamp: Date.now(),
      severity: "error",
    });
  },
};
