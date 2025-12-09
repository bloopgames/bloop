<script setup lang="ts">
import type { Peer } from '@/ui';

const props = defineProps<{
  peer: Peer
}>();

</script>

<template>
  <span>{{ props.peer.nickname ?? props.peer.id.substring(0,6) }}</span>
</template>