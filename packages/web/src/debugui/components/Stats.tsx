import { useSignal, useSignalEffect } from "@preact/signals";
import { debugState } from "../state.ts";

export function Stats() {
  const peer = debugState.peer.value;
  const netStatus = debugState.netStatus.value;

  // Live-updating "time since last packet"
  const lastPacketTime = useSignal<string | null>(null);

  useSignalEffect(() => {
    const p = debugState.peer.value;
    if (!p) {
      lastPacketTime.value = null;
      return;
    }

    const update = () => {
      lastPacketTime.value = (performance.now() - p.lastPacketTime).toFixed(0);
    };
    update();
    const id = setInterval(update, 100);
    return () => clearInterval(id);
  });

  if (!peer) {
    return (
      <div className="stats-panel">
        <h3>Network Stats</h3>
        <p>No peer connected</p>
      </div>
    );
  }

  return (
    <div className="stats-panel">
      <h3>Network Stats - {peer.nickname}</h3>
      <table>
        <tbody>
          <tr>
            <td>Our Peer ID</td>
            <td>{netStatus.ourId}</td>
          </tr>
          <tr>
            <td>Remote Peer ID</td>
            <td>{netStatus.remoteId}</td>
          </tr>
          <tr>
            <td>Advantage</td>
            <td>{peer.seq - peer.ack}</td>
          </tr>
          <tr>
            <td>Current Seq</td>
            <td>{peer.seq}</td>
          </tr>
          <tr>
            <td>Current Ack</td>
            <td>{peer.ack}</td>
          </tr>
          <tr>
            <td>Time since last packet</td>
            <td>{lastPacketTime.value}ms</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
