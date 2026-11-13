<script setup lang="ts">
import {SlidersHorizontal,ChevronRight} from 'lucide-vue-next';
import {useTempo} from '../stores/tempo';
import TrainingStats from '../components/TrainingStats.vue';
import {computed} from 'vue';
import {useNow} from '../composables/useNow';
import {workbench} from '../services/workbench';
const store=useTempo();
const now=useNow();
const overview=computed(()=>workbench(store.data,new Date(now.value)));
const awaiting=computed(()=>store.data.bookings.filter(b=>b.status==='completed'&&!store.data.reviews.some(r=>r.booking_id===b.id)));
</script>
<template><section class="my-page"><header class="coach-header"><div><h1>我的</h1><p>{{store.data.coach.name}} · 私人教练</p></div><span class="coach-monogram">{{store.data.coach.name.slice(0,1).toUpperCase()}}</span></header><div class="workload"><div><span>本周安排</span><strong>{{overview.weekCount}}<small>节</small></strong></div><div><span>本月完成</span><strong data-testid="month-completed">{{overview.monthCompleted}}</strong></div><RouterLink to="/students"><span>我的学员</span><strong>{{store.data.students.length}}<small>人</small></strong></RouterLink></div><RouterLink class="settings-row" to="/availability"><SlidersHorizontal :size="20"/><span>可预约时间</span><ChevronRight :size="18"/></RouterLink><section v-if="awaiting.length" class="feedback-todo"><h2>待补反馈 · {{awaiting.length}}</h2><RouterLink v-for="b in awaiting.slice(0,3)" :key="b.id" :to="'/booking/'+b.id"><span>{{store.data.students.find(s=>s.id===b.student_id)?.name}} · {{new Date(b.start_at).toLocaleDateString('zh-CN')}}</span><span>补记 →</span></RouterLink></section><TrainingStats/></section></template>
