type VerticalBarProps = {
  value: number;
  max: number;
  side: "left" | "right";
  color?: string;
};

export function VerticalBar({
  value,
  max,
  side,
  color = "#4a9eff",
}: VerticalBarProps) {
  const percentage = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  return (
    <div className={`${side}-bar`}>
      <div className="vertical-bar">
        <div
          className="vertical-bar-fill"
          style={{ height: `${percentage}%`, background: color }}
        />
      </div>
    </div>
  );
}
