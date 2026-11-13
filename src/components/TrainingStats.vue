<script setup lang="ts">
import {computed,ref} from 'vue';
import {ChevronRight} from 'lucide-vue-next';
import {useTempo} from '../stores/tempo';
import {durationText,trainingStats,type TeachingRow} from '../services/reviews';
import '../styles/review.css';
import '../styles/records.css';
const props=defineProps<{studentId:string}>();
const store=useTempo();
const days=ref(30);
const stats=computed(()=>trainingStats(store.data,props.studentId,days.value));
const rows=computed(()=>[...stats.value.rows].reverse());
const typeName=(id:string)=>store.data.types.find(t=>t.id===id)?.name??'课程';
const dayLabel=(iso:string)=>new Date(iso).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
const trendText=computed(()=>{const value=stats.value.trend;return value===null?'记录满 4 次且跨度足够后再看趋势':`评分趋势 ${value>=0?'+':''}${value.toFixed(2)} 分 / 30 天`});
function status(row:TeachingRow){
  const review=row.review;
  if(!review)return '未记录';
  const parts:string[]=[];
  if(review.actual_minutes!==null)parts.push(`训练 ${review.actual_minutes} 分钟`);
  parts.push(review.rating!==null?`表现 ${review.rating}/5`:'未评分');
  if(review.effort!==null)parts.push(`用力 ${review.effort}/10`);
  return parts.join(' · ');
}
</script>

<template>
  <section class="training-stats">
    <div class="stats-heading">
      <h2>训练表现</h2>
      <select v-model.number="days" aria-label="训练表现时间范围">
        <option :value="7">近 7 天</option>
        <option :value="30">近 30 天</option>
        <option :value="90">近 90 天</option>
        <option :value="0">全部</option>
      </select>
    </div>

    <p v-if="!stats.completed" class="stats-empty">这段时间没有已完成课程</p>

    <template v-else>
      <p class="stats-facts">
        <span>完成 <b>{{stats.completed}}</b> 节</span>
        <span>平均表现 <b>{{stats.average===null?'—':stats.average.toFixed(1)}}</b><template v-if="stats.rated.length">（{{stats.rated.length}} 节样本）</template></span>
      </p>
      <p class="stats-meta">
        已记录训练时长 {{durationText(stats.minutes)}}（{{stats.loggedCount}} 节）· 平均用力 {{stats.effort===null?'—':stats.effort.toFixed(1)}}（{{stats.effortCount}} 条学员反馈）
      </p>
      <p v-if="stats.rated.length" class="stats-meta">{{trendText}}</p>

      <details class="records-group stats-history">
        <summary>
          <span>评分与训练记录 · {{stats.rows.length}} 节</span>
          <ChevronRight :size="16" aria-hidden="true" />
        </summary>
        <RouterLink v-for="row in rows" :key="row.booking.id" class="record-row" :to="'/booking/'+row.booking.id">
          <span class="record-date">{{dayLabel(row.booking.start_at)}}</span>
          <span class="record-main"><b>{{typeName(row.booking.course_type_id)}}</b><small>{{status(row)}}</small></span>
          <ChevronRight :size="16" aria-hidden="true" />
        </RouterLink>
      </details>
    </template>
  </section>
</template>
