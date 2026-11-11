<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ChevronLeft, ChevronRight, Plus, SlidersHorizontal, TriangleAlert, CalendarPlus } from 'lucide-vue-next';
import TrainingStats from '../components/TrainingStats.vue';
import CoachOverview from '../components/CoachOverview.vue';
import { useNow } from '../composables/useNow';
import CalendarTimeline from '../components/CalendarTimeline.vue';
import { useTempo } from '../stores/tempo';
import { dateKey, shift, time } from '../composables/date';
import { onDay } from '../services/booking';
import { availabilityError, dayWindows } from '../services/availability';
import { validDay, weekDays, monthDays, moveMonth } from '../services/calendar';
import { toneOf } from '../services/courseColors';
import '../styles/calendar.css';

const store = useTempo();
const router = useRouter();
const route = useRoute();
type Mode = 'day' | 'week' | 'month';

const date = ref(validDay(route.query.date));
const mode = ref<Mode>(['day', 'week', 'month'].includes(String(route.query.view)) ? (route.query.view as Mode) : 'day');
const now = useNow();

watch([date, mode], () => router.replace({path: '/', query: {date: date.value, view: mode.value}}));
watch(
  () => route.query.date,
  v => {
    // 抽屉作为子路由时 path 不是 '/'，仍要跟随课表 query。
    if (v) date.value = validDay(v);
  }
);

const today = computed(() => dateKey(new Date(now.value)));
const days = computed(() => (mode.value === 'week' ? weekDays(date.value) : [date.value]));
const month = computed(() => monthDays(date.value));
const bookings = (day: string) =>
  store.data.bookings.filter(b => onDay(b, day)).sort((a, b) => a.start_at.localeCompare(b.start_at));
const active = (day: string) => bookings(day).filter(b => b.status !== 'cancelled');
const selected = computed(() => active(date.value));
const cancelled = computed(() => bookings(date.value).filter(b => b.status === 'cancelled'));
const anomalies = computed(() => selected.value.filter(b => availabilityError(store.data, b.start_at, b.end_at, b.id)));

const bounds = computed(() => {
  let start = 8,
    end = 21;
  for (const day of days.value) {
    for (const w of dayWindows(store.data.availability, day)) {
      start = Math.min(start, new Date(w.start).getHours());
      const d = new Date(w.end);
      end = Math.max(end, dateKey(d) !== day ? 24 : d.getHours() + Number(d.getMinutes() > 0));
    }
    for (const b of active(day)) {
      start = Math.min(start, dateKey(new Date(b.start_at)) !== day ? 0 : new Date(b.start_at).getHours());
      const d = new Date(b.end_at);
      end = Math.max(end, dateKey(d) !== day ? 24 : d.getHours() + Number(d.getMinutes() > 0));
    }
  }
  return {start, end};
});

const heading = computed(() => new Date(date.value + 'T12:00').toLocaleDateString('zh-CN', {year: 'numeric', month: 'long'}));
const caption = computed(() => {
  if (mode.value === 'day')
    return new Date(date.value + 'T12:00').toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'});
  if (mode.value === 'week') return `${days.value[0]!.slice(5).replace('-', '/')} – ${days.value[6]!.slice(5).replace('-', '/')}`;
  return heading.value;
});

function changeDate(event: Event) {
  date.value = validDay((event.target as HTMLInputElement).value);
}
function changeMonth(event: Event) {
  date.value = validDay((event.target as HTMLInputElement).value + '-01');
}
function move(n: number) {
  date.value = mode.value === 'month' ? moveMonth(date.value, n) : shift(date.value, n * (mode.value === 'week' ? 7 : 1));
}
function openDay(day: string) {
  date.value = day;
  mode.value = 'day';
}
/** 月视图的小圆点用同一套类型色的深色端，保证与日/周视图同源。 */
function toneVars(id: string) {
  return {'--type-ink': toneOf(store.data.types.find(t => t.id === id)).ink};
}
function create() {
  router.push({path: '/create', query: {date: date.value, view: mode.value}});
}
</script>

<template>
  <div class="page calendar-page">
    <header class="calendar-heading">
      <div>
        <span class="eyebrow"><span class="dot" aria-hidden="true" />训练日程</span>
        <h1>课表</h1>
        <span class="calendar-month">{{ heading }}</span>
      </div>
      <div class="heading-actions">
        <RouterLink class="icon-button" to="/availability" aria-label="时间设置">
          <SlidersHorizontal :size="18" />
        </RouterLink>
        <button class="primary" @click="create"><Plus :size="17" /><span>排课</span></button>
      </div>
    </header>

    <CoachOverview :now="now" @today="openDay(today)" />

    <div class="calendar-toolbar">
      <div class="segmented" role="group" aria-label="课表视图">
        <button v-for="v in ([['day', '日'], ['week', '周'], ['month', '月']] as const)" :key="v[0]" :class="{selected: mode === v[0]}" :aria-pressed="mode === v[0]" @click="mode = v[0]">
          {{ v[1] }}
        </button>
      </div>

      <div class="calendar-date-nav">
        <button class="icon-button" :aria-label="mode === 'month' ? '上一月' : '上一日或周'" @click="move(-1)">
          <ChevronLeft :size="18" />
        </button>
        <input v-if="mode === 'month'" aria-label="选择月份" type="month" :value="date.slice(0, 7)" @change="changeMonth" />
        <input v-else aria-label="选择日期" type="date" :value="date" @change="changeDate" />
        <button class="icon-button" :aria-label="mode === 'month' ? '下一月' : '下一日或周'" @click="move(1)">
          <ChevronRight :size="18" />
        </button>
        <button class="today-button" @click="date = today">今天</button>
      </div>
    </div>

    <div class="calendar-caption">
      <div class="caption-main">
        <span class="caption-date">{{ caption }}</span>
        <div v-if="mode === 'day' && date !== today" class="day-counts">
          <span>{{ selected.length }} 节课程</span>
          <span v-if="selected.some(b => b.status === 'pending')" class="pending-count">{{ selected.filter(b => b.status === 'pending').length }} 待确认</span>
          <span v-if="selected.some(b => b.status === 'completed')">{{ selected.filter(b => b.status === 'completed').length }} 已完成</span>
        </div>
      </div>
      <div class="calendar-key">
        <span><i class="key-course" />课程</span>
        <span><i class="key-free" />可约</span>
        <span><i class="key-off" />不可约</span>
      </div>
    </div>

    <details v-if="anomalies.length && mode === 'day'" class="calendar-alert">
      <summary><TriangleAlert :size="15" aria-hidden="true" />{{ anomalies.length }} 节课程需调整</summary>
      <RouterLink v-for="b in anomalies" :key="b.id" :to="'/booking/' + b.id">
        {{ time(b.start_at) }} · {{ store.data.students.find(s => s.id === b.student_id)?.name }} — {{ availabilityError(store.data, b.start_at, b.end_at, b.id) }}
      </RouterLink>
    </details>

    <div v-if="mode !== 'month'" class="schedule-board" :class="{'week-board': mode === 'week'}">
      <div class="board-head">
        <span />
        <button
          v-for="day in days"
          :key="day"
          :class="{'is-today': day === today, 'is-selected': day === date}"
          :aria-label="`查看 ${day} 课表`"
          @click="openDay(day)"
        >
          <span class="weekday">{{ ['日', '一', '二', '三', '四', '五', '六'][new Date(day + 'T12:00').getDay()] }}</span>
          <b>{{ Number(day.slice(-2)) }}</b>
          <small>{{ active(day).length }} 节</small>
        </button>
      </div>
      <div class="board-scroll">
        <div class="board-body">
          <div class="time-gutter" :style="{height: (bounds.end - bounds.start) * (mode === 'week' ? 48 : 84) + 'px'}">
            <span v-for="h in bounds.end - bounds.start" :key="h" :style="{top: (h - 1) / (bounds.end - bounds.start) * 100 + '%'}">
              {{ String(bounds.start + h - 1).padStart(2, '0') }}:00
            </span>
          </div>
          <CalendarTimeline
            v-for="day in days"
            :key="day"
            :day="day"
            :compact="mode === 'week'"
            :start-hour="bounds.start"
            :end-hour="bounds.end"
            :now="now"
          />
        </div>
      </div>
    </div>

    <div v-else class="month-board">
      <div class="month-weekdays"><span v-for="d in ['一', '二', '三', '四', '五', '六', '日']" :key="d">{{ d }}</span></div>
      <div class="month-grid">
        <button
          v-for="day in month"
          :key="day"
          :class="{'outside-month': day.slice(0, 7) !== date.slice(0, 7), 'is-today': day === today, 'is-selected': day === date}"
          :aria-label="`${day} ${active(day).length} 节课程`"
          @click="openDay(day)"
        >
          <b>{{ Number(day.slice(-2)) }}</b>
          <span v-if="active(day).length">{{ active(day).length }} 节</span>
          <div class="month-dots"><i v-for="b in active(day).slice(0, 3)" :key="b.id" :class="{pending: b.status === 'pending'}" :style="toneVars(b.course_type_id)" /></div>
        </button>
      </div>
    </div>

    <details v-if="cancelled.length && mode === 'day'" class="cancelled-list">
      <summary>已取消 · {{ cancelled.length }}</summary>
      <RouterLink v-for="b in cancelled" :key="b.id" class="booking cancelled-booking" :to="'/booking/' + b.id">
        {{ time(b.start_at) }} · {{ store.data.students.find(s => s.id === b.student_id)?.name }}
        <span class="cancelled-tag">已取消</span>
      </RouterLink>
    </details>

    <details class="calendar-review">
      <summary><CalendarPlus :size="15" aria-hidden="true" />训练回顾</summary>
      <TrainingStats />
    </details>

    <RouterView />
  </div>
</template>
