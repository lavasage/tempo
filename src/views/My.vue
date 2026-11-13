<script setup lang="ts">
import {SlidersHorizontal,ChevronRight} from 'lucide-vue-next';
import {useTempo} from '../stores/tempo';
import TeachingRecords from '../components/TeachingRecords.vue';
import {computed} from 'vue';
import {useNow} from '../composables/useNow';
import {workbench} from '../services/workbench';
const store=useTempo();
const now=useNow();
const overview=computed(()=>workbench(store.data,new Date(now.value)));
</script>
<template><section class="my-page"><header class="coach-header"><div><h1>我的</h1><p>{{store.data.coach.name}} · 私人教练</p></div><span class="coach-monogram">{{store.data.coach.name.slice(0,1).toUpperCase()}}</span></header><div class="workload"><div><span>本周安排</span><strong>{{overview.weekCount}}<small>节</small></strong></div><div><span>本月完成</span><strong data-testid="month-completed">{{overview.monthCompleted}}</strong></div><RouterLink to="/students"><span>我的学员</span><strong>{{store.data.students.length}}<small>人</small></strong></RouterLink></div><RouterLink class="settings-row" to="/availability"><SlidersHorizontal :size="20"/><span>可预约时间</span><ChevronRight :size="18"/></RouterLink><TeachingRecords/></section></template>
