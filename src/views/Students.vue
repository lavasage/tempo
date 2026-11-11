<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Plus, Search, ChevronRight, ArrowLeft, Pencil, Phone, SlidersHorizontal, X, CalendarPlus, Target, StickyNote, Users } from 'lucide-vue-next';
import TrainingStats from '../components/TrainingStats.vue';
import { StatusBadge, PulseMark } from '../components/ui';
import { useTempo } from '../stores/tempo';
import { labels } from '../services/booking';
import { toneOf } from '../services/courseColors';
import { searchStudents, studentSummary, filterStudentCourses, type CourseFilter, type StudentCourseFilters } from '../services/students';
import { useNow } from '../composables/useNow';
import { time } from '../composables/date';
import '../styles/students.css';

const store = useTempo();
const route = useRoute();
const now = useNow();
const search = ref('');
const showFilters = ref(false);

const selected = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''));
const student = computed(() => store.data.students.find(s => s.id === selected.value && s.coach_id === store.data.coach.id));
const students = computed(() => searchStudents(store.data, search.value));
const rosterCount = computed(() => store.data.students.filter(s => s.coach_id === store.data.coach.id).length);

const filters = ref<StudentCourseFilters>({status: 'all', type: '', from: '', to: ''});
const tabs: {id: CourseFilter; label: string}[] = [
  {id: 'all', label: '全部'},
  {id: 'upcoming', label: '已预约'},
  {id: 'pending', label: '待确认'},
  {id: 'completed', label: '已完成'},
  {id: 'cancelled', label: '已取消'}
];
const summary = computed(() => studentSummary(store.data, selected.value, new Date(now.value)));
const courses = computed(() => filterStudentCourses(store.data, selected.value, filters.value, new Date(now.value)));
const invalidRange = computed(() => !!filters.value.from && !!filters.value.to && filters.value.from > filters.value.to);
const hasFilters = computed(() => !!filters.value.type || !!filters.value.from || !!filters.value.to);

const nextLesson = computed(() => {
  if (!student.value) return null;
  return (
    store.data.bookings
      .filter(b => b.student_id === student.value!.id && b.status !== 'cancelled' && b.status !== 'completed' && Date.parse(b.end_at) > now.value)
      .sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ?? null
  );
});

const dateLabel = (date: string) => new Date(date).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric'});
const fullDate = (date: string) => new Date(date).toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'short'});

function typeName(id: string) {
  return store.data.types.find(t => t.id === id)?.name ?? '';
}
function typeAccent(id: string) {
  return toneOf(store.data.types.find(t => t.id === id)).ink;
}
/** 课程类型标签与课表卡片共用同一套类型浅底 + 深字。 */
function toneStyle(id: string) {
  const tone = toneOf(store.data.types.find(t => t.id === id));
  return {'--type-bg': tone.bg, '--type-ink': tone.ink};
}
function clearFilters() {
  filters.value = {status: filters.value.status, type: '', from: '', to: ''};
}

watch(selected, () => {
  filters.value = {status: 'all', type: '', from: '', to: ''};
  showFilters.value = false;
});
</script>

<template>
  <div class="page students-page" :class="{'has-selection': !!selected}">
    <header class="students-header">
      <div>
        <span class="eyebrow"><span class="dot" aria-hidden="true" />学员档案</span>
        <h1>学员 <span class="count-pill">{{ rosterCount }}</span></h1>
      </div>
      <RouterLink class="primary" to="/students/new"><Plus :size="17" />新增学员</RouterLink>
    </header>

    <div class="students-workspace">
      <section class="students-master" aria-label="学员列表">
        <div class="student-search">
          <Search :size="16" aria-hidden="true" />
          <input v-model="search" type="search" aria-label="搜索学员" placeholder="姓名 / 电话" />
        </div>

        <div class="student-list">
          <RouterLink
            v-for="s in students"
            :key="s.id"
            class="student-row"
            :class="{selected: s.id === selected}"
            :to="'/students/' + s.id"
            :aria-current="s.id === selected ? 'page' : undefined"
          >
            <span class="avatar">{{ s.name.slice(-2) }}</span>
            <div class="student-row-main">
              <b>{{ s.name }}</b>
              <small>{{ s.phone || '未留电话' }}</small>
            </div>
            <ChevronRight :size="16" aria-hidden="true" />
          </RouterLink>
        </div>

        <div v-if="!students.length" class="list-empty">
          <PulseMark :width="120" :height="30" color="var(--line-strong)" />
          <p>{{ search ? '没有找到学员' : '还没有学员' }}</p>
          <RouterLink v-if="!search" class="text" to="/students/new">添加第一位学员</RouterLink>
        </div>
      </section>

      <section v-if="student" class="profile-pane" :key="student.id" aria-label="学员档案">
        <RouterLink class="student-back mobile" to="/students"><ArrowLeft :size="16" />学员列表</RouterLink>

        <div class="profile-header">
          <div class="profile-identity">
            <span class="avatar avatar-lg">{{ student.name.slice(-2) }}</span>
            <div>
              <h2>{{ student.name }}</h2>
              <a v-if="student.phone" class="profile-phone" :href="'tel:' + student.phone"><Phone :size="13" aria-hidden="true" />{{ student.phone }}</a>
              <span v-else class="muted">未留电话</span>
            </div>
          </div>
          <div class="profile-actions">
            <RouterLink class="profile-edit" :to="'/students/' + student.id + '/edit'" aria-label="编辑学员"><Pencil :size="15" />编辑</RouterLink>
            <RouterLink class="primary" :to="{path: '/create', query: {student: student.id}}"><CalendarPlus :size="16" />为 TA 排课</RouterLink>
          </div>
        </div>

        <div class="profile-next" :class="{'is-empty': !nextLesson}">
          <template v-if="nextLesson">
            <span class="profile-next-label">下一节</span>
            <div class="profile-next-main">
              <b>{{ fullDate(nextLesson.start_at) }} {{ time(nextLesson.start_at) }}–{{ time(nextLesson.end_at) }}</b>
              <small>{{ typeName(nextLesson.course_type_id) }} · {{ labels[nextLesson.status] }}</small>
            </div>
            <RouterLink class="text" :to="'/booking/' + nextLesson.id">查看</RouterLink>
          </template>
          <template v-else>
            <span class="profile-next-label">下一节</span>
            <p>近期还没有安排课程</p>
            <RouterLink class="text" :to="{path: '/create', query: {student: student.id}}">现在排课</RouterLink>
          </template>
        </div>

        <dl class="profile-summary">
          <div>
            <dt>已完成</dt>
            <dd data-testid="student-completed">{{ summary.completed }} <small>节</small></dd>
          </div>
          <div>
            <dt>有效预约</dt>
            <dd data-testid="student-active">{{ summary.active }} <small>节</small></dd>
          </div>
          <div>
            <dt>最近训练</dt>
            <dd class="last-training">{{ summary.last ? dateLabel(summary.last) : '—' }}</dd>
          </div>
        </dl>

        <div class="profile-details">
          <div v-if="student.goal" class="profile-block">
            <span class="block-label"><Target :size="13" aria-hidden="true" />训练目标</span>
            <p>{{ student.goal }}</p>
          </div>

          <div class="profile-block">
            <span class="block-label"><Users :size="13" aria-hidden="true" />课程偏好</span>
            <div v-if="student.preferences.length" class="profile-preferences">
              <span v-for="t in store.data.types.filter(t => student?.preferences.includes(t.id))" :key="t.id">
                <i :style="{background: typeAccent(t.id)}" />{{ t.name }}
              </span>
            </div>
            <p v-else class="muted">未设置，排课时会默认选择第一个课程类型。</p>
          </div>

          <div v-if="student.notes" class="profile-block">
            <span class="block-label"><StickyNote :size="13" aria-hidden="true" />教练备注</span>
            <p class="profile-notes">{{ student.notes }}</p>
          </div>
        </div>

        <div class="profile-meta">
          <span>{{ new Date(student.created_at).toLocaleDateString('zh-CN') }} 加入</span>
          <span>{{ courses.length }} 条课程记录</span>
        </div>

        <section class="student-courses" aria-label="学员课程记录">
          <div class="student-courses-heading">
            <h3>课程记录 <small>{{ courses.length }}</small></h3>
            <button class="filter-toggle" :class="{active: showFilters || hasFilters}" :aria-expanded="showFilters" aria-label="筛选课程" @click="showFilters = !showFilters">
              <SlidersHorizontal :size="16" />筛选<i v-if="hasFilters" />
            </button>
          </div>

          <div class="course-tabs" role="group" aria-label="课程状态">
            <button v-for="tab in tabs" :key="tab.id" :aria-pressed="filters.status === tab.id" :class="{active: filters.status === tab.id}" @click="filters.status = tab.id">
              {{ tab.label }}
            </button>
          </div>

          <div v-if="showFilters" class="student-course-filters">
            <label>课程类型
              <select aria-label="筛选课程类型" v-model="filters.type">
                <option value="">全部类型</option>
                <option v-for="t in store.data.types" :key="t.id" :value="t.id">{{ t.name }}</option>
              </select>
            </label>
            <div class="two">
              <label>开始日期<input aria-label="筛选开始日期" type="date" v-model="filters.from" /></label>
              <label>结束日期<input aria-label="筛选结束日期" type="date" v-model="filters.to" /></label>
            </div>
            <button v-if="hasFilters" class="text" @click="clearFilters"><X :size="13" />清除筛选</button>
          </div>

          <p v-if="invalidRange" class="error" role="alert">结束日期不能早于开始日期</p>

          <template v-else>
            <RouterLink class="history course-history-row" v-for="b in courses" :key="b.id" :to="'/booking/' + b.id">
              <div class="course-date">
                <b>{{ dateLabel(b.start_at) }}</b>
                <small>{{ time(b.start_at) }}–{{ time(b.end_at) }}</small>
              </div>
              <div class="course-description">
                <b class="course-type-tag" :style="toneStyle(b.course_type_id)">{{ typeName(b.course_type_id) }}</b>
                <StatusBadge :status="b.status" />
              </div>
              <ChevronRight :size="16" aria-hidden="true" />
            </RouterLink>
            <p v-if="!courses.length" class="empty">{{ hasFilters ? '没有符合筛选的课程' : '暂无课程' }}</p>
          </template>
        </section>

        <details class="student-review">
          <summary>训练回顾</summary>
          <TrainingStats :key="student.id" :student-id="student.id" />
        </details>
      </section>

      <section v-else-if="selected" class="profile-pane">
        <p role="alert">学员不存在</p>
        <RouterLink class="text" to="/students">返回学员列表</RouterLink>
      </section>

      <div v-else class="student-unselected">
        <PulseMark :width="150" :height="38" color="var(--line-strong)" />
        <p>选择一位学员查看训练安排</p>
        <span class="muted">左侧列表可直接搜索姓名或电话</span>
      </div>
    </div>
  </div>
</template>
