<script setup lang="ts">
import {computed,onBeforeUnmount,onMounted,ref,watch} from 'vue';
import {onBeforeRouteLeave,useRouter} from 'vue-router';
import {ArrowLeft,Check,ChevronDown,Plus,Trash2} from 'lucide-vue-next';
import {useTempo} from '../stores/tempo';
import {dateKey} from '../composables/date';
import {validateAvailability} from '../services/availability';
import type {AvailabilitySettings,WeeklyWindow} from '../types';
import '../styles/availability.css';

type WindowKind='work'|'business'|'breaks';
interface BlockDraft {id:string;start:string;end:string;label:string}
const store=useTempo(),router=useRouter();
const copy=(value:AvailabilitySettings):AvailabilitySettings=>JSON.parse(JSON.stringify(value)) as AvailabilitySettings;
const draft=ref(copy(store.data.availability));
function localDateTime(iso:string){const d=new Date(iso);return `${dateKey(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`}
const blocks=ref<BlockDraft[]>(draft.value.blocked.map(b=>({id:b.id,start:localDateTime(b.start_at),end:localDateTime(b.end_at),label:b.label})));
const state=()=>JSON.stringify({draft:draft.value,blocks:blocks.value});
const baseline=ref(state()),error=ref(''),saved=ref(false);
const dirty=computed(()=>state()!==baseline.value);
const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
const weekdays=[{day:1,label:'一'},{day:2,label:'二'},{day:3,label:'三'},{day:4,label:'四'},{day:5,label:'五'},{day:6,label:'六'},{day:0,label:'日'}];
const sections:{kind:WindowKind;title:string;empty:string;open:boolean}[]=[
 {kind:'work',title:'我的工作时间',empty:'暂无工作时段',open:true},
 {kind:'breaks',title:'固定休息',empty:'未设置',open:false},
 {kind:'business',title:'营业时间',empty:'暂无营业时段',open:false},
];
watch([draft,blocks],()=>{saved.value=false;error.value=''}, {deep:true,flush:'sync'});
function toggle(rule:WeeklyWindow,day:number){rule.days=rule.days.includes(day)?rule.days.filter(d=>d!==day):[...rule.days,day].sort((a,b)=>a-b)}
function setWindowEnd(rule:WeeklyWindow,event:Event){const value=(event.target as HTMLInputElement).value;rule.end=value==='00:00'?'24:00':value}
function addWindow(kind:WindowKind){draft.value[kind].push({id:crypto.randomUUID(),days:[1,2,3,4,5],start:kind==='breaks'?'12:00':'08:00',end:kind==='breaks'?'13:00':'21:00'})}
function removeWindow(kind:WindowKind,id:string){draft.value[kind]=draft.value[kind].filter(r=>r.id!==id)}
function addBlock(){const today=dateKey();blocks.value.push({id:crypto.randomUUID(),start:`${today}T12:00`,end:`${today}T13:00`,label:''})}
function removeBlock(id:string){if(confirm('移除此不可预约时段？保存后生效。'))blocks.value=blocks.value.filter(b=>b.id!==id)}
function save(){
 try{
  const next=copy(draft.value);
  next.blocked=blocks.value.map(b=>({id:b.id,start_at:new Date(b.start).toISOString(),end_at:new Date(b.end).toISOString(),label:b.label.trim()}));
  validateAvailability(next);
  store.saveAvailability(next);
  draft.value=copy(next);
  baseline.value=state();
  // A synchronous local save is committed before the confirmation appears.
  error.value='';
  saved.value=true;
 }catch(e){error.value=e instanceof Error?e.message:'保存失败，请重试'}
}
onBeforeRouteLeave(()=>!dirty.value||confirm('有未保存的设置，确定离开？'));
function beforeUnload(event:BeforeUnloadEvent){if(dirty.value){event.preventDefault();event.returnValue=''}}
onMounted(()=>window.addEventListener('beforeunload',beforeUnload));
onBeforeUnmount(()=>window.removeEventListener('beforeunload',beforeUnload));
</script>

<template>
 <div class="availability-page">
  <header class="availability-header">
   <div>
    <span class="eyebrow"><span class="dot" aria-hidden="true" />时间设置</span>
    <button class="text availability-back" @click="router.push('/')"><ArrowLeft :size="16" />课表</button>
    <h1>时间设置</h1>
    <p class="availability-lead">可约时间 = 营业时间 ∩ 工作时间 − 固定休息与临时不可预约。这些规则只影响预约校验，不会改动已有课程。</p>
   </div>
   <span class="availability-zone">{{zone}}</span>
  </header>

  <form class="availability-form" @submit.prevent="save">
   <details v-for="section in sections" :key="section.kind" class="availability-section" :open="section.open">
    <summary><h2>{{section.title}}</h2><span class="availability-count">{{draft[section.kind].length?`${draft[section.kind].length} 个时段`:section.empty}}</span><ChevronDown :size="17"/></summary>
    <div class="availability-section-body">
     <fieldset v-for="(rule,index) in draft[section.kind]" :key="rule.id" class="availability-rule" :aria-label="`${section.title} ${index+1}`">
      <div class="availability-weekdays" :aria-label="`${section.title} ${index+1} 适用星期`" role="group">
       <button v-for="day in weekdays" :key="day.day" type="button" :aria-label="`${section.title} ${index+1} 周${day.label}`" :aria-pressed="rule.days.includes(day.day)" :class="{active:rule.days.includes(day.day)}" @click="toggle(rule,day.day)">{{day.label}}</button>
      </div>
      <div class="availability-time-row">
       <label :for="`${rule.id}-start`">开始<input :id="`${rule.id}-start`" v-model="rule.start" type="time" :aria-label="`${section.title} ${index+1} 开始`" required/></label>
       <span class="availability-dash" aria-hidden="true">—</span>
       <label :for="`${rule.id}-end`">结束 <small v-if="rule.end && rule.start && (rule.end<rule.start||rule.end==='24:00')">次日</small><input :id="`${rule.id}-end`" :value="rule.end==='24:00'?'00:00':rule.end" @input="setWindowEnd(rule,$event)" type="time" :aria-label="`${section.title} ${index+1} 结束`" required/></label>
       <button type="button" class="availability-remove" :aria-label="`移除${section.title} ${index+1}`" @click="removeWindow(section.kind,rule.id)"><Trash2 :size="18"/></button>
      </div>
     </fieldset>
     <button class="availability-add" type="button" @click="addWindow(section.kind)"><Plus :size="16"/>添加{{section.title==='我的工作时间'?'工作时段':section.title==='固定休息'?'休息时段':'营业时段'}}</button>
    </div>
   </details>

   <section class="availability-buffer">
    <label for="course-buffer">课程间隔</label>
    <select id="course-buffer" v-model.number="draft.buffer_minutes"><option v-for="n in [0,5,10,15,30,45,60]" :key="n" :value="n">{{n===0?'无间隔':`${n} 分钟`}}</option></select>
   </section>

   <section class="availability-section availability-blocked">
    <div class="availability-section-heading"><h2>临时不可预约</h2><button type="button" class="availability-add" @click="addBlock"><Plus :size="16"/>添加</button></div>
    <p v-if="!blocks.length" class="availability-empty">暂无</p>
    <fieldset v-for="(block,index) in blocks" :key="block.id" class="availability-block" :aria-label="`不可预约时段 ${index+1}`">
     <div class="availability-block-title"><label :for="`${block.id}-label`">名称<input :id="`${block.id}-label`" v-model="block.label" maxlength="100" :aria-label="`不可预约 ${index+1} 名称`" placeholder="临时休息"/></label><button type="button" class="availability-remove" :aria-label="`移除不可预约 ${index+1}`" @click="removeBlock(block.id)"><Trash2 :size="18"/></button></div>
     <div class="availability-block-dates"><label :for="`${block.id}-start`">开始<input :id="`${block.id}-start`" v-model="block.start" type="datetime-local" :aria-label="`不可预约 ${index+1} 开始`" required/></label><label :for="`${block.id}-end`">结束<input :id="`${block.id}-end`" v-model="block.end" type="datetime-local" :aria-label="`不可预约 ${index+1} 结束`" required/></label></div>
    </fieldset>
   </section>

   <div class="availability-save">
    <p v-if="error" role="alert" class="error">{{error}}</p>
    <button class="primary" type="submit" :disabled="!dirty">保存设置</button>
    <span v-if="saved" role="status" class="availability-saved"><Check :size="17"/>已保存</span>
   </div>
  </form>
 </div>
</template>

