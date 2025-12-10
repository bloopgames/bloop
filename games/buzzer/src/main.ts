import "./style.css";
import {
  logger,
  type PeerId,
  start,
  addLog,
  addPeer,
  updatePeer,
  removePeer,
  setLocalId,
  setRemoteId,
  debugState,
} from "@bloopjs/web";
import { game } from "./game";
import { createRenderer } from "./render";

// Parse URL params for netcode options
const urlParams = new URLSearchParams(window.location.search);
const artificialLag = parseInt(urlParams.get("lag") || "0", 10);
if (artificialLag > 0) {
  console.log(`[netcode] Artificial lag enabled: ${artificialLag}ms`);
}

// In dev, vite serves wasm from /bloop-wasm/. In prod, it's bundled at ./bloop.wasm
const wasmUrl = import.meta.env.DEV
  ? new URL("/bloop-wasm/bloop.wasm", window.location.href)
  : new URL("./bloop.wasm", import.meta.url);

const app = await start({
  game,
  engineWasmUrl: wasmUrl,
  startRecording: false,
  debugUi: true,
});

// Get canvas from debug UI and set up renderer
const canvas = app.canvas!;
const render = createRenderer(canvas, game);

// Wire up logger to debug state
logger.onLog = (log) => {
  addLog(log);
};

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
      setLocalId(localPeerId);
      remotePeerId = ids.remote;
      remoteStringPeerId = peerId;
      setRemoteId(remotePeerId);

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
    addPeer({
      id: peerId,
      nickname: peerId.substring(0, 6),
      ack: -1,
      seq: -1,
      lastPacketTime: performance.now(),
    });
    console.log(
      `[netcode] Peer connected: ${peerId}. Total peers: ${debugState.netStatus.value.peers.length}`,
    );
  },
  onPeerDisconnected(peerId) {
    removePeer(peerId);
    if (remotePeerId !== null && peerId === remoteStringPeerId) {
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

// Render game after each frame
app.afterFrame.subscribe(() => {
  render();
});

// Initial render
render();

/** Process incoming packets via engine */
function receivePackets() {
  // Process buffered packets
  for (const packetData of incomingPackets) {
    // Let the engine decode and process the packet
    // This updates seq/ack, stores events in RollbackState, etc.
    app.sim.net.receivePacket(packetData);

    if (remotePeerId == null) {
      return;
    }

    // Update peer stats (we can get seq/ack from engine now)
    const peerState = app.sim.net.getPeerState(remotePeerId);
    updatePeer(remoteStringPeerId!, {
      ack: peerState.ack,
      seq: peerState.seq,
      lastPacketTime: performance.now(),
    });
  }
  incomingPackets.length = 0;
}

/** Send packet with local events to remote peer */
function sendPacket() {
  if (!udp || remotePeerId === null) {
    console.warn("[netcode] Cannot send packet, udp or remotePeerId is null");
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
    console.warn("[netcode] No packet to send");
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
