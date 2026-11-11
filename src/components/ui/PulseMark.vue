<script setup lang="ts">
/** 品牌母题 Pulse：一条可以缩放的节奏波形，用在品牌区与空状态。 */
withDefaults(defineProps<{width?: number; height?: number; color?: string; stroke?: number}>(), {
  width: 180,
  height: 44,
  color: 'currentColor',
  stroke: 2
});
</script>

<template>
  <svg class="pulse-mark" :width="width" :height="height" viewBox="0 0 180 44" fill="none" aria-hidden="true" focusable="false">
    <path
      d="M0 24h34l7-13 8 26 9-32 9 19h18l6-9 7 18 8-27 8 18h56"
      :stroke="color"
      :stroke-width="stroke"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.pulse-mark {
  display: block;
  overflow: visible;
}
</style>
