import { useRef, useEffect } from "preact/hooks";
import { debugState } from "../state.ts";
import { Stats } from "./Stats.tsx";
import { Logs } from "./Logs.tsx";
import { DebugToggle } from "./DebugToggle.tsx";
import { TopBar } from "./TopBar.tsx";
import { VerticalBar } from "./VerticalBar.tsx";
import { BottomBar } from "./BottomBar.tsx";

type RootProps = {
  canvas: HTMLCanvasElement;
  hotkey?: string;
};

export function Root({ canvas, hotkey = "Escape" }: RootProps) {
  const layoutMode = debugState.layoutMode.value;

  if (layoutMode === "off") {
    return (
      <>
        <main className="fullscreen">
          <GameCanvas canvas={canvas} />
        </main>
        <DebugToggle hotkey={hotkey} />
      </>
    );
  }

  if (layoutMode === "letterboxed") {
    return (
      <>
        <LetterboxedLayout canvas={canvas} />
        <DebugToggle hotkey={hotkey} />
      </>
    );
  }

  // Full layout (netcode debug)
  return (
    <>
      <main className="layout">
        <section className="game">
          <GameCanvas canvas={canvas} />
        </section>
        <section className="stats">
          <Stats />
        </section>
        <section className="logs">
          <Logs />
        </section>
      </main>
      <DebugToggle hotkey={hotkey} />
    </>
  );
}

function LetterboxedLayout({ canvas }: { canvas: HTMLCanvasElement }) {
  const isOnline = debugState.netStatus.value.peers.length > 0;
  const advantage = debugState.advantage.value ?? 0;
  const frameTime = debugState.frameTime.value;
  const snapshotSize = debugState.snapshotSize.value;

  // Left bar: frame advantage (online) or frame time % (offline)
  const leftValue = isOnline ? Math.abs(advantage) : frameTime;
  const leftMax = isOnline ? 10 : 16.67; // 10 frames advantage or 16.67ms budget
  const leftLabel = isOnline ? "ADV" : "MS";
  const leftColor = isOnline
    ? advantage >= 0
      ? "#4a9eff"
      : "#ff4a4a"
    : frameTime > 16.67
      ? "#ff4a4a"
      : "#4aff4a";

  // Right bar: rollback depth (online) or snapshot size (offline)
  // For now, we don't have rollback depth exposed, so use a placeholder
  const rightValue = isOnline ? 0 : snapshotSize;
  const rightMax = isOnline ? 10 : 10000; // 10 frames rollback or 10KB
  const rightLabel = isOnline ? "RB" : "KB";

  return (
    <main className="layout-letterboxed">
      <TopBar leftLabel={leftLabel} rightLabel={rightLabel} />
      <VerticalBar
        value={leftValue}
        max={leftMax}
        side="left"
        color={leftColor}
      />
      <div className="letterboxed-game">
        <GameCanvas canvas={canvas} />
      </div>
      <VerticalBar
        value={rightValue}
        max={rightMax}
        side="right"
      />
      <BottomBar tapeUtilization={0.67} playheadPosition={0.8} isPlaying={true} />
    </main>
  );
}

function GameCanvas({ canvas }: { canvas: HTMLCanvasElement }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container && !container.contains(canvas)) {
      container.appendChild(canvas);
    }

    return () => {
      // Don't remove canvas on cleanup - it may need to persist
    };
  }, [canvas]);

  return <div className="canvas-container" ref={containerRef} />;
}
