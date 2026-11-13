<script setup lang="ts">
import {computed,ref} from 'vue';
import {useTempo} from '../stores/tempo';
import {trainingStats} from '../services/reviews';
import '../styles/review.css';
const props=defineProps<{studentId?:string}>();const store=useTempo(),days=ref(30);
const stats=computed(()=>trainingStats(store.data,props.studentId,days.value));
const trendText=computed(()=>{const value=stats.value.trend;return value===null?'样本不足，暂无趋势':`评分趋势 ${value>=0?'+':''}${value.toFixed(2)} 分 / 30 天`});
</script>
<template><section class="training-stats"><div class="stats-heading"><h2>{{studentId?'训练表现':'授课与反馈'}}</h2><select aria-label="统计时间范围" v-model="days"><option :value="7">近 7 天</option><option :value="30">近 30 天</option><option :value="90">近 90 天</option><option :value="0">全部</option></select></div><dl class="stats-grid"><div><dt>已完成</dt><dd>{{stats.completed}} <small>节</small></dd></div><div><dt>平均表现</dt><dd>{{stats.average?.toFixed(1)??'—'}} <small>/ 5</small></dd></div><div><dt>已记录训练</dt><dd>{{stats.minutes}} <small>分钟</small></dd></div><div><dt>平均用力程度</dt><dd>{{stats.effort?.toFixed(1)??'—'}} <small>/ 10</small></dd></div></dl><p class="muted">已评 {{stats.rated.length}} / {{stats.completed}} 节 · 待补评 {{stats.unrated}} 节 · 用力反馈 {{stats.effortCount}} 条</p><p v-if="studentId&&stats.rated.length" class="muted">{{trendText}}</p><p v-if="!stats.completed" class="empty">暂无已完成课程</p><details v-else><summary>评分记录</summary><div class="review-history"><RouterLink v-for="row in [...stats.rows].reverse()" :key="row.booking.id" :to="'/booking/'+row.booking.id"><span>{{new Date(row.booking.start_at).toLocaleDateString('zh-CN')}} · {{store.data.students.find(s=>s.id===row.booking.student_id)?.name}}</span><span v-if="row.review" class="score-track" :aria-label="`训练表现 ${row.review.rating} 分，共 5 分`"><i :style="{width:row.review.rating/5*100+'%'}"/></span><b>{{row.review?row.review.rating+' / 5':'去补评'}}</b></RouterLink></div></details></section></template>
