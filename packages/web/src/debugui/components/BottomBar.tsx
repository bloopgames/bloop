import { useRef, useCallback } from "preact/hooks";
import { debugState } from "../state.ts";

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

  return (
    <div className="bottom-bar">
      <div className="playbar-controls">
        <button className="playbar-btn" {...jumpBackRepeat}>
          {"<<"}
          <span className="tooltip tooltip-left">
            Jump back <kbd>4</kbd>
          </span>
        </button>
        <button className="playbar-btn" {...stepBackRepeat}>
          {"<"}
          <span className="tooltip">
            Step back <kbd>5</kbd>
          </span>
        </button>
        <button className="playbar-btn" onClick={handlePlayPause}>
          {isPlaying ? "||" : ">"}
          <span className="tooltip">
            {isPlaying ? "Pause" : "Play"} <kbd>6</kbd>
          </span>
        </button>
        <button className="playbar-btn" {...stepForwardRepeat}>
          {">"}
          <span className="tooltip">
            Step forward <kbd>7</kbd>
          </span>
        </button>
        <button className="playbar-btn" {...jumpForwardRepeat}>
          {">>"}
          <span className="tooltip">
            Jump forward <kbd>8</kbd>
          </span>
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
    </div>
  );
}
