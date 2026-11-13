<script setup lang="ts">
import {ref,watch,nextTick,onBeforeUnmount,useId} from 'vue';
import {X} from 'lucide-vue-next';
const props=defineProps<{open:boolean;title:string}>();
const emit=defineEmits<{close:[]}>();
const dialog=ref<HTMLDialogElement|null>(null),titleId=useId();
let previous:HTMLElement|null=null,overflow='';
function release(){document.body.style.overflow=overflow;previous?.focus({preventScroll:true})}
watch(()=>props.open,async open=>{
 await nextTick();
 if(open&&dialog.value&&!dialog.value.open){previous=document.activeElement as HTMLElement;overflow=document.body.style.overflow;dialog.value.showModal();document.body.style.overflow='hidden'}
 else if(!open&&dialog.value?.open){dialog.value.close();release()}
},{immediate:true});
onBeforeUnmount(()=>{if(dialog.value?.open){dialog.value.close();release()}});
</script>
<template><Teleport to="body"><dialog ref="dialog" class="tempo-sheet" :aria-labelledby="titleId" @cancel.prevent="emit('close')" @click="e=>{if(e.target===dialog)emit('close')}"><div class="sheet-surface"><header><h2 :id="titleId">{{title}}</h2><button autofocus class="icon-button" aria-label="关闭面板" @click="emit('close')"><X :size="20"/></button></header><div class="sheet-content"><slot/></div></div></dialog></Teleport></template>
<style>
.tempo-sheet{border:0;padding:0;background:transparent;color:var(--ink);width:min(100%,520px);max-width:100%;max-height:85dvh;margin:auto auto 0;overflow:visible}
.tempo-sheet::backdrop{background:rgb(20 24 29 / .38)}
.sheet-surface{background:var(--surface);border-radius:12px 12px 0 0;display:flex;flex-direction:column;max-height:85dvh;padding-bottom:env(safe-area-inset-bottom)}
.sheet-surface>header{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--line);flex-shrink:0}.sheet-surface h2{font-size:17px}.sheet-surface .icon-button{min-width:44px;min-height:44px}
.sheet-content{overflow:auto;overscroll-behavior:contain;padding:8px 16px 20px}.sheet-content .work-action,.sheet-content .work-open{min-height:44px;min-width:44px}.sheet-content .work-main{min-height:44px;justify-content:center}
.tempo-sheet[open]{animation:sheet-enter .18s ease-out}@keyframes sheet-enter{from{transform:translateY(24px);opacity:.4}to{transform:none;opacity:1}}
@media(prefers-reduced-motion:reduce){.tempo-sheet[open]{animation:none}}
</style>
