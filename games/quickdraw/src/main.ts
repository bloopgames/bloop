import { start } from "@bloopjs/web";
import { createApp } from "vue";
import App from "./App.vue";
import { game, makePeer } from "./game";
import { joinRoom } from "./netcode/broker";

const vueApp = createApp(App);
vueApp.mount("#app");

const monorepoWasmUrl = new URL("/bloop-wasm/bloop.wasm", window.location.href);
const app = await start({
  game,
  engineWasmUrl: monorepoWasmUrl,
});

let udp: RTCDataChannel;

joinRoom("nope", {
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
