import { useSignalEffect } from "@preact/signals";
import { debugState } from "../state.ts";
import { useAutoScroll } from "../hooks/useAutoScroll.ts";
import type { Log } from "../../netcode/logs.ts";

function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const hours = date.getHours() % 12;
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const millis = date.getMilliseconds().toString().padStart(3, "0");
  return `${hours}:${minutes}:${seconds}.${millis}`;
}

export function Logs() {
  const { containerRef, onContentUpdated } = useAutoScroll(80);
  const logs = debugState.logs.value;

  // Trigger auto-scroll when logs change
  useSignalEffect(() => {
    const _ = debugState.logs.value.length;
    onContentUpdated();
  });

  return (
    <ul className="logs-list" ref={containerRef}>
      {logs.map((log: Log, index: number) => (
        <LogEntry key={index} log={log} />
      ))}
    </ul>
  );
}

function LogEntry({ log }: { log: Log }) {
  return (
    <li className={`log ${log.source}`}>
      <div className="contents">
        <h3 className={log.source}>
          <span className="source">{log.source} | </span>
          {log.match_frame != null ? (
            <span className="frame-number">m{log.match_frame} | </span>
          ) : (
            <span className="frame-number">f{log.frame_number} | </span>
          )}
          <span className="timestamp">{formatTimestamp(log.timestamp)}</span>
        </h3>
        <div className="content">
          {log.label && <p>{log.label}</p>}
          {log.json && (
            <pre className="json">{JSON.stringify(log.json, null, 2)}</pre>
          )}
          {log.packet && <div>{log.packet.size} bytes</div>}
        </div>
      </div>
    </li>
  );
}
