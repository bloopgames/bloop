<script setup lang="ts">
import { App, start } from "@bloopjs/web";
import { game, makePeer } from "./game";
import { onBeforeUnmount, onMounted } from 'vue';
import { peers } from "./ui";
import { joinRoom } from "./netcode/broker";

let app: App | null = null;

onMounted(async () => {
  const monorepoWasmUrl = new URL("/bloop-wasm/bloop.wasm", window.location.href);
  app = await start({
    game,
    engineWasmUrl: monorepoWasmUrl,
  })

  let udp: RTCDataChannel;

  joinRoom('nope', {
    onPeerIdAssign: (peerId) => {
      console.log(`Assigned peer ID: ${peerId}`);
    },
    onBrokerMessage: (message) => {},
    onMessage(data, reliable) {
      console.log({data, reliable});
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
  })
  app.beforeFrame.subscribe((frame) => {

  });
});

onBeforeUnmount(() => {
  app?.cleanup();
});
</script>

<template>
  <h1>Sup</h1>

  <div v-for="peer in peers" :key="peer.id">
    {{ peer.nickname }}
  </div>
</template>

<style scoped>
</style>
