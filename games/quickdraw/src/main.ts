import "./style.css";
import { start } from "@bloopjs/web";
import { createApp } from "vue";
import App from "./App.vue";
import { game, makePeer } from "./game";
import { joinRoom } from "./netcode/broker";
import type { Logger, LogOpts } from "./netcode/logs";
import type { PeerId } from "./netcode/protocol";
import { netcode } from "./netcode/transport";
import { logs } from "./ui";

const vueApp = createApp(App);
vueApp.mount("#app");

const monorepoWasmUrl = new URL("/bloop-wasm/bloop.wasm", window.location.href);
const app = await start({
  game,
  engineWasmUrl: monorepoWasmUrl,
  startRecording: false,
});

let udp: RTCDataChannel;

const logger: Logger = {
  log: (log: LogOpts) => {
    logs.value.push({
      ...log,
      timestamp: Date.now(),
      frame_number: app.sim.time.frame,
      severity: "log",
    });
  },
  warn: (log: LogOpts) => {
    logs.value.push({
      ...log,
      timestamp: Date.now(),
      frame_number: app.sim.time.frame,
      severity: "warn",
    });
  },
  error: (log: LogOpts) => {
    logs.value.push({
      ...log,
      timestamp: Date.now(),
      frame_number: app.sim.time.frame,
      severity: "error",
    });
  },
};

netcode.logRtc = (...args: any[]) => {
  logger.log({
    source: "webrtc",
    json: args,
  });
};
netcode.logWs = (...args: any[]) => {
  logger.log({
    source: "ws",
    json: args,
  });
};

const packets = new Map<PeerId, Uint8Array[]>();

let lastSample = 0;
const SAMPLE_RATE = 120; // how many packets to receive before logging

joinRoom("nope", logger, {
  onPeerIdAssign: (peerId) => {
    console.log(`Assigned peer ID: ${peerId}`);
  },
  onBrokerMessage: (message) => {},
  onMessage(peerId, data, reliable) {
    if (!packets.has(peerId)) {
      packets.set(peerId, []);
    }
    packets.get(peerId)!.push(new Uint8Array(data));
    if (lastSample-- <= 0) {
      logger.log({
        source: "webrtc",
        from: peerId,
        reliable,
        packet: {
          size: data.byteLength,
          bytes: new Uint8Array(data),
        },
      });
      lastSample = SAMPLE_RATE;
    }
  },
  onDataChannelClose(peerId, reliable) {
    console.log(`Data channel closed: ${peerId} (reliable: ${reliable})`);
  },
  onDataChannelOpen(peerId, reliable, channel) {
    console.log(`Data channel opened: ${peerId} (reliable: ${reliable})`);
    if (!reliable) {
      udp = channel;
    }
  },
  onPeerConnected(peerId) {
    game.bag.peers.push(makePeer(peerId));
  },
  onPeerDisconnected(peerId) {
    game.bag.peers = game.bag.peers.filter((p) => p.id !== peerId);
  },
});

enum PacketType {
  None = 0,
  Input = 1,
}

app.beforeFrame.subscribe((frame) => {
  for (const [peerId, pkts] of packets) {
    for (const packet of pkts) {
      // console.log({ peerId });
    }
  }
  packets.clear();
});

app.afterFrame.subscribe((frame) => {
  if (!udp) {
    return;
  }
  const packet = new ArrayBuffer(64);
  const dv = new DataView(packet);
  let offset = 0;
  dv.setUint8(0, PacketType.Input); // packet type
  offset += 1;
  dv.setUint32(offset, 62, true); // ack
  offset += 4;
  dv.setUint32(offset, frame, true); // frame number
  offset += 4;

  udp.send(packet.slice(0, offset));
});
