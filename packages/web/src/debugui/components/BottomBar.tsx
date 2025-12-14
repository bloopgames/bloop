type BottomBarProps = {
  tapeUtilization: number; // 0-1, how full the tape is
  playheadPosition: number; // 0-1, current position in tape
  isPlaying: boolean;
};

export function BottomBar({
  tapeUtilization = 0,
  playheadPosition = 0,
  isPlaying = true,
}: BottomBarProps) {
  // Placeholder handlers - behavior not wired up yet
  const handleJumpBack = () => {};
  const handleStepBack = () => {};
  const handlePlayPause = () => {};
  const handleStepForward = () => {};
  const handleJumpForward = () => {};
  const handleSeek = () => {};

  return (
    <div className="bottom-bar">
      <div className="playbar-controls">
        <button className="playbar-btn" onClick={handleJumpBack}>
          {"<<"}
          <span className="tooltip tooltip-left">
            Jump back <kbd>4</kbd>
          </span>
        </button>
        <button className="playbar-btn" onClick={handleStepBack}>
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
        <button className="playbar-btn" onClick={handleStepForward}>
          {">"}
          <span className="tooltip">
            Step forward <kbd>7</kbd>
          </span>
        </button>
        <button className="playbar-btn" onClick={handleJumpForward}>
          {">>"}
          <span className="tooltip">
            Jump forward <kbd>8</kbd>
          </span>
        </button>
      </div>
      <div className="seek-bar" onClick={handleSeek}>
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
