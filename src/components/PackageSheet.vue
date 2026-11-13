<script setup lang="ts">
import { ref, watch } from 'vue';
import BottomSheet from './BottomSheet.vue';
import { useTempo } from '../stores/tempo';
import { dateKey } from '../composables/date';
import type { LessonPackage } from '../types';

const props = defineProps<{open: boolean; studentId: string; studentName: string; basedOn?: LessonPackage | null}>();
const emit = defineEmits<{close: []}>();
const store = useTempo();

const name = ref('');
const typeId = ref('');
const total = ref(12);
const initial = ref(0);
const purchased = ref(dateKey());
const expires = ref('');
const notes = ref('');
const error = ref('');
const saving = ref(false);

/** 续购沿用名称与课程类型，总节数重新填；期初、有效期都从空白开始。 */
watch(
  () => props.open,
  open => {
    if (!open) return;
    const base = props.basedOn;
    name.value = base?.name ?? '私教 12 节';
    typeId.value = base?.course_type_id ?? '';
    total.value = base?.total_sessions ?? 12;
    initial.value = 0;
    purchased.value = dateKey();
    expires.value = '';
    notes.value = '';
    error.value = '';
    saving.value = false;
  },
  {immediate: true}
);

function submit() {
  if (saving.value) return;
  error.value = '';
  saving.value = true;
  try {
    store.addPackage(
      {
        student_id: props.studentId,
        course_type_id: typeId.value || null,
        name: name.value,
        total_sessions: Number(total.value),
        initial_used: Number(initial.value),
        purchased_on: purchased.value,
        expires_on: expires.value || null,
        notes: notes.value
      },
      crypto.randomUUID()
    );
    store.notice = props.basedOn ? '套餐已续购' : '套餐已登记';
    emit('close');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登记失败，请重试';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <BottomSheet :open="open" :title="(basedOn ? '续购套餐' : '登记套餐') + ' · ' + studentName" @close="emit('close')">
    <form class="package-form" @submit.prevent="submit">
      <label for="package-name">套餐名称
        <input id="package-name" v-model="name" maxlength="40" required placeholder="例如：私教 12 节" />
      </label>

      <label for="package-type">适用课程
        <select id="package-type" v-model="typeId">
          <option value="">全部课程类型</option>
          <option v-for="t in store.data.types" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </label>

      <div class="form-row">
        <label for="package-total">总节数
          <input id="package-total" v-model.number="total" type="number" min="1" max="500" inputmode="numeric" required />
        </label>
        <label for="package-initial">期初已用
          <input id="package-initial" v-model.number="initial" type="number" min="0" max="500" inputmode="numeric" />
        </label>
      </div>
      <p class="package-note">期初已用只用于补登早先上过的课；之后完成的课程会自动扣减。</p>

      <div class="form-row">
        <label for="package-purchased">购买日期
          <input id="package-purchased" v-model="purchased" type="date" required />
        </label>
        <label for="package-expires">有效期至 <span class="muted">（选填）</span>
          <input id="package-expires" v-model="expires" type="date" />
        </label>
      </div>

      <label for="package-notes">备注 <span class="muted">（选填）</span>
        <textarea id="package-notes" v-model="notes" rows="2" maxlength="200" placeholder="付款方式、赠送课时说明…" />
      </label>

      <p v-if="error" class="error" role="alert">{{ error }}</p>

      <div class="package-actions">
        <button type="button" class="text" @click="emit('close')">取消</button>
        <button class="primary" type="submit" :disabled="saving">{{ saving ? '保存中…' : basedOn ? '确认续购' : '登记套餐' }}</button>
      </div>
    </form>
  </BottomSheet>
</template>
