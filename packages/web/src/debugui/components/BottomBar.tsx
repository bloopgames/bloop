import { useRef, useCallback } from "preact/hooks";
import { debugState } from "../state.ts";
import { LoadTapeDialog } from "./LoadTapeDialog.tsx";

// Simple SVG icons for playbar
const iconProps = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "currentColor" };

const Icons = {
  jumpBack: (
    <svg {...iconProps}>
      <path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z" />
    </svg>
  ),
  stepBack: (
    <svg {...iconProps}>
      <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
    </svg>
  ),
  play: (
    <svg {...iconProps}>
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  pause: (
    <svg {...iconProps}>
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
    </svg>
  ),
  stepForward: (
    <svg {...iconProps}>
      <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
    </svg>
  ),
  jumpForward: (
    <svg {...iconProps}>
      <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
    </svg>
  ),
  save: (
    <svg {...iconProps}>
      <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z" />
    </svg>
  ),
  load: (
    <svg {...iconProps}>
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  ),
};

/** Hook that returns handlers for repeat-on-hold behavior with initial debounce */
function useRepeatOnHold(action: () => void) {
  const rafId = useRef<number | null>(null);
  const timeoutId = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startRepeat = useCallback(() => {
    // Fire immediately on first press
    action();

    // Wait 300ms before starting repeat
    timeoutId.current = setTimeout(() => {
      const repeat = () => {
        action();
        rafId.current = requestAnimationFrame(repeat);
      };
      rafId.current = requestAnimationFrame(repeat);
    }, 300);
  }, [action]);

  const stopRepeat = useCallback(() => {
    if (timeoutId.current !== null) {
      clearTimeout(timeoutId.current);
      timeoutId.current = null;
    }
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }, []);

  return {
    onMouseDown: startRepeat,
    onMouseUp: stopRepeat,
    onMouseLeave: stopRepeat,
  };
}

/** Hook for seek bar drag behavior */
function useSeekDrag(onSeek: (ratio: number) => void) {
  const isDragging = useRef(false);
  const targetRef = useRef<HTMLElement | null>(null);

  const getRatio = (clientX: number, target: HTMLElement) => {
    const rect = target.getBoundingClientRect();
    const clickX = clientX - rect.left;
    return Math.max(0, Math.min(1, clickX / rect.width));
  };

  const handleMouseDown = useCallback(
    (e: { currentTarget: EventTarget; clientX: number }) => {
      const target = e.currentTarget as HTMLElement;
      isDragging.current = true;
      targetRef.current = target;
      onSeek(getRatio(e.clientX, target));

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (isDragging.current && targetRef.current) {
          onSeek(getRatio(moveEvent.clientX, targetRef.current));
        }
      };

      const handleMouseUp = () => {
        isDragging.current = false;
        targetRef.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [onSeek],
  );

  return { onMouseDown: handleMouseDown };
}

export function BottomBar() {
  const isPlaying = debugState.isPlaying.value;
  const isRecording = debugState.isRecording.value;
  const isReplaying = debugState.isReplaying.value;
  const tapeUtilization = debugState.tapeUtilization.value;
  const playheadPosition = debugState.playheadPosition.value;

  const handleJumpBack = useCallback(() => {
    debugState.onJumpBack.value?.();
  }, []);

  const handleStepBack = useCallback(() => {
    debugState.onStepBack.value?.();
  }, []);

  const handlePlayPause = useCallback(() => {
    debugState.onPlayPause.value?.();
  }, []);

  const handleStepForward = useCallback(() => {
    debugState.onStepForward.value?.();
  }, []);

  const handleJumpForward = useCallback(() => {
    debugState.onJumpForward.value?.();
  }, []);

  const jumpBackRepeat = useRepeatOnHold(handleJumpBack);
  const stepBackRepeat = useRepeatOnHold(handleStepBack);
  const stepForwardRepeat = useRepeatOnHold(handleStepForward);
  const jumpForwardRepeat = useRepeatOnHold(handleJumpForward);

  const handleSeek = useCallback((ratio: number) => {
    debugState.onSeek.value?.(ratio);
  }, []);

  const seekDrag = useSeekDrag(handleSeek);

  const handleLoadTapeClick = useCallback(() => {
    debugState.isLoadDialogOpen.value = true;
  }, []);

  const handleSaveTapeClick = useCallback(() => {
    debugState.onSaveTape.value?.();
  }, []);

  return (
    <div className="bottom-bar">
      <div className="playbar-controls">
        {isRecording && (
          <span className="recording-indicator" title="Recording">
            <span className="recording-dot" />
            <span className="recording-label">REC</span>
          </span>
        )}
        {isReplaying && (
          <span className="replay-indicator" title="Replaying tape">
            REPLAY
          </span>
        )}
        <button className="playbar-btn jump-back" {...jumpBackRepeat}>
          {Icons.jumpBack}
          <span className="tooltip tooltip-left">
            Jump back <kbd>4</kbd>
          </span>
        </button>
        <button className="playbar-btn step-back" {...stepBackRepeat}>
          {Icons.stepBack}
          <span className="tooltip">
            Step back <kbd>5</kbd>
          </span>
        </button>
        <button className="playbar-btn play-pause" onClick={handlePlayPause}>
          {isPlaying ? Icons.pause : Icons.play}
          <span className="tooltip">
            {isPlaying ? "Pause" : "Play"} <kbd>6</kbd>
          </span>
        </button>
        <button className="playbar-btn step-forward" {...stepForwardRepeat}>
          {Icons.stepForward}
          <span className="tooltip">
            Step forward <kbd>7</kbd>
          </span>
        </button>
        <button className="playbar-btn jump-forward" {...jumpForwardRepeat}>
          {Icons.jumpForward}
          <span className="tooltip">
            Jump forward <kbd>8</kbd>
          </span>
        </button>
        <button className="playbar-btn save-tape-btn" onClick={handleSaveTapeClick}>
          {Icons.save}
          <span className="btn-label">Save</span>
          <span className="tooltip">
            Save tape <kbd>Cmd+S</kbd>
          </span>
        </button>
        <button className="playbar-btn load-tape-btn" onClick={handleLoadTapeClick}>
          {Icons.load}
          <span className="btn-label">Load</span>
          <span className="tooltip">Load tape</span>
        </button>
      </div>
      <div className="seek-bar" {...seekDrag}>
        <div
          className="seek-bar-fill"
          style={{ width: `${tapeUtilization * 100}%` }}
        />
        {tapeUtilization > 0 && (
          <div
            className="seek-bar-position"
            style={{ left: `${playheadPosition * tapeUtilization * 100}%` }}
          />
        )}
      </div>
      <LoadTapeDialog />
    </div>
  );
}
