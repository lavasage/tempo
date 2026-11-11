import {ref,onMounted,onUnmounted} from 'vue';
/** Refresh on resume as well as while the page is visible. */
export function useNow(){
  const now=ref(Date.now());let timer:ReturnType<typeof setInterval>|undefined;
  const update=()=>{now.value=Date.now()};
  onMounted(()=>{timer=setInterval(update,30000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',update)});
  onUnmounted(()=>{clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',update)});
  return now;
}
