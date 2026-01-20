import { debugState } from "../state.ts";
import { Stats } from "./Stats.tsx";
import { Logs } from "./Logs.tsx";
import { DebugToggle } from "./DebugToggle.tsx";
import { TopBar } from "./TopBar.tsx";
import { VerticalBar } from "./VerticalBar.tsx";
import { BottomBar } from "./BottomBar.tsx";

type RootProps = {
  hotkey?: string;
};

export function Root({ hotkey = "Escape" }: RootProps) {
  const layoutMode = debugState.layoutMode.value;

  if (layoutMode === "off") {
    return (
      <>
        <main className="fullscreen">
          <CanvasSlot />
        </main>
        <DebugToggle hotkey={hotkey} />
      </>
    );
  }

  if (layoutMode === "letterboxed") {
    return (
      <>
        <LetterboxedLayout />
        <DebugToggle hotkey={hotkey} />
      </>
    );
  }

  // Full layout (netcode debug)
  return (
    <>
      <main className="layout">
        <section className="game">
          <CanvasSlot />
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

function LetterboxedLayout() {
  const isOnline = debugState.netStatus.value.peers.length > 0;
  const advantage = debugState.advantage.value ?? 0;
  const frameTime = debugState.frameTime.value;
  const snapshotSize = debugState.snapshotSize.value;
  const hmrFlash = debugState.hmrFlash.value;

  // Left bar: frame advantage (online) or frame time (offline)
  const leftValue = isOnline ? Math.abs(advantage) : frameTime;
  const leftMax = isOnline ? 10 : 16.67; // 10 frames advantage or 16.67ms budget
  const leftLabel = isOnline ? "adv" : "time";
  const leftColor = isOnline
    ? advantage >= 0
      ? "#4a9eff"
      : "#ff4a4a"
    : frameTime > 16.67
      ? "#ff4a4a"
      : "#4aff4a";
  const leftDisplayValue = isOnline
    ? `${advantage >= 0 ? "+" : ""}${advantage} frames`
    : `${frameTime.toFixed(1)}ms`;

  // Right bar: rollback depth (online) or snapshot size (offline)
  // For now, we don't have rollback depth exposed, so use a placeholder
  const rightValue = isOnline ? 0 : snapshotSize;
  const rightMax = isOnline ? 10 : 10000; // 10 frames rollback or 10KB
  const rightLabel = isOnline ? "rb" : "size";
  const rightDisplayValue = isOnline
    ? "0 frames"
    : snapshotSize >= 1000
      ? `${(snapshotSize / 1000).toFixed(1)}kb`
      : `${snapshotSize}b`;

  const gameClassName = hmrFlash ? "letterboxed-game hmr-flash" : "letterboxed-game";

  return (
    <main className="layout-letterboxed">
      <TopBar leftLabel={leftLabel} rightLabel={rightLabel} />
      <VerticalBar
        value={leftValue}
        max={leftMax}
        side="left"
        color={leftColor}
        displayValue={leftDisplayValue}
      />
      <div className={gameClassName}>
        <CanvasSlot />
      </div>
      <VerticalBar
        value={rightValue}
        max={rightMax}
        side="right"
        displayValue={rightDisplayValue}
      />
      <BottomBar />
    </main>
  );
}

function CanvasSlot() {
  return (
    <div className="canvas-container">
      <slot />
    </div>
  );
}
