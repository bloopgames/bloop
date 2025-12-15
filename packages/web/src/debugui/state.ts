import {
  computed,
  type ReadonlySignal,
  type Signal,
  signal,
} from "@preact/signals";
import type { Log } from "../netcode/logs.ts";

export type FrameNumber = number;

export type LayoutMode = "off" | "letterboxed" | "full";

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
  layoutMode: Signal<LayoutMode>;
  isVisible: ReadonlySignal<boolean>;
  netStatus: Signal<NetStatus>;
  logs: Signal<Log[]>;
  peer: ReadonlySignal<Peer | null>;
  advantage: ReadonlySignal<number | null>;
  // Metrics for letterboxed layout
  fps: Signal<number>;
  frameTime: Signal<number>; // ms per frame
  snapshotSize: Signal<number>; // bytes
  frameNumber: Signal<number>;
  // HMR flash indicator
  hmrFlash: Signal<boolean>;
  // Tape playback state
  isPlaying: Signal<boolean>;
  tapeUtilization: Signal<number>; // 0-1, how full the tape buffer is
  playheadPosition: Signal<number>; // 0-1, current position in tape
  tapeStartFrame: Signal<number>; // first frame in tape
  tapeFrameCount: Signal<number>; // total frames in tape
  // Playbar handlers (set by App)
  onJumpBack: Signal<(() => void) | null>;
  onStepBack: Signal<(() => void) | null>;
  onPlayPause: Signal<(() => void) | null>;
  onStepForward: Signal<(() => void) | null>;
  onJumpForward: Signal<(() => void) | null>;
  onSeek: Signal<((position: number) => void) | null>;
};

const layoutMode = signal<LayoutMode>("off");
const netStatus = signal<NetStatus>({
  ourId: null,
  remoteId: null,
  rtt: null,
  peers: [],
});
const logs = signal<Log[]>([]);
const fps = signal(0);
const frameTime = signal(0);
const snapshotSize = signal(0);
const frameNumber = signal(0);
const hmrFlash = signal(false);

// Tape playback state
const isPlaying = signal(true);
const tapeUtilization = signal(0);
const playheadPosition = signal(0);
const tapeStartFrame = signal(0);
const tapeFrameCount = signal(0);

// Playbar handlers
const onJumpBack = signal<(() => void) | null>(null);
const onStepBack = signal<(() => void) | null>(null);
const onPlayPause = signal<(() => void) | null>(null);
const onStepForward = signal<(() => void) | null>(null);
const onJumpForward = signal<(() => void) | null>(null);
const onSeek = signal<((position: number) => void) | null>(null);

export const debugState: DebugState = {
  /** Layout mode: off, letterboxed, or full */
  layoutMode,

  /** Whether debug UI is visible (derived from layoutMode) */
  isVisible: computed(() => layoutMode.value !== "off"),

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

  /** Metrics for letterboxed layout */
  fps,
  frameTime,
  snapshotSize,
  frameNumber,

  /** HMR flash indicator */
  hmrFlash,

  /** Tape playback state */
  isPlaying,
  tapeUtilization,
  playheadPosition,
  tapeStartFrame,
  tapeFrameCount,

  /** Playbar handlers */
  onJumpBack,
  onStepBack,
  onPlayPause,
  onStepForward,
  onJumpForward,
  onSeek,
};

/** Cycle through layout modes: off -> letterboxed -> full -> off */
export function cycleLayout(): void {
  const current = layoutMode.value;
  if (current === "off") {
    layoutMode.value = "letterboxed";
  } else if (current === "letterboxed") {
    layoutMode.value = "full";
  } else {
    layoutMode.value = "off";
  }
}

let hmrFlashQueued = false;

/** Trigger HMR flash (only when debug UI is visible) */
export function triggerHmrFlash(): void {
  if (!debugState.isVisible.value) return;

  // If window doesn't have focus, queue the flash for when focus returns
  if (!document.hasFocus()) {
    if (!hmrFlashQueued) {
      hmrFlashQueued = true;
      window.addEventListener("focus", onWindowFocus);
    }
    return;
  }

  doFlash();
}

function onWindowFocus(): void {
  if (hmrFlashQueued) {
    hmrFlashQueued = false;
    window.removeEventListener("focus", onWindowFocus);
    doFlash();
  }
}

function doFlash(): void {
  debugState.hmrFlash.value = true;
  setTimeout(() => {
    debugState.hmrFlash.value = false;
  }, 300);
}

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
  debugState.layoutMode.value = "off";
  debugState.logs.value = [];
  debugState.netStatus.value = {
    ourId: null,
    remoteId: null,
    rtt: null,
    peers: [],
  };
  debugState.fps.value = 0;
  debugState.frameTime.value = 0;
  debugState.snapshotSize.value = 0;
  debugState.frameNumber.value = 0;
  debugState.hmrFlash.value = false;
  // Tape state
  debugState.isPlaying.value = true;
  debugState.tapeUtilization.value = 0;
  debugState.playheadPosition.value = 0;
  debugState.tapeStartFrame.value = 0;
  debugState.tapeFrameCount.value = 0;
  // Don't reset handlers - they're set once by App
}
