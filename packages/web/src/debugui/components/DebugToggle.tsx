import { cycleLayout, debugState } from "../state.ts";

type DebugToggleProps = {
  hotkey?: string;
};

export function DebugToggle({ hotkey = "Escape" }: DebugToggleProps) {
  const isVisible = debugState.isVisible.value;

  return (
    <button
      className="debug-toggle"
      onClick={cycleLayout}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      title={isVisible ? `Hide debug (${hotkey})` : `Show debug (${hotkey})`}
    >
      {isVisible ? "\u2715" : "\u2699"}
    </button>
  );
}
