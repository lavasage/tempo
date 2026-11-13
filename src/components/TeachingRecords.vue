<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {ChevronRight} from 'lucide-vue-next';
import {useTempo} from '../stores/tempo';
import {durationText,teachingRecords,type TeachingRow} from '../services/reviews';
import '../styles/records.css';
const store=useTempo();
const days=ref(30);
const pendingOnly=ref(false);
const records=computed(()=>teachingRecords(store.data,days.value));
/** 范围切走后没有待补项时，筛选状态自动退回最近授课。 */
watch(()=>records.value.pending.length,count=>{if(!count)pendingOnly.value=false});
const shown=computed(()=>pendingOnly.value?records.value.pending:records.value.latest);
const studentName=(id:string)=>store.data.students.find(s=>s.id===id)?.name??'学员';
const typeName=(id:string)=>store.data.types.find(t=>t.id===id)?.name??'课程';
const dayLabel=(iso:string)=>new Date(iso).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
/** 三种状态分开写：没记录、有记录未评分、有评分；缺失值不显示成 0。 */
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
  <section class="teaching-records" aria-labelledby="records-heading">
    <div class="records-head">
      <h2 id="records-heading">授课记录</h2>
      <select v-model.number="days" aria-label="授课记录时间范围">
        <option :value="7">近 7 天</option>
        <option :value="30">近 30 天</option>
        <option :value="90">近 90 天</option>
        <option :value="0">全部</option>
      </select>
    </div>

    <div v-if="!records.allCount" class="records-empty" data-testid="records-empty">
      <p>还没有已完成课程</p>
      <RouterLink class="records-link" to="/">查看课表<ChevronRight :size="16" aria-hidden="true" /></RouterLink>
    </div>

    <div v-else-if="!records.rows.length" class="records-empty" data-testid="records-scope-empty">
      <p>这段时间暂无已完成课程</p>
      <button class="records-link" type="button" @click="days=0">查看全部记录<ChevronRight :size="16" aria-hidden="true" /></button>
    </div>

    <template v-else>
      <p class="records-facts">
        <span>完成 <b>{{records.rows.length}}</b> 节</span>
        <span>排课时长 <b>{{durationText(records.scheduledMinutes)}}</b></span>
      </p>
      <p class="records-meta">
        已记录训练时长 {{durationText(records.loggedMinutes)}}（{{records.loggedCount}} 节有记录）· 有评分 {{records.ratedCount}} 节<template v-if="records.effortCount"> · 用力反馈 {{records.effortCount}} 条</template>
      </p>

      <button v-if="records.pending.length" class="records-filter" :class="{on:pendingOnly}" type="button" :aria-pressed="pendingOnly" @click="pendingOnly=!pendingOnly" data-testid="records-pending-toggle">
        <span>待补反馈<i class="pending-count">{{records.pending.length}}</i></span>
        <span class="records-filter-hint">{{pendingOnly?'看最近授课':'只看这些'}}<ChevronRight :size="16" aria-hidden="true" /></span>
      </button>

      <p class="records-subhead">{{pendingOnly?'待补反馈':'最近授课'}}</p>
      <ol class="records-list" data-testid="records-list">
        <li v-for="row in shown" :key="row.booking.id">
          <RouterLink class="record-row" :to="'/booking/'+row.booking.id">
            <span class="record-date">{{dayLabel(row.booking.start_at)}}</span>
            <span class="record-main"><b>{{studentName(row.booking.student_id)}} · {{typeName(row.booking.course_type_id)}}</b><small>{{status(row)}}</small></span>
            <ChevronRight :size="16" aria-hidden="true" />
          </RouterLink>
        </li>
      </ol>

      <details v-if="!pendingOnly && records.rest.length" class="records-group records-all">
        <summary>
          <span>全部授课记录</span>
          <span class="records-all-count">{{records.rows.length}} 节<ChevronRight :size="16" aria-hidden="true" /></span>
        </summary>
        <ol class="records-list">
          <li v-for="row in records.rest" :key="row.booking.id">
            <RouterLink class="record-row" :to="'/booking/'+row.booking.id">
              <span class="record-date">{{dayLabel(row.booking.start_at)}}</span>
              <span class="record-main"><b>{{studentName(row.booking.student_id)}} · {{typeName(row.booking.course_type_id)}}</b><small>{{status(row)}}</small></span>
              <ChevronRight :size="16" aria-hidden="true" />
            </RouterLink>
          </li>
        </ol>
      </details>
    </template>
  </section>
</template>
