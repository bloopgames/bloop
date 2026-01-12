import { unwrap } from "@bloopjs/bloop";
import type { App } from "../App.ts";
import * as Debug from "../debugui/mod.ts";
import { logger } from "./logs.ts";

// State
let udp: RTCDataChannel | null = null;
let localPeerId: number | null = null;
let remotePeerId: number | null = null;
let localStringPeerId: string | null = null;
let remoteStringPeerId: string | null = null;
const incomingPackets: Uint8Array[] = [];

// actual netcode state (vs desired)
const actual = {
  roomCode: "",
};

export async function reconcile(app: App, signal: AbortSignal): Promise<void> {
  // Process packets and send our state each frame
  app.beforeFrame.subscribe((_frame) => {
    // Skip network processing during tape replay
    if (app.sim.isReplaying) return;

    if (!app.game.context.net.isInSession) {
      return;
    }

    try {
      receivePackets(app);
      sendPacket(app);
    } catch (e) {
      console.error("Error in beforeFrame:", e);
    }
  });

  // Wire up logger to debug state
  logger.onLog = (log) => {
    Debug.addLog(log);
  };

  while (!signal.aborted) {
    // Skip room join checks during tape replay
    if (app.sim.isReplaying) {
      await sleep(150);
      continue;
    }

    const { net } = app.game.context;
    if (net.wantsRoomCode && actual.roomCode !== net.wantsRoomCode) {
      console.log("[netcode] wants a room code", {
        actual: actual.roomCode,
        wants: net.wantsRoomCode,
      });
      actual.roomCode = net.wantsRoomCode;
      joinRollbackRoom(net.wantsRoomCode, app);
    }

    await sleep(150);
  }
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function joinRollbackRoom(roomId: string, app: App): void {
  app.joinRoom(roomId, {
    onPeerIdAssign: (peerId) => {
      localStringPeerId = peerId;
    },
    onBrokerMessage: (_message) => {},
    onMessage(_peerId, data, _reliable) {
      incomingPackets.push(new Uint8Array(data));
    },
    onDataChannelClose(_peerId, reliable) {
      if (!reliable && remotePeerId !== null) {
        app.sim.emit.network("peer:leave", { peerId: remotePeerId });
      }
    },
    onDataChannelOpen(peerId, reliable, channel) {
      if (!reliable) {
        udp = channel;

        if (localStringPeerId === null) {
          console.error("[netcode] Local peer ID not assigned yet!");
          return;
        }

        const ids = assignPeerIds(localStringPeerId, peerId);
        localPeerId = ids.local;
        Debug.setLocalId(localPeerId);
        remotePeerId = ids.remote;
        remoteStringPeerId = peerId;
        Debug.setRemoteId(remotePeerId);

        // Set up local and remote peers in net state
        app.sim.emit.network("peer:join", { peerId: localPeerId });
        app.sim.emit.network("peer:join", { peerId: remotePeerId });
        app.sim.emit.network("peer:assign_local_id", { peerId: localPeerId });
        app.sim.emit.network("session:start", {});
      }
    },
    onPeerConnected(peerId) {
      Debug.addPeer({
        id: peerId,
        nickname: peerId.substring(0, 6),
        ack: -1,
        seq: -1,
        lastPacketTime: performance.now(),
      });
      console.log(
        `[netcode] Peer connected: ${peerId}. Total peers: ${Debug.debugState.netStatus.value.peers.length}`,
      );
    },
    onPeerDisconnected(peerId) {
      Debug.removePeer(peerId);
      if (remotePeerId !== null && peerId === remoteStringPeerId) {
        app.sim.emit.network("peer:leave", { peerId: remotePeerId });
        app.sim.emit.network("session:end", {});
      }
    },
  });
}

function assignPeerIds(
  localId: string,
  remoteId: string,
): { local: number; remote: number } {
  if (localId < remoteId) {
    return { local: 0, remote: 1 };
  } else {
    return { local: 1, remote: 0 };
  }
}

function receivePackets(app: App) {
  for (const packetData of incomingPackets) {
    app.sim.emit.packet(packetData);

    if (remotePeerId == null) {
      return;
    }

    const peerState = unwrap(
      app.sim.net.peers[remotePeerId],
      `Remote peer state not found for peerId ${remotePeerId}`,
    );
    Debug.updatePeer(remoteStringPeerId!, {
      ack: peerState.ack,
      seq: peerState.seq,
      lastPacketTime: performance.now(),
    });
  }
  incomingPackets.length = 0;
}

function sendPacket(app: App) {
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

  const packet = app.sim.getOutboundPacket(remotePeerId);

  if (!packet) {
    console.warn("[netcode] No packet to send");
    return;
  }

  udp.send(packet);
}
