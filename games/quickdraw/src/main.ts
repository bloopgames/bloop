import "./style.css";
import { logger, type PeerId, start } from "@bloopjs/web";
import { createApp } from "vue";
import App from "./App.vue";
import { connectedPeers, game, makePeer, peerStats } from "./game";
import { logs, remotePeerId as opponentPeerId, ourPeerId } from "./ui";

const vueApp = createApp(App);
vueApp.mount("#app");

// Parse URL params for netcode options
const urlParams = new URLSearchParams(window.location.search);
const artificialLag = parseInt(urlParams.get("lag") || "0", 10);
if (artificialLag > 0) {
  console.log(`[netcode] Artificial lag enabled: ${artificialLag}ms`);
}

const monorepoWasmUrl = new URL("/bloop-wasm/bloop.wasm", window.location.href);
const app = await start({
  game,
  engineWasmUrl: monorepoWasmUrl,
  startRecording: false,
});

// Set screen dimensions from actual window size
game.bag.screenWidth = window.innerWidth;
game.bag.screenHeight = window.innerHeight;
game.bag.blockX = game.bag.screenWidth / 2; // Re-center the block

let udp: RTCDataChannel | null = null;

// Track session state (minimal - most state is in engine)
let sessionActive = false;
let localPeerId: number | null = null;
let remotePeerId: number | null = null;
let localStringPeerId: PeerId | null = null;
let remoteStringPeerId: PeerId | null = null;

function assignPeerIds(
  localId: PeerId,
  remoteId: PeerId,
): { local: number; remote: number } {
  if (localId < remoteId) {
    return { local: 0, remote: 1 };
  } else {
    return { local: 1, remote: 0 };
  }
}

logger.onLog = (severity, log) => {
  const frame = app.sim.time.frame;
  const matchFrame = app.sim.wasm.get_match_frame();
  logs.value.push({
    ...log,
    timestamp: Date.now(),
    frame_number: frame,
    match_frame: sessionActive ? matchFrame : null,
    severity,
  });
};

game.system("netcode logger", {
  update({ players }) {
    if (players[0]!.mouse.left.down) {
      logger.log({
        source: "local",
        label: "[PlayerID=0] Mouse Click",
      });
    }

    if (players[1]!.mouse.left.down) {
      logger.log({
        source: "local",
        label: "[PlayerID=1] Mouse Click",
      });
    }
  },
});

// Buffer incoming packets until we process them in beforeFrame
const incomingPackets: Uint8Array[] = [];

app.joinRoom("nope", {
  onPeerIdAssign: (peerId) => {
    console.log(`Assigned peer ID: ${peerId}`);
    localStringPeerId = peerId;
  },
  onBrokerMessage: (_message) => {},
  onMessage(_peerId, data, _reliable) {
    // Buffer the packet for processing in beforeFrame
    incomingPackets.push(new Uint8Array(data));
  },
  onDataChannelClose(peerId, reliable) {
    console.log(`Data channel closed: ${peerId} (reliable: ${reliable})`);
    if (!reliable && remotePeerId !== null) {
      app.sim.net.disconnectPeer(remotePeerId);
    }
  },
  onDataChannelOpen(peerId, reliable, channel) {
    console.log(`Data channel opened: ${peerId} (reliable: ${reliable})`);
    if (!reliable) {
      udp = channel;

      if (localStringPeerId === null) {
        console.error("[netcode] Local peer ID not assigned yet!");
        return;
      }

      // Assign numeric IDs based on string comparison for consistency
      const ids = assignPeerIds(localStringPeerId, peerId);
      localPeerId = ids.local;
      ourPeerId.value = localPeerId;
      remotePeerId = ids.remote;
      remoteStringPeerId = peerId;
      opponentPeerId.value = ids.remote;
      console.log(
        `[netcode] Local peer: ${localStringPeerId} -> ${localPeerId}`,
      );
      console.log(`[netcode] Remote peer: ${peerId} -> ${remotePeerId}`);

      // Initialize the session in the engine
      // peer_count = 2 for a 2-player game
      app.sim.sessionInit(2);

      // Set up local and remote peers in net state
      app.sim.net.setLocalPeer(localPeerId);
      app.sim.net.connectPeer(remotePeerId);

      sessionActive = true;
      console.log(`[netcode] Session started at frame ${app.sim.time.frame}`);
    }
  },
  onPeerConnected(peerId) {
    console.log(`[netcode] Peer connected: ${peerId}`);
    connectedPeers.push(makePeer(peerId));
    console.log(`[netcode] Total peers: ${connectedPeers.length}`);
  },
  onPeerDisconnected(peerId) {
    const idx = connectedPeers.findIndex((p) => p.id === peerId);
    if (idx !== -1) {
      connectedPeers.splice(idx, 1);
    }
    if (remotePeerId !== null) {
      app.sim.net.disconnectPeer(remotePeerId);
    }
  },
});

// Process packets and send our state each frame
app.beforeFrame.subscribe((_frame) => {
  if (!sessionActive || !udp || remotePeerId === null) {
    return;
  }

  try {
    // Process incoming packets
    receivePackets();

    // Send outbound packet
    sendPacket();
  } catch (e) {
    console.error("Error in beforeFrame:", e);
  }
});

/** Process incoming packets via engine */
function receivePackets() {
  const now = Date.now();

  // Update time since last packet for all peers
  for (const peer of connectedPeers) {
    const stats = peerStats.get(peer.id);
    if (stats && stats.lastPacketTime > 0) {
      stats.timeSinceLastPacket = now - stats.lastPacketTime;
    }
  }

  // Process buffered packets
  for (const packetData of incomingPackets) {
    try {
      // Let the engine decode and process the packet
      // This updates seq/ack, stores events in RollbackState, etc.
      app.sim.net.receivePacket(packetData);

      // Update peer stats (we can get seq/ack from engine now)
      if (remotePeerId !== null && remoteStringPeerId !== null) {
        const peerState = app.sim.net.getPeerState(remotePeerId);
        const stats = peerStats.get(remoteStringPeerId);
        if (stats) {
          stats.currentSeq = peerState.seq;
          stats.currentAck = peerState.ack;

          // Track packet timestamps for rate calculation
          const cutoff = now - 60000;
          stats.packetTimestamps = stats.packetTimestamps.filter(
            (t) => t > cutoff,
          );
          stats.packetTimestamps.push(now);
          stats.packetsPerSecond = stats.packetTimestamps.length / 60;

          // Calculate average delta
          if (stats.packetTimestamps.length > 1) {
            const deltas: number[] = [];
            const timestamps = stats.packetTimestamps;
            for (let i = 1; i < timestamps.length; i++) {
              const current = timestamps[i];
              const previous = timestamps[i - 1];
              if (current !== undefined && previous !== undefined) {
                deltas.push(current - previous);
              }
            }
            if (deltas.length > 0) {
              stats.averagePacketDelta =
                deltas.reduce((a, b) => a + b, 0) / deltas.length;
            }
          }

          stats.lastPacketTime = now;
          stats.timeSinceLastPacket = 0;
        }
      }
    } catch (e) {
      console.warn(`[netcode] Failed to process packet:`, e);
    }
  }
  incomingPackets.length = 0;
}

/** Send packet with local events to remote peer */
function sendPacket() {
  if (!udp || remotePeerId === null) {
    return;
  }

  if (udp.readyState !== "open") {
    console.warn(
      "[netcode] Data channel not open, cannot send packet. readyState=",
      udp.readyState,
    );
    return;
  }

  // Get the outbound packet from the engine
  // This includes all unacked events in the engine's wire format
  const packet = app.sim.net.getOutboundPacket(remotePeerId);

  if (!packet) {
    return;
  }

  if (artificialLag > 0) {
    // Simulate artificial lag by delaying the send
    setTimeout(() => {
      udp!.send(packet);
    }, artificialLag);
  } else {
    // Send immediately
    udp.send(packet);
  }
}
