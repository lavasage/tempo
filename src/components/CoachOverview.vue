<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowUpRight, Check, UserPlus, ChevronRight, Clock3, TriangleAlert, CalendarPlus } from 'lucide-vue-next';
import { useTempo } from '../stores/tempo';
import { workbench } from '../services/workbench';
import { dateKey, time } from '../composables/date';
import { PulseMark } from './ui';
import type { Status } from '../types';
import '../styles/workbench.css';

const props = defineProps<{now: number}>();
const emit = defineEmits<{today: []}>();
const store = useTempo();
const error = ref('');
const overview = computed(() => workbench(store.data, new Date(props.now)));

function name(id: string) {
  return store.data.students.find(s => s.id === id)?.name ?? '未知学员';
}
function course(id: string) {
  return store.data.types.find(t => t.id === id)?.name ?? '';
}
function when(start: string) {
  return (dateKey(new Date(start)) === overview.value.today ? '今天' : new Date(start).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric'})) + ' ' + time(start);
}
function change(id: string, status: Status) {
  try {
    store.status(id, status);
    store.notice = status === 'completed' ? '课程已完成' : '预约已确认';
    error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作失败，请重试';
  }
}
</script>

<template>
  <section class="coach-overview" aria-label="今日工作台">
    <div class="overview-hero">
      <PulseMark class="hero-pulse" :width="420" :height="90" color="rgba(213,250,69,.16)" :stroke="2" />

      <div class="hero-metrics">
        <button class="overview-today" @click="emit('today')">
          <span class="metric-label">今日课程</span>
          <span class="metric-value">
            <b data-testid="today-count">{{ overview.todayCount }}</b>
            <em>节</em>
          </span>
          <span v-if="overview.todayPending" class="pending-dot">
            <Clock3 :size="12" aria-hidden="true" />{{ overview.todayPending }} 待确认
          </span>
          <span v-else class="clear-dot"><Check :size="12" aria-hidden="true" />已安排妥当</span>
        </button>

        <dl class="hero-secondary">
          <div>
            <dt>本周</dt>
            <dd><span data-testid="week-count">{{ overview.weekCount }}</span> 节</dd>
          </div>
          <div>
            <dt>本月完成</dt>
            <dd><span data-testid="month-completed">{{ overview.monthCompleted }}</span> 节</dd>
          </div>
        </dl>
      </div>

      <div class="hero-next">
        <div v-if="overview.next" class="next-lesson">
          <RouterLink :to="'/booking/' + overview.next.id" class="next-lesson-link" aria-label="查看下一节课程">
            <span class="next-time">
              <span>{{ overview.ongoing ? '进行中' : '下一节' }}</span>
              <b>{{ when(overview.next.start_at) }}</b>
            </span>
            <span class="next-student">
              <strong>{{ name(overview.next.student_id) }}</strong>
              <small>{{ course(overview.next.course_type_id) }} · {{ time(overview.next.end_at) }} 结束</small>
            </span>
            <ArrowUpRight :size="18" aria-hidden="true" />
          </RouterLink>
          <button v-if="overview.ongoing" class="btn-lime next-complete" @click="change(overview.next.id, 'completed')">
            <Check :size="15" />完成课程
          </button>
        </div>

        <div v-else class="next-empty">
          <span><CalendarPlus :size="17" aria-hidden="true" />今天没有已确认的课程</span>
          <RouterLink to="/create">快速排课 <ChevronRight :size="15" /></RouterLink>
        </div>
      </div>
    </div>

    <div class="workbench-bottom">
      <details v-if="overview.items.length" class="work-items">
        <summary>需要处理 <b>{{ overview.items.length }}</b></summary>
        <div v-for="item in overview.items" :key="item.booking.id" class="work-item">
          <TriangleAlert v-if="item.kind === 'conflict'" :size="15" class="work-icon warn" aria-hidden="true" />
          <Clock3 v-else-if="item.kind === 'pending'" :size="15" class="work-icon pending" aria-hidden="true" />
          <Check v-else :size="15" class="work-icon" aria-hidden="true" />
          <RouterLink :to="'/booking/' + item.booking.id" class="work-main">
            <span>{{ name(item.booking.student_id) }} <small>{{ when(item.booking.start_at) }}</small></span>
            <small :class="{'work-warning': item.kind === 'conflict'}">{{ item.reason }}</small>
          </RouterLink>
          <button v-if="item.kind === 'pending'" class="work-action" @click="change(item.booking.id, 'confirmed')">确认</button>
          <button v-else-if="item.kind === 'unfinished' || (item.kind === 'soon' && Date.parse(item.booking.start_at) <= now)" class="work-action" @click="change(item.booking.id, 'completed')">完成</button>
          <RouterLink v-else class="work-open" :to="'/booking/' + item.booking.id" :aria-label="'查看 ' + name(item.booking.student_id) + ' 的课程'">
            <ChevronRight :size="17" />
          </RouterLink>
        </div>
      </details>
      <span v-else class="work-clear"><Check :size="15" aria-hidden="true" />暂无待处理</span>

      <RouterLink class="add-student-shortcut" to="/students/new"><UserPlus :size="15" />添加学员</RouterLink>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </section>
</template>
