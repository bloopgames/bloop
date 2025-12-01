<script setup lang="ts">
import { peers } from "./ui";
</script>

<template>
  <h1>Sup</h1>

  <div v-for="peer in peers" :key="peer.id">
    {{ peer.nickname }}
  </div>
</template>

<style scoped>
</style>
