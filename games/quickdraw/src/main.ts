import "./style.css";
import { start } from "@bloopjs/web";
import { createApp } from "vue";
import App from "./App.vue";
import { game, makePeer } from "./game";
import { joinRoom, type Logger } from "./netcode/broker";
import { netcode } from "./netcode/transport";
import { type Log, type LogOpts, logs } from "./ui";

const vueApp = createApp(App);
vueApp.mount("#app");

const monorepoWasmUrl = new URL("/bloop-wasm/bloop.wasm", window.location.href);
const app = await start({
  game,
  engineWasmUrl: monorepoWasmUrl,
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

joinRoom("nope", logger, {
  onPeerIdAssign: (peerId) => {
    console.log(`Assigned peer ID: ${peerId}`);
  },
  onBrokerMessage: (message) => {},
  onMessage(data, reliable) {
    console.log({ data, reliable });
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
app.beforeFrame.subscribe((frame) => {});
