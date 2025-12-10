import { useRef, useEffect } from "preact/hooks";
import { debugState } from "../state.ts";
import { Stats } from "./Stats.tsx";
import { Logs } from "./Logs.tsx";
import { DebugToggle } from "./DebugToggle.tsx";

type RootProps = {
  canvas: HTMLCanvasElement;
  hotkey?: string;
};

export function Root({ canvas, hotkey = "Escape" }: RootProps) {
  const isVisible = debugState.isVisible.value;

  return (
    <>
      {isVisible ? (
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
      ) : (
        <main className="fullscreen">
          <GameCanvas canvas={canvas} />
        </main>
      )}
      <DebugToggle hotkey={hotkey} />
    </>
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
