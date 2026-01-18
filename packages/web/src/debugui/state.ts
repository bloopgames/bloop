import {
  computed,
  type ReadonlySignal,
  type Signal,
  signal,
} from "@preact/signals";
import type { App } from "../App";
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
  isRecording: Signal<boolean>; // whether sim is currently recording
  isReplaying: Signal<boolean>; // whether sim is replaying a tape
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
  // Tape loading/saving
  onLoadTape: Signal<((bytes: Uint8Array, fileName: string) => void) | null>;
  onReplayLastTape: Signal<(() => void) | null>;
  onReplayLastSaved: Signal<(() => void) | null>;
  onSaveTape: Signal<(() => void) | null>;
  lastTapeName: Signal<string | null>;
  lastSavedTapeName: Signal<string | null>;
  isLoadDialogOpen: Signal<boolean>;
  // Recording toggle
  onToggleRecording: Signal<(() => void) | null>;
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
const isRecording = signal(false);
const isReplaying = signal(false);
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

// Tape loading/saving
const onLoadTape = signal<((bytes: Uint8Array, fileName: string) => void) | null>(null);
const onReplayLastTape = signal<(() => void) | null>(null);
const onReplayLastSaved = signal<(() => void) | null>(null);
const onSaveTape = signal<(() => void) | null>(null);
const lastTapeName = signal<string | null>(null);
const lastSavedTapeName = signal<string | null>(null);
const isLoadDialogOpen = signal(false);

// Recording toggle
const onToggleRecording = signal<(() => void) | null>(null);

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
  isRecording,
  isReplaying,
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

  /** Tape loading/saving */
  onLoadTape,
  onReplayLastTape,
  onReplayLastSaved,
  onSaveTape,
  lastTapeName,
  lastSavedTapeName,
  isLoadDialogOpen,

  /** Recording toggle */
  onToggleRecording,
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
  debugState.isRecording.value = false;
  debugState.isReplaying.value = false;
  debugState.tapeUtilization.value = 0;
  debugState.playheadPosition.value = 0;
  debugState.tapeStartFrame.value = 0;
  debugState.tapeFrameCount.value = 0;
  // Don't reset handlers - they're set once by App
}

/** Wire up playbar handlers to control an App instance */
export function wirePlaybarHandlers(app: App): void {
  debugState.onPlayPause.value = () => {
    app.sim.isPaused ? app.sim.unpause() : app.sim.pause();
  };
  debugState.onStepBack.value = () => {
    if (app.sim.hasHistory) app.sim.stepBack();
  };
  debugState.onStepForward.value = () => {
    if (app.sim.hasHistory) {
      app.sim.seek(app.sim.time.frame + 1);
    }
  };
  debugState.onJumpBack.value = () => {
    if (app.sim.hasHistory) {
      const target = Math.max(
        debugState.tapeStartFrame.value,
        app.sim.time.frame - 10,
      );
      app.sim.seek(target);
    }
  };
  debugState.onJumpForward.value = () => {
    if (app.sim.hasHistory) {
      const maxFrame =
        debugState.tapeStartFrame.value + debugState.tapeFrameCount.value;
      const target = Math.min(maxFrame, app.sim.time.frame + 10);
      app.sim.seek(target);
    }
  };
  debugState.onSeek.value = (ratio: number) => {
    if (app.sim.hasHistory) {
      app.sim.pause();
      const startFrame = debugState.tapeStartFrame.value;
      const frameCount = debugState.tapeFrameCount.value;
      const targetFrame = startFrame + Math.floor(ratio * frameCount);
      app.sim.seek(targetFrame);
    }
  };
  debugState.onToggleRecording.value = () => {
    if (app.sim.isRecording) {
      app.sim.stopRecording();
    } else {
      app.sim.record();
    }
  };
}

/** Set up drag-and-drop tape loading on a canvas element */
export function wireTapeDragDrop(canvas: HTMLCanvasElement, app: App): void {
  canvas.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
  });
  canvas.addEventListener("drop", async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files[0];
    if (!file?.name.endsWith(".bloop")) {
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    app.loadTape(bytes);
  });
}

// IndexedDB helpers for tape persistence
const TAPE_DB_NAME = "bloop-debug";
const TAPE_STORE_NAME = "tapes";
const TAPE_KEY_LOADED = "last-loaded";
const TAPE_KEY_SAVED = "last-saved";

function openTapeDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(TAPE_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(TAPE_STORE_NAME);
    };
  });
}

async function saveTapeToStorage(
  bytes: Uint8Array,
  fileName: string,
  key: string = TAPE_KEY_LOADED,
): Promise<void> {
  const db = await openTapeDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TAPE_STORE_NAME, "readwrite");
    tx.objectStore(TAPE_STORE_NAME).put({ bytes, fileName }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadTapeFromStorage(key: string = TAPE_KEY_LOADED): Promise<{
  bytes: Uint8Array;
  fileName: string;
} | null> {
  try {
    const db = await openTapeDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(TAPE_STORE_NAME, "readonly");
      const request = tx.objectStore(TAPE_STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

/** Check for saved tapes and update signals */
export async function checkForSavedTape(): Promise<void> {
  const [loaded, saved] = await Promise.all([
    loadTapeFromStorage(TAPE_KEY_LOADED),
    loadTapeFromStorage(TAPE_KEY_SAVED),
  ]);
  debugState.lastTapeName.value = loaded?.fileName ?? null;
  debugState.lastSavedTapeName.value = saved?.fileName ?? null;
}

/** Wire up tape loading handlers */
export function wireTapeLoadHandlers(app: App): void {
  debugState.onLoadTape.value = async (bytes: Uint8Array, fileName: string) => {
    app.loadTape(bytes);
    await saveTapeToStorage(bytes, fileName, TAPE_KEY_LOADED);
    debugState.lastTapeName.value = fileName;
    debugState.isLoadDialogOpen.value = false;
  };

  debugState.onReplayLastTape.value = async () => {
    const saved = await loadTapeFromStorage(TAPE_KEY_LOADED);
    if (saved) {
      app.loadTape(saved.bytes);
      debugState.isLoadDialogOpen.value = false;
    }
  };

  debugState.onReplayLastSaved.value = async () => {
    const saved = await loadTapeFromStorage(TAPE_KEY_SAVED);
    if (saved) {
      app.loadTape(saved.bytes);
      debugState.isLoadDialogOpen.value = false;
    }
  };

  debugState.onSaveTape.value = async () => {
    if (!app.sim.hasHistory) return;
    const tape = app.sim.saveTape();
    const fileName = `tape-${Date.now()}.bloop`;
    // Persist to IndexedDB for later replay
    await saveTapeToStorage(tape, fileName, TAPE_KEY_SAVED);
    debugState.lastSavedTapeName.value = fileName;
    // Download
    const blob = new Blob([tape], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Check for saved tape on init
  checkForSavedTape();
}
