<script setup lang="ts">
import {  watch } from 'vue';
import { logs } from '../ui';
import { useAutoScroll } from './useAutoscroll';
import { decodeInputPacket } from '../netcode/inputs';
import { Enums } from '@bloopjs/engine';
import { Util } from '@bloopjs/bloop';

function formatTimestamp(ms: number): string {
  const date = new Date(ms);

  const hours = date.getHours() % 12;
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const millis = date.getMilliseconds().toString().padStart(3, "0");

  return `${hours}:${minutes}:${seconds}.${millis}`;
}

const { container, onContentUpdated } = useAutoScroll(80);

watch(() => logs.value.length, () => {
  onContentUpdated();
})

function formatPacketType(bytes: Uint8Array | undefined): string {
  if (!bytes) return "N/A";
  const typeByte = bytes[0];
  switch (typeByte) {
    case 1: return "Inputs";
    default: return `Unknown (${typeByte})`;
  }
}

function formatAck(bytes: Uint8Array | undefined): number | string {
  if (!bytes) return "N/A";
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dv.getUint32(5, true);
}

function formatHeader(bytes: Uint8Array | undefined): string {
  if (!bytes) return "N/A";
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const [seq, ack] = [
    dv.getUint32(1, true),
    dv.getUint32(5, true),
  ];

  return `adv=${ack - seq} seq=${seq} ack=${ack}`
}

const eventTypeNames: Record<number, string> = {
  0: "None",
  1: "KeyDown",
  2: "KeyUp",
  3: "MouseMove",
  4: "MouseDown",
  5: "MouseUp",
  6: "MouseWheel",
};

function formatEventType(eventType: number): string {
  return eventTypeNames[eventType] || `Unknown(${eventType})`;
}

function formatEventPayload(eventType: number, payload: Uint8Array): string {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);

  if (eventType === 3) { // MouseMove
    const x = dv.getFloat32(0, true);
    const y = dv.getFloat32(4, true);
    return `(${x.toFixed(1)}, ${y.toFixed(1)})`;
  }
  if (eventType === 6) { // MouseWheel
    const deltaX = dv.getFloat32(0, true);
    const deltaY = dv.getFloat32(4, true);
    return `(${deltaX.toFixed(1)}, ${deltaY.toFixed(1)})`;
  }
  // For key/button events, just show the first byte

  const buttonCode = Util.unwrap(payload[0], "Missing button code in payload");

  if (eventType === 1 || eventType === 2) {
    return Enums.Key[buttonCode] || `Unknown Key(${buttonCode})`;
  }
  if (eventType === 4 || eventType === 5) {
    return Enums.MouseButton[buttonCode] || `Unknown Button(${buttonCode})`;
  }
}
</script>

<template>
  <ul ref="container">
    <li v-for="(log, index) in logs" :key="index" class="log" :class="log.source">
      <div class="contents">
        <h3 :class="{ [log.source]: true}">
          <span class="source">{{ log.source }} | </span>
          <span class="frame-number" v-if="!!log.match_frame">m{{ log.match_frame}} | </span>
          <span class="frame-number" v-else>f{{ log.frame_number}} | </span>
          <span class="timestamp">{{ formatTimestamp(log.timestamp) }}</span>
        </h3>
        <div class="content">
          <p v-if="log.label">{{ log.label }}</p>
          <pre v-if="log.json" class="json">{{ log.json }}</pre>
          <div v-if="log.packet">
            <table v-if="log.packet.bytes" class="events-table">
              <tr>
                <th>Frame</th>
                <th>Event Type</th>
                <th>Payload</th>
              </tr>
              <tr>
                <td>--</td>
                <td>Header</td>
                <td>{{ formatHeader(log.packet?.bytes)}}</td>
              </tr>
              <tr v-for="(event, idx) in decodeInputPacket(log.packet.bytes)?.events || []" :key="idx">
                <td>{{ event.frame }}</td>
                <td>{{ formatEventType(event.eventType) }}</td>
                <td>{{ formatEventPayload(event.eventType, event.payload) }}</td>
              </tr>
            </table>
          </div>
        </div>
      </div>
    </li>
  </ul>
</template>

<style scoped>
ul {
  width: 94%;
  height: 100%;
  overflow: auto;
}

li {
  margin: 0 0 24px 0;
  list-style: none;
}

h3 {
  font-size: 16px;
  font-weight: 500;
}

.ws {
  color: darkolivegreen;
}

.webrtc {
  color: darkmagenta;
}

.content {
  font-size: 16px;
}

pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  background-color: oldlace;
  padding: 8px;
  border-radius: 4px;
  border: 1px inset lavender;
}

.events-table {
  margin-top: 8px;
  border-collapse: collapse;
  width: 100%;
  font-size: 14px;
  background-color: white;
}

.events-table th,
.events-table td {
  border: 1px solid #ddd;
  padding: 6px 8px;
  text-align: left;
}

.events-table th {
  background-color: #f0f0f0;
  font-weight: 600;
}

.events-table tr:hover {
  background-color: #f9f9f9;
}
</style>