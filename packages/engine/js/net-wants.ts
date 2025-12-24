/**
 * NetWants represents the desired network state set by game code.
 * Platform polls this each frame and fulfills the requests.
 *
 * Game code sets these values directly:
 * ```ts
 * update({ net }) {
 *   if (net.status === "local") {
 *     net.wants.roomCode = "ABCD";
 *   }
 * }
 * ```
 *
 * Platform reads and acts on them:
 * ```ts
 * if (sim.net.wants.roomCode) {
 *   initiateJoinRoom(sim.net.wants.roomCode);
 * }
 * ```
 */
export type NetWants = {
  /** Room code to join. Platform initiates join when set. */
  roomCode?: string;
  /** Set to true to disconnect from current room. */
  disconnect?: boolean;
};

/** Create a fresh NetWants object */
export function createNetWants(): NetWants {
  return {};
}
