import { useCallback } from "preact/hooks";

type VerticalBarProps = {
  value: number;
  max: number;
  side: "left" | "right";
  color?: string;
  displayValue?: string;
};

export function VerticalBar({
  value,
  max,
  side,
  color = "#4a9eff",
  displayValue,
}: VerticalBarProps) {
  const percentage = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  const stopPropagation = useCallback((e: { stopPropagation: () => void }) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className={`${side}-bar`}
      onMouseDown={stopPropagation}
      onMouseUp={stopPropagation}
      onClick={stopPropagation}
    >
      <div className="vertical-bar">
        <div
          className="vertical-bar-fill"
          style={{ height: `${percentage}%`, background: color }}
        />
        {displayValue && (
          <span className={`vertical-bar-popover ${side}`}>{displayValue}</span>
        )}
      </div>
    </div>
  );
}
