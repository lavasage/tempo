/** 极简 store：小程序里不需要 Pinia，保持「单次提交 + 订阅重渲染」。 */
import { load, save, adopt as adoptStorage, reset as resetStorage, resetToDemo as demoStorage } from './db.js';
import { queuePush } from './cloud.js';

let state = null;
const listeners = [];

export function get() {
  if (!state) state = load();
  return state;
}

/** 先落本机再推云端；页面永远读内存，不等网络。 */
export function commit(next) {
  state = save(next);
  queuePush(state);
  listeners.slice().forEach(fn => fn(state));
}

/** 云端数据覆盖本机（启动对齐时用），不触发回传，避免来回打架。 */
export function adopt(next) {
  state = adoptStorage(next);
  listeners.slice().forEach(fn => fn(state));
  return state;
}

export function subscribe(fn) {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

export function reset() {
  state = resetStor