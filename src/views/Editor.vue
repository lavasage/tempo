<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { ArrowLeft, X, Clock3, TriangleAlert, Sparkles } from 'lucide-vue-next';
import TrainingReview from '../components/TrainingReview.vue';
import { StatusBadge } from '../components/ui';
import { availabilityError, availableSlots } from '../services/availability';
import { useTempo } from '../stores/tempo';
import { dateKey, time } from '../composables/date';
import { validateBooking, validateReferences, labels } from '../services/booking';
import { toneOf } from '../services/courseColors';
import type { Booking, Status } from '../types';
import '../styles/editor.css';
import {bookingStart} from '../services/bookingInput';

const store = useTempo();
const route = useRoute();
const router = useRouter();

const panel = ref<HTMLElement | null>(null);
const existing = computed(() => store.data.bookings.find(b => b.id === route.params.id));
const student = ref('');
const type = ref('');
const date = ref('');
const start = ref('');
const duration = ref(60);
const notes = ref('');
const error = ref('');
const saving = ref(false);
const baseline = ref('');
const reviewDirty=ref(false);

/** 抽屉关闭后要回到的课表上下文（日期 + 视图）。 */
const originDate = ref(String(route.query.date || dateKey()));
const originView = ref(String(route.query.view || ''));

const state = () => JSON.stringify({student: student.value, type: type.value, date: date.value, start: start.value, duration: duration.value, notes: notes.value});
const dirty = computed(() => state() !== baseline.value||reviewDirty.value);
const locked = computed(() => !!existing.value && ['cancelled', 'completed'].includes(existing.value.status));

watch(
  () => route.fullPath,
  () => {
    const b = existing.value;
    student.value = b?.student_id || String(route.query.student || store.data.students[0]?.id || '');
    type.value = b?.course_type_id || store.data.students.find(s => s.id === student.value)?.preferences[0] || store.data.types[0]?.id || '';
    date.value = b ? dateKey(new Date(b.start_at)) : String(route.query.date || dateKey());
    start.value = b ? time(b.start_at) : String(route.query.time || '09:00');
    duration.value = b ? (Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000 : (store.data.types.find(t => t.id === type.value)?.default_duration ?? 60);
    notes.value = b?.notes || '';
    error.value = '';
    saving.value = false;
    baseline.value = state();
    originDate.value = String(route.query.date || (b ? dateKey(new Date(b.start_at)) : dateKey()));
    originView.value = String(route.query.view || '');
  },
  {immediate: true}
);

function draft(): Booking {
  const now = new Date().toISOString();
  const s = bookingStart(date.value,start.value,duration.value);
  return {
    id: existing.value?.id || crypto.randomUUID(),
    coach_id: store.data.coach.id,
    student_id: student.value,
    course_type_id: type.value,
    start_at: s.toISOString(),
    end_at: new Date(s.getTime() + duration.value * 60000).toISOString(),
    status: existing.value?.status || 'confirmed',
    notes: notes.value,
    created_at: existing.value?.created_at || now,
    updated_at: now
  };
}

const studentName = (id: string) => store.data.students.find(s => s.id === id)?.name ?? '学员';
const typeName = (id: string) => store.data.types.find(t => t.id === id)?.name ?? '';
/** 当前课程类型的浅底与深字，抽屉与课表卡片共用同一套 token。 */
const typeTone = computed(() => toneOf(store.data.types.find(t => t.id === type.value)));

/** 具体冲突对象：用于把「重叠」说清楚到人和时间。 */
const clash = computed(() => {
  if(inputError.value)return null;
  const d = draft();
  return (
    store.data.bookings.find(
      b =>
        b.id !== d.id &&
        b.coach_id === d.coach_id &&
        b.status !== 'cancelled' &&
        Date.parse(d.start_at) < Date.parse(b.end_at) &&
        Date.parse(b.start_at) < Date.parse(d.end_at)
    ) ?? null
  );
});

const inputError=computed(()=>{try{bookingStart(date.value,start.value,duration.value);return ''}catch(e){return e instanceof Error?e.message:'请填写有效日期和时间'}});
const conflict = computed(() => {
  if(inputError.value)return inputError.value;
  const d = draft();
  try {
    validateReferences(store.data, d);
    validateBooking(d, store.data.bookings);
  } catch (e) {
    if (clash.value) return `与 ${studentName(clash.value.student_id)} ${time(clash.value.start_at)}–${time(clash.value.end_at)} 的课程重叠`;
    return e instanceof Error ? e.message : '请填写有效日期和时间';
  }
  if (locked.value) return '';
  return availabilityError(store.data, d.start_at, d.end_at, existing.value?.id);
});

const alternatives = computed(() => {
  if (!conflict.value || inputError.value) return [];
  const all = availableSlots(store.data, date.value, duration.value, existing.value?.id);
  const wanted = start.value ? Number(start.value.slice(0, 2)) * 60 + Number(start.value.slice(3, 5)) : 0;
  const distance = (t: string) => Math.abs(Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) - wanted);
  return [...all].sort((a, b) => distance(a) - distance(b)).slice(0, 4);
});

const end = computed(() => {
  try {
    return time(draft().end_at);
  } catch {
    return '—';
  }
});

const dateLabel = computed(() => {
  if (!date.value) return '';
  return new Date(date.value + 'T12:00').toLocaleDateString('zh-CN', {month: 'long', day: 'numeric', weekday: 'long'});
});

const title = computed(() => (existing.value ? '课程详情' : '新建课程'));

/** 已经处理过未保存确认时跳过路由离开守卫，避免重复弹窗。 */
let confirmedLeave = false;

function close() {
  if (dirty.value && !confirm('表单还有未保存的修改，确定关闭？')) return;
  confirmedLeave = true;
  goBack();
}
function goBack(restoreOrigin=true) {
  const previous=window.history.state?.back;
  if(restoreOrigin&&typeof previous==='string'&&!/(?:#|^)\/(create|booking)(\/|\?|$)/.test(previous)){router.back();return}
  const query: Record<string, string> = {date: originDate.value};
  if (originView.value) query.view = originView.value;
  router.push({path: '/', query});
}

async function save() {
  if (saving.value) return;
  error.value = '';
  saving.value = true;
  await nextTick();
  try {
    const book = draft();
    store.save(book);
    baseline.value = state();
    store.notice = existing.value ? '课程已更新' : '课程已排好';
    router.push({path: '/', query: {date: dateKey(new Date(book.start_at)), view: originView.value || 'day'}});
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试';
  } finally {
    saving.value = false;
  }
}

function status(s: Status) {
  if (s === 'cancelled' && !confirm('确定取消这节课程？记录将保留。')) return;
  try {
    store.status(existing.value!.id, s);
    if (s !== 'completed') goBack(false);
    else store.notice = '课程已完成，可以填写课后反馈';
  } catch (e) {
    error.value = String(e);
  }
}

/* ---------- 抽屉的可访问性：焦点进出 + Esc + 滚动锁定 ---------- */
let restoreFocus: HTMLElement | null = null;
function focusables() {
  return Array.from(
    panel.value?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
    ) ?? []
  ).filter(el => el.offsetParent !== null);
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusables();
  if (!items.length) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

onMounted(async () => {
  window.addEventListener('beforeunload',protectDraft);
  restoreFocus = document.activeElement as HTMLElement | null;
  document.body.style.overflow = 'hidden';
  window.addEventListener('keydown', onKeydown);
  await nextTick();
  panel.value?.focus();
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload',protectDraft);
  document.body.style.overflow = '';
  window.removeEventListener('keydown', onKeydown);
  restoreFocus?.focus?.();
});
onBeforeRouteLeave(() => confirmedLeave || !dirty.value || confirm('表单还有未保存的修改，确定离开？'));
function protectDraft(event:BeforeUnloadEvent){if(dirty.value){event.preventDefault();event.returnValue=''}}
</script>

<template>
  <div class="drawer-root">
    <div class="drawer-scrim" @click="close" />

    <aside ref="panel" class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" tabindex="-1" :style="{'--type-bg': typeTone.bg, '--type-ink': typeTone.ink}">
      <header class="drawer-head">
        <div class="drawer-head-main">
          <button class="text drawer-back" @click="close"><ArrowLeft :size="15" />返回</button>
          <h1 id="drawer-title">{{ title }}</h1>
          <div class="drawer-sub">
            <StatusBadge v-if="existing" :status="existing.status" size="md" />
            <span>{{ dateLabel }} · {{ start }}–{{ end }}</span>
          </div>
        </div>
        <button class="icon-button drawer-close" aria-label="关闭课程面板" @click="close"><X :size="18" /></button>
      </header>

      <div class="drawer-body">
        <p v-if="route.params.id && !existing" class="error" role="alert">课程不存在，请返回课表。</p>

        <template v-else>
          <TrainingReview v-if="existing?.status === 'completed'" :key="existing.id" :booking-id="existing.id" @dirty="reviewDirty=$event" />

          <form id="booking-form" class="booking-form" @submit.prevent="save">
            <fieldset :disabled="locked">
              <label for="booking-student">学员
                <select id="booking-student" v-model="student" required>
                  <option v-for="s in store.data.students" :value="s.id" :key="s.id">{{ s.name }}</option>
                </select>
              </label>

              <label for="booking-type">课程类型
                <select id="booking-type" v-model="type" @change="duration = store.data.types.find(t => t.id === type)!.default_duration">
                  <option v-for="t in store.data.types" :value="t.id" :key="t.id">{{ t.name }}</option>
                </select>
              </label>

              <div class="form-row">
                <label for="booking-date">上课日期
                  <input id="booking-date" type="date" v-model="date" required />
                </label>
                <label for="booking-start">开始时间
                  <input id="booking-start" type="time" v-model="start" required />
                </label>
              </div>

              <fieldset class="duration-field">
                <legend>时长</legend>
                <div class="duration-options">
                  <button v-for="n in [30, 45, 60, 90, 120]" :key="n" type="button" :aria-pressed="duration === n" :class="{chosen: duration === n}" @click="duration = n">
                    {{ n }} 分钟
                  </button>
                </div>
              </fieldset>

              <p class="end-note"><Clock3 :size="14" aria-hidden="true" />预计 {{ end }} 结束 · {{ Intl.DateTimeFormat().resolvedOptions().timeZone }}</p>

              <label for="booking-notes">备注 <span class="muted">（选填）</span>
                <textarea id="booking-notes" v-model="notes" rows="3" placeholder="训练重点、需要留意的事项…" maxlength="1000" />
              </label>
            </fieldset>

            <div v-if="conflict && !locked" class="conflict-card" role="alert">
              <div class="conflict-head"><TriangleAlert :size="16" aria-hidden="true" /><span>{{ conflict }}</span></div>
              <template v-if="alternatives.length">
                <p class="conflict-hint"><Sparkles :size="13" aria-hidden="true" />当天可约时间</p>
                <div class="alternative-times">
                  <button v-for="t in alternatives" :key="t" type="button" @click="start = t">{{ t }}</button>
                </div>
              </template>
            </div>

            <p v-if="error" class="error" role="alert">{{ error }}</p>
          </form>

          <details v-if="existing" class="event-log">
            <summary>课程变更记录</summary>
            <p v-if="!store.data.booking_events.some(e => e.booking_id === existing?.id)" class="muted">暂无变更记录；升级前的操作未记录。</p>
            <div v-for="e in store.data.booking_events.filter(e => e.booking_id === existing?.id).slice().reverse()" :key="e.id" class="event-row">
              <b>{{ e.kind === 'created' ? '创建课程' : e.kind === 'edited' ? '修改课程' : '状态变更' }}</b>
              <small>
                {{ new Date(e.created_at).toLocaleString('zh-CN') }} · {{ e.before ? labels[e.before.status] + ' → ' : '' }}{{ labels[e.after.status] }}<br />
                {{ e.before ? new Date(e.before.start_at).toLocaleString('zh-CN') + ' → ' : '' }}{{ new Date(e.after.start_at).toLocaleString('zh-CN') }}
              </small>
            </div>
          </details>
        </template>
      </div>

      <footer v-if="!route.params.id || existing" class="drawer-foot">
        <template v-if="!locked">
          <div class="foot-secondary">
            <button v-if="existing?.status === 'pending'" type="button" @click="status('confirmed')">确认预约</button>
            <button v-if="existing?.status === 'confirmed'" type="button" @click="status('completed')">标记已完成</button>
            <button v-if="existing" type="button" class="danger" @click="status('cancelled')">取消预约</button>
          </div>
          <button class="primary foot-save" type="submit" form="booking-form" :disabled="!!conflict || saving">
            {{ saving ? '保存中…' : existing ? '保存修改' : '确认排课' }}
          </button>
        </template>
        <template v-else>
          <span class="locked-note">{{ labels[existing!.status] }}课程不可修改，记录保留在历史中。</span>
          <button class="primary foot-save" type="button" @click="close">关闭</button>
        </template>
      </footer>
    </aside>
  </div>
</template>
