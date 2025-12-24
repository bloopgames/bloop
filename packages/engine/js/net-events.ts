/**
 * Network event types emitted by the platform and handled by game systems.
 * These events follow the same pattern as input events - platform emits,
 * engine stores in tape, game systems handle via `netcode` handler.
 */

export type NetEventType =
  | "join:ok"
  | "join:fail"
  | "peer:join"
  | "peer:leave"
  | "session:start"
  | "session:end";

export type NetEvent =
  | { type: "join:ok"; data: { roomCode: string } }
  | { type: "join:fail"; data: { reason: string } }
  | { type: "peer:join"; data: { peerId: number } }
  | { type: "peer:leave"; data: { peerId: number } }
  | { type: "session:start"; data: Record<string, never> }
  | { type: "session:end"; data: Record<string, never> };

/** Type guard for NetEvent */
export function isNetEvent(event: unknown): event is NetEvent {
  if (typeof event !== "object" || event === null) return false;
  const e = event as { type?: unknown };
  return (
    e.type === "join:ok" ||
    e.type === "join:fail" ||
    e.type === "peer:join" ||
    e.type === "peer:leave" ||
    e.type === "session:start" ||
    e.type === "session:end"
  );
}
