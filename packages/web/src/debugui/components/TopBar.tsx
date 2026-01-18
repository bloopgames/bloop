import { useCallback } from "preact/hooks";
import { debugState } from "../state.ts";

type TopBarProps = {
  leftLabel: string;
  rightLabel: string;
};

export function TopBar({ leftLabel, rightLabel }: TopBarProps) {
  const fps = debugState.fps.value;
  const frameNumber = debugState.frameNumber.value;
  const rtt = debugState.netStatus.value.rtt;
  const isOnline = debugState.netStatus.value.peers.length > 0;

  const stopPropagation = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className="top-bar"
      onMouseDown={stopPropagation}
      onMouseUp={stopPropagation}
      onClick={stopPropagation}
    >
      <span className="top-bar-side-label">{leftLabel}</span>
      <div className="top-bar-center">
        <div className="top-bar-item">
          <span className="top-bar-label">FPS</span>
          <span className="top-bar-value">{fps}</span>
        </div>
        <div className="top-bar-item">
          <span className="top-bar-label">Frame</span>
          <span className="top-bar-value">{frameNumber}</span>
        </div>
        {isOnline && rtt !== null && (
          <div className="top-bar-item">
            <span className="top-bar-label">Ping</span>
            <span className="top-bar-value">{rtt}ms</span>
          </div>
        )}
      </div>
      <span className="top-bar-side-label">{rightLabel}</span>
    </div>
  );
}
