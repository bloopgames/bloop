<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
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
          <span class="frame-number">f{{ log.frame_number }} | </span>
          <span class="timestamp">{{ formatTimestamp(log.timestamp) }}</span>
        </h3>
        <div class="content">
          <p v-if="log.label">{{ log.label }}</p>
          <pre v-if="log.json" class="json">{{ log.json }}</pre>
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
</style>