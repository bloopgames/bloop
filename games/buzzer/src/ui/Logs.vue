<script setup lang="ts">
import {  watch } from 'vue';
import { logs } from '../ui';
import { useAutoScroll } from './useAutoscroll';

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
            {{ log.packet }}
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