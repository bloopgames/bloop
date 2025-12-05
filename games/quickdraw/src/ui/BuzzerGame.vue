<script setup lang="ts">
import { buzzer } from '../ui';
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { game } from '../game';

const blockSize = 40; // Size of the oscillating block
const container = ref<HTMLElement | null>(null);

// Update game screen dimensions when container resizes
function updateScreenSize() {
  if (container.value) {
    const rect = container.value.getBoundingClientRect();
    game.bag.screenWidth = rect.width;
    game.bag.screenHeight = rect.height;
    // Re-center the block if it's out of bounds
    const minX = game.bag.screenWidth * 0.25;
    const maxX = game.bag.screenWidth * 0.75;
    if (game.bag.blockX < minX || game.bag.blockX > maxX) {
      game.bag.blockX = game.bag.screenWidth / 2;
    }
  }
}

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (container.value) {
    updateScreenSize();
    resizeObserver = new ResizeObserver(updateScreenSize);
    resizeObserver.observe(container.value);
  }
});

onUnmounted(() => {
  if (resizeObserver && container.value) {
    resizeObserver.unobserve(container.value);
    resizeObserver.disconnect();
  }
});

// Compute background color based on phase
const backgroundColor = computed(() => {
  switch (buzzer.value.phase) {
    case 'waiting':
      return '#ff6b6b'; // Red - don't click!
    case 'active':
      return '#51cf66'; // Green - click now!
    case 'won':
      return '#4dabf7'; // Blue - someone won
    case 'lost':
      return '#ff8787'; // Light red - clicked too early
    default:
      return '#868e96'; // Gray
  }
});

// Compute message to display
const message = computed(() => {
  switch (buzzer.value.phase) {
    case 'waiting':
      return 'WAIT...';
    case 'active':
      return 'CLICK NOW!';
    case 'won':
      return `Player ${buzzer.value.winner} WINS!`;
    case 'lost':
      return 'TOO EARLY!';
    default:
      return '';
  }
});
</script>

<template>
  <div ref="container" class="buzzer-game" :style="{ backgroundColor }">
    <!-- Oscillating block -->
    <div
      class="block"
      :style="{
        left: `${buzzer.blockX - blockSize / 2}px`,
        top: `${buzzer.screenHeight / 2 - blockSize / 2}px`,
      }"
    />

    <!-- Game message -->
    <div class="message">{{ message }}</div>

    <!-- Scores -->
    <div class="scores">
      <div class="player1">
        <span class="label">Player 1 (A / Click)</span>
        <span class="score">{{ buzzer.player1Score }}</span>
      </div>
      <div class="player2">
        <span class="label">Player 2 (L)</span>
        <span class="score">{{ buzzer.player2Score }}</span>
      </div>
    </div>

    <!-- Instructions (only show when waiting) -->
    <div v-if="buzzer.phase === 'waiting'" class="instructions">
      Wait for the background to turn green, then click as fast as you can!
    </div>

    <!-- Remote player cursor -->
    <div
      class="remote-cursor"
      :style="{
        left: `${buzzer.remoteCursorX}px`,
        top: `${buzzer.remoteCursorY}px`,
      }"
    />
  </div>
</template>

<style scoped>
.buzzer-game {
  position: relative;
  width: 100%;
  height: 100%;
  transition: background-color 0.3s ease;
  overflow: hidden;
}

.block {
  position: absolute;
  width: 40px;
  height: 40px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: clamp(32px, 8vw, 72px);
  font-weight: bold;
  color: white;
  text-shadow: 0 4px 8px rgba(0, 0, 0, 0.5);
  text-align: center;
  user-select: none;
  white-space: nowrap;
}

.scores {
  position: absolute;
  top: 2%;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: clamp(20px, 5vw, 60px);
  color: white;
  font-size: clamp(16px, 2vw, 24px);
  font-weight: 600;
}

.player1, .player2 {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.label {
  font-size: clamp(12px, 1.5vw, 16px);
  opacity: 0.9;
}

.score {
  font-size: clamp(24px, 4vw, 48px);
  font-weight: bold;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

.instructions {
  position: absolute;
  bottom: 5%;
  left: 50%;
  transform: translateX(-50%);
  color: white;
  font-size: clamp(14px, 1.5vw, 18px);
  text-align: center;
  opacity: 0.8;
  max-width: 90%;
  user-select: none;
}

.remote-cursor {
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background-color: rgba(255, 165, 0, 0.6);
  border: 2px solid rgb(255, 140, 0);
  pointer-events: none;
  transform: translate(-50%, -50%);
  transition: left 0.05s linear, top 0.05s linear;
  z-index: 100;
}
</style>
