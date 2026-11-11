<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { Plus, TriangleAlert } from 'lucide-vue-next';
import { useTempo } from '../stores/tempo';
import { time, dateKey } from '../composables/date';
import { onDay, labels } from '../services/booking';
import { availableSlots, availabilityError, dayWindows } from '../services/availability';
import { bookingLanes } from '../services/calendar';
import { toneOf } from '../services/courseColors';
import { StatusBadge } from './ui';

const props = defineProps<{day: string; compact?: boolean; startHour: number; endHour: number; now: number}>();
const store = useTempo();
const router = useRouter();

const start = computed(() => new Date(props.day + `T${String(props.startHour).padStart(2, '0')}:00:00`).getTime());
const end = computed(() => {
  const d = new Date(props.day + 'T00:00:00');
  d.setHours(props.endHour);
  return d.getTime();
});
const height = computed(() => (props.endHour - props.startHour) * (props.compact ? 48 : 84));
const bookings = computed(() => store.data.bookings.filter(b => b.status !== 'cancelled' && onDay(b, props.day)));
const lanes = computed(() => bookingLanes(bookings.value));
const windows = computed(() => dayWindows(store.data.availability, props.day));
const slots = computed(() => (props.compact ? [] : availableSlots(store.data, props.day, 60)));

function percent(t: number) {
  return Math.max(0, Math.min(100, ((t - start.value) / (end.value - start.value)) * 100));
}
function place(a: number, b: number) {
  return {top: percent(a) + '%', height: percent(b) - percent(a) + '%'};
}
function create(t: string) {
  router.push({path: '/create', query: {date: props.day, time: t, view: props.compact ? 'week' : 'day'}});
}
/** 课程卡片的浅底与深字，只由课程类型决定。 */
function toneVars(id: string) {
  const tone = toneOf(store.data.types.find(t => t.id === id));
  return {'--type-bg': tone.bg, '--type-ink': tone.ink};
}
function studentName(id: string) {
  return store.data.students.find(s => s.id === id)?.name ?? '';
}
function typeName(id: string) {
  return store.data.types.find(t => t.id === id)?.name ?? '';
}
</script>

<template>
  <div class="timeline-column" :class="{'timeline-compact': compact}" :style="{height: height + 'px'}">
    <div v-for="(w, i) in windows" :key="i" class="open-window" :style="place(w.start, w.end)" />
    <div v-for="h in endHour - startHour" :key="h" class="hour-rule" :style="{top: ((h - 1) / (endHour - startHour)) * 100 + '%'}" />

    <button v-for="t in slots" :key="t" class="slot-button" :style="{top: percent(new Date(day + 'T' + t).getTime()) + '%'}" :aria-label="`${t} 排课`" @click="create(t)">
      <span>{{ t }}</span>
      <Plus :size="14" aria-hidden="true" />
    </button>

    <button
      v-for="{booking: b, lane, total} in lanes"
      :key="b.id"
      class="booking timeline-booking"
      :class="{pending: b.status === 'pending', completed: b.status === 'completed', short: Date.parse(b.end_at) - Date.parse(b.start_at) < 45 * 60000}"
      :style="{...place(Date.parse(b.start_at), Date.parse(b.end_at)), left: `calc(${(lane / total) * 100}% + 3px)`, width: `calc(${100 / total}% - 6px)`, ...toneVars(b.course_type_id)}"
      :aria-label="`${time(b.start_at)} ${studentName(b.student_id)} ${typeName(b.course_type_id)} ${labels[b.status]}`"
      @click="router.push('/booking/' + b.id)"
    >
      <div class="booking-title">
        <b>{{ studentName(b.student_id) }}</b>
        <TriangleAlert v-if="availabilityError(store.data, b.start_at, b.end_at, b.id)" :size="13" aria-label="时段异常" class="booking-warn" />
      </div>
      <span class="booking-time">{{ dateKey(new Date(b.start_at)) !== day ? '前日 ' : '' }}{{ time(b.start_at) }}–{{ dateKey(new Date(b.end_at)) !== day ? '次日 ' : '' }}{{ time(b.end_at) }}</span>
      <span v-if="!compact" class="booking-meta">
        <span class="booking-type">{{ typeName(b.course_type_id) }}</span>
        <StatusBadge :status="b.status" />
      </span>
    </button>

    <div v-if="dateKey(new Date(now)) === day && now >= start && now < end" class="now-line" :style="{top: percent(now) + '%'}"><i /></div>
  </div>
</template>
