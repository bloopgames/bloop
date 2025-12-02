<script setup lang="ts">
import { peers } from "./ui";
import Game from "./ui/Game.vue";
import Stats from "./ui/Stats.vue";
import Logs from "./ui/Logs.vue";
</script>

<template>
  <main class="acne layout">
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
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-areas:
    "game stats"
    "logs logs";
  grid-template-columns: 50vw 50vw;
  grid-template-rows: 50vh 50vh;
  gap: 1rem;
  height: 100vh;
  padding: 1rem;
}

.game {
  grid-area: game;
  background-color: #f0f0f0;
  padding: 1rem;
  border-radius: 8px;
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
