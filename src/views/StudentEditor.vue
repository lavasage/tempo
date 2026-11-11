<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';
import { ArrowLeft, Check, Plus, CalendarPlus } from 'lucide-vue-next';
import { useTempo } from '../stores/tempo';
import { studentInput, type StudentInput } from '../services/students';
import { accentOf } from '../services/courseColors';
import '../styles/students.css';

const store = useTempo();
const route = useRoute();
const router = useRouter();

const existing = computed(() => store.data.students.find(s => s.id === route.params.id && s.coach_id === store.data.coach.id));
const draft = ref<StudentInput>({name: '', phone: '', notes: '', goal: '', preferences: []});
const baseline = ref('');
const error = ref('');
const saving = ref(false);
let newId = crypto.randomUUID();

watch(
  () => route.fullPath,
  () => {
    const s = existing.value;
    draft.value = {name: s?.name ?? '', phone: s?.phone ?? '', notes: s?.notes ?? '', goal: s?.goal ?? '', preferences: [...(s?.preferences ?? [])]};
    baseline.value = JSON.stringify(draft.value);
    error.value = '';
    saving.value = false;
    newId = crypto.randomUUID();
  },
  {immediate: true}
);

const dirty = computed(() => JSON.stringify(draft.value) !== baseline.value);
const nickname = computed(() => draft.value.name.trim().slice(-2) || '新');

function toggle(id: string) {
  draft.value.preferences = draft.value.preferences.includes(id)
    ? draft.value.preferences.filter(p => p !== id)
    : [...draft.value.preferences, id];
}
function accent(id: string) {
  const index = store.data.types.findIndex(t => t.id === id);
  return accentOf(store.data.types[index], Math.max(0, index));
}
function back() {
  router.push(existing.value ? '/students/' + existing.value.id : '/students');
}

/** book=true 时保存后直接带着学员上下文打开排课抽屉。 */
async function save(book = false) {
  if (saving.value) return;
  error.value = '';
  try {
    studentInput(store.data, draft.value);
    saving.value = true;
    const id = existing.value?.id ?? newId;
    if (route.params.id) {
      if (!existing.value) throw Error('学员不存在');
      store.editStudent(existing.value.id, draft.value);
    } else {
      store.addStudent(draft.value, newId);
    }
    baseline.value = JSON.stringify(draft.value);
    if (book) router.push({path: '/create', query: {student: id}});
    else await router.replace('/students/' + id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试';
    saving.value = false;
  }
}

onBeforeRouteLeave(() => !dirty.value || confirm('学员信息尚未保存，确定离开？'));
function unload(e: BeforeUnloadEvent) {
  if (dirty.value) {
    e.preventDefault();
    e.returnValue = '';
  }
}
onMounted(() => window.addEventListener('beforeunload', unload));
onUnmounted(() => window.removeEventListener('beforeunload', unload));
</script>

<template>
  <div class="page student-editor-page">
    <header class="page-head">
      <span class="eyebrow"><span class="dot" aria-hidden="true" />{{ route.params.id ? '编辑档案' : '新增学员' }}</span>
      <button class="text student-back" @click="back"><ArrowLeft :size="15" />学员</button>
      <h1>{{ route.params.id ? '编辑学员' : '新增学员' }}</h1>
    </header>

    <p v-if="route.params.id && !existing" role="alert" class="error">学员不存在，请返回学员列表。</p>

    <form v-else class="student-editor" @submit.prevent="save(false)">
      <div class="editor-identity">
        <span class="avatar avatar-lg">{{ nickname }}</span>
        <div>
          <p class="muted">{{ route.params.id ? '更新资料不会影响已排课程' : '先建档案，再直接排第一节课' }}</p>
        </div>
      </div>

      <label for="student-name">姓名
        <input id="student-name" v-model="draft.name" autocomplete="name" maxlength="40" placeholder="学员姓名" required />
      </label>

      <label for="student-phone">联系电话 <span class="muted">选填</span>
        <input id="student-phone" v-model="draft.phone" autocomplete="tel" type="tel" inputmode="tel" maxlength="30" placeholder="7–15 位数字" />
      </label>

      <fieldset class="preference-field">
        <legend>课程偏好 <span class="muted">可多选</span></legend>
        <div class="preference-options">
          <button v-for="t in store.data.types" :key="t.id" type="button" :aria-pressed="draft.preferences.includes(t.id)" :class="{chosen: draft.preferences.includes(t.id)}" @click="toggle(t.id)">
            <Check v-if="draft.preferences.includes(t.id)" :size="13" />
            <i v-else class="type-dot" :style="{background: accent(t.id)}" />
            {{ t.name }}
          </button>
        </div>
      </fieldset>

      <label for="student-goal">训练目标 <span class="muted">选填</span>
        <input id="student-goal" v-model="draft.goal" maxlength="200" placeholder="例如：12 周改善圆肩，能完成标准硬拉" />
      </label>

      <label for="student-notes">备注 <span class="muted">选填</span>
        <textarea id="student-notes" v-model="draft.notes" maxlength="1000" rows="3" placeholder="伤病、时间偏好、沟通方式等" />
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="student-editor-actions">
        <button type="submit" class="primary" :disabled="saving || (!dirty && !!existing)">
          {{ saving ? '保存中…' : existing ? '保存学员' : '添加学员' }}
        </button>
        <button type="button" class="save-and-book" :disabled="saving" @click="save(true)">
          <CalendarPlus :size="16" />{{ existing ? '保存并排课' : '添加并排课' }}
        </button>
      </div>
    </form>
  </div>
</template>
