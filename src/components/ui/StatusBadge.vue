<script setup lang="ts">
import {computed} from 'vue';
import {Clock3, Check, X, CircleDot} from 'lucide-vue-next';
import {labels} from '../../services/booking';
import type {Status} from '../../types';

/** 统一课程状态表达：文字 + 图标 + 颜色三通道，避免只靠颜色区分。 */
const props = withDefaults(defineProps<{status: Status; size?: 'sm' | 'md'}>(), {size: 'sm'});

const icon = computed(() => (props.status === 'pending' ? Clock3 : props.status === 'confirmed' ? CircleDot : props.status === 'completed' ? Check : X));
</script>

<template>
  <span class="status-badge" :class="[`status-${status}`, `size-${size}`]">
    <component :is="icon" :size="size === 'sm' ? 11 : 13" aria-hidden="true" />
    {{ labels[status] }}
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  padding: 2px 7px;
  border-radius: var(--r-pill);
  font-size: 10.5px;
  font-weight: var(--weight-semibold);
  line-height: 1.6;
  white-space: nowrap;
  border: 1px solid transparent;
}

.status-badge.size-md {
  padding: 3px 10px;
  font-size: 11.5px;
}

.status-pending {
  color: var(--warning);
  background: var(--warning-soft);
  border-color: var(--warning-line);
}

.status-confirmed {
  color: var(--success);
  background: var(--success-soft);
  border-color: var(--success-line);
}

.status-completed {
  color: var(--ink-2);
  background: var(--surface-sunken);
  border-color: var(--line);
}

.status-cancelled {
  color: var(--ink-3);
  background: transparent;
  border-color: var(--line-strong);
}
</style>
