<script setup lang="ts">
import { peers } from "../ui.ts"
import Nickname from "./Nickname.vue";
</script>

<template>
  <div v-for="peer in peers" :key="peer.id">
    <Nickname :peer="peer" />
  </div>
  <h1>Stats</h1>
</template>