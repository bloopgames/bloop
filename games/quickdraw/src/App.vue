<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import Game from "./ui/Game.vue";
import Stats from "./ui/Stats.vue";
import Logs from "./ui/Logs.vue";

// Check if debug parameter is in URL
const urlParams = new URLSearchParams(window.location.search);
const debug = ref(urlParams.has('debug'));

function handleKeydown(event: KeyboardEvent) {
  // Toggle debug on Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux)
  // if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
  if (event.key === 'Escape') {
    debug.value = !debug.value;
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <main v-if="debug" class="acne layout debug">
    <section class="game placeholder">
      <Game />
    </section>
    <section class="stats">
      <Stats />
    </section>
    <section class="logs">
      <Logs />
    </section>
  </main>
  <main v-else class="fullscreen">
    <Game />
  </main>
</template>

<style scoped>
.fullscreen {
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.layout {
  display: grid;
  grid-template-areas:
    "game stats"
    "logs logs";
  grid-template-columns: calc(50vw - 1.5rem) calc(50vw - 1.5rem);
  grid-template-rows: calc(50vh - 1.5rem) calc(50vh - 1.5rem);
  gap: 1rem;
  height: 100vh;
  padding: 1rem;
  box-sizing: border-box;
}

.game {
  grid-area: game;
  border-radius: 8px;
  overflow: hidden;
}

.stats {
  grid-area: stats;
  background-color: #f0f0f0;
  padding: 1rem;
  border-radius: 8px;
}

.logs {
  grid-area: logs;
  background-color: #f0f0f0;
  padding: 1rem;
  border-radius: 8px;
}

.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
</style>
