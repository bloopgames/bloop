<script setup lang="ts">
import { peers } from "../ui.ts"
import { computed } from 'vue';

const peer = computed(() => peers.value[0] || null);
</script>

<template>
  <div v-if="peer" class="stats-panel">
    <h3>Network Stats - {{ peer.nickname }}</h3>
    <table>
      <tr>
        <td>Current Seq</td>
        <td>{{ peer.stats.currentSeq }}</td>
      </tr>
      <tr>
        <td>Current Ack</td>
        <td>{{ peer.stats.currentAck }}</td>
      </tr>
      <tr>
        <td>Time Since Last Packet</td>
        <td>{{ peer.stats.timeSinceLastPacket.toFixed(0) }}ms</td>
      </tr>
      <tr>
        <td>Packets/Second</td>
        <td>{{ peer.stats.packetsPerSecond.toFixed(1) }}</td>
      </tr>
      <tr>
        <td>Avg Packet Delta</td>
        <td>{{ peer.stats.averagePacketDelta.toFixed(1) }}ms</td>
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