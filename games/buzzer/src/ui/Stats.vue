<script setup lang="ts">
import { netStatus } from "../ui.ts"
import { computed } from 'vue';

const peer = computed(() => netStatus.value.peers[0] || null);

const lastPacketTime = computed(() => {
  if (peer.value) {
    return (performance.now() - peer.value.lastPacketTime).toFixed(0);
  }
  return null;
});
</script>

<template>
  <div v-if="peer" class="stats-panel">
    <h3>Network Stats - {{ peer.nickname }}</h3>
    <table>
      <tr>
        <td>Our Peer ID</td>
        <td>{{ netStatus.ourId }}</td>
      </tr>
      <tr>
        <td>Remote Peer ID</td>
        <td>{{ netStatus.remoteId }}</td>
      </tr>
      <tr>
        <td>Advantage</td>
        <td>{{ (peer.seq - peer.ack) }}</td>
      </tr>
      <tr>
        <td>Current Seq</td>
        <td>{{ peer.seq}}</td>
      </tr>
      <tr>
        <td>Current Ack</td>
        <td>{{ peer.ack }}</td>
      </tr>
      <tr>
        <td>Time since last packet</td>
        <td>{{ lastPacketTime }}ms</td>
      </tr>
    </table>
  </div>
  <div v-else class="stats-panel">
    <h3>Network Stats</h3>
    <p>No peer connected</p>
  </div>
</template>

<style scoped>
.stats-panel {
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 12px;
  border-radius: 8px;
  font-family: monospace;
  font-size: 14px;
  max-width: 100%;
  overflow: hidden;
}

h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

tr {
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

tr:last-child {
  border-bottom: none;
}

td {
  padding: 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

td:first-child {
  opacity: 0.7;
  width: 60%;
}

td:last-child {
  text-align: right;
  font-weight: 600;
  width: 40%;
}

p {
  margin: 0;
  opacity: 0.7;
}
</style>