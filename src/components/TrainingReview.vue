<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {useTempo} from '../stores/tempo';
import '../styles/review.css';
const props=defineProps<{bookingId:string}>();
const emit=defineEmits<{dirty:[value:boolean]}>();
const baseline=ref('');
const store=useTempo();
const existing=computed(()=>store.data.reviews.find(r=>r.booking_id===props.bookingId));
const defaultMinutes=(id:string)=>{const b=store.data.bookings.find(b=>b.id===id);return b?Math.round((Date.parse(b.end_at)-Date.parse(b.start_at))/60000):60};
const rating=ref<number|null>(null),effort=ref<number|null>(null),minutes=ref<number|null>(null),notes=ref(''),error=ref(''),saved=ref(false);
const descriptions=['需要调整','有待提升','达到计划','表现良好','表现出色'];
watch(()=>props.bookingId,()=>{const r=existing.value;rating.value=r?.rating??null;effort.value=r?.effort??null;minutes.value=r?.actual_minutes??defaultMinutes(props.bookingId);notes.value=r?.notes??'';saved.value=false;error.value=''},{immediate:true});
const draftKey=()=>JSON.stringify([rating.value,effort.value,minutes.value,notes.value]);
baseline.value=draftKey();
watch([rating,effort,minutes,notes],()=>emit('dirty',draftKey()!==baseline.value),{flush:'sync'});
function pick(value:number){rating.value=rating.value===value?null:value}
function setMinutes(event:Event){const raw=(event.target as HTMLInputElement).value;minutes.value=raw===''?null:Number(raw)}
function save(){try{store.review(props.bookingId,{rating:rating.value,effort:effort.value,actual_minutes:minutes.value,notes:notes.value});baseline.value=draftKey();emit('dirty',false);saved.value=true;error.value=''}catch(e){error.value=e instanceof Error?e.message:'保存失败，请重试'}}
</script>
<template><section class="review-section"><h2>课后记录</h2><p class="review-hint">评分和训练时长都可以留空，先记多少算多少，之后还能补。</p><form @submit.prevent="save" @input="saved=false" @change="saved=false"><fieldset><legend>训练表现 · 教练评分（可留空）</legend><div class="rating-options"><label v-for="(description,i) in descriptions" :key="i" :class="{chosen:rating===i+1}"><input type="radio" :value="i+1" :checked="rating===i+1" name="rating" @change="pick(i+1)"><b>{{i+1}}</b><span>{{description}}</span></label></div><p class="rating-state"><span><template v-if="rating===null">当前不评分，只保存训练记录</template><template v-else>已选 {{rating}} 分</template></span><button v-if="rating!==null" type="button" class="text" @click="rating=null">清除评分</button></p></fieldset><div class="two"><label>训练时长（分钟，可留空）<input type="number" min="1" max="600" step="1" :value="minutes??''" @input="setMinutes" aria-label="训练时长（分钟）"></label><label>学员反馈用力程度<select v-model="effort"><option :value="null">未询问 / 不记录</option><option v-for="n in 10" :key="n" :value="n">{{n}} / 10</option></select></label></div><p class="muted">1 轻松 · 10 极其吃力 · 学员口述</p><label>训练记录（选填）<textarea v-model="notes" maxlength="1000" rows="3" placeholder="今天的进展、下次需要留意的事…"/></label><p v-if="error" role="alert" class="error">{{error}}</p><button class="primary" type="submit">{{existing?'更新记录':'保存记录'}}</button><p v-if="saved" role="status" class="success">记录已保存，授课记录已更新。</p></form></section></template>
