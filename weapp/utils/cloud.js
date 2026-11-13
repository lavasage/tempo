/**
 * 云开发同步：本机是唯一同步读写源，云端做异步镜像。
 *
 * 这样页面代码一行都不用改成 async：
 *   - 读取永远命中内存 / Storage，立刻返回
 *   - 写入先落本机，再节流推云端
 *   - 启动时拉一次云端，按 updatedAt 决定「用云端覆盖本机」还是「把本机传上去」
 *
 * 云端为空、未配置 cloudEnv、网络失败，都会安静降级为纯本机模式。
 */
import config from '../config.js';

const STATE_COL = () => config.stateCollection || 'state';

let ready = false;
let openid = '';
let db = null;
let pushing = false;
let dirty = false;
let timer = null;

/** 初始化云开发。未配置环境 ID 或基础库不支持时返回 false，不抛错。 */
export function init() {
  if (ready) return true;
  if (!config.cloudEnv || !wx.cloud) return false;
  try {
    wx.cloud.init({ env: config.cloudEnv, traceUser: true });
    db = wx.cloud.database();
    ready = true;
  } catch (e) {
    ready = false;
  }
  return ready;
}

export function enabled() {
  return ready;
}

export function currentOpenid() {
  return openid;
}

/** 拿 openid：真正的小程序身份，由云函数从 WXContext 里取，客户端伪造不了。 */
export async function login() {
  if (!ready) return '';
  if (openid) return openid;
  const res = await wx.cloud.callFunction({ name: 'login' });
  openid = (res && res.result && res.result.openid) || '';
  return openid;
}

function stateRef() {
  return db.collection(STATE_COL());
}

/** 读云端那一份。没有记录返回 null。 */
export async function pull() {
  if (!ready) return null;
  const res = await stateRef().limit(1).get();
  const doc = res && res.data && res.data[0];
  if (!doc) return null;
  return { data: doc.data || null, updatedAt: doc.updatedAt || '', id: doc._id };
}

/** 写云端。整份状态存成一个文档，单教练场景体积远小于 16MB 上限。 */
export async function push(payload) {
  if (!ready || !payload) return false;
  const body = { data: payload, updatedAt: payload.updatedAt || new Date().toISOString() };
  const existing = await stateRef().limit(1).get();
  const doc = existing && existing.data && existing.data[0];
  if (doc) await stateRef().doc(doc._id).update({ data: body });
  else await stateRef().add({ data: body });
  return true;
}

/** 节流推送：连续操作只发最后一次，避免每改一个字都打一次网络。 */
export function queuePush(payload) {
  if (!ready) return;
  dirty = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flush(payload);
  }, config.syncThrottle || 1500);
}

export async function flush(payload) {
  if (!ready || !dirty || pushing) return;
  pushing = true;
  dirty = false;
  try {
    await push(payload);
  } catch (e) {
    dirty = true;
  } finally {
    pushing = false;
  }
}

/**
 * 启动时对齐本机与云端。
 * 返回 { source: 'cloud' | 'local' | 'off', data }：
 *   cloud —— 云端更新，调用方应把 data 写回本机
 *   local —— 本机更新或云端为空，已把本机传上去
 *   off   —— 未开启云同步
 */
export async function bootstrap(localDb) {
  if (!ready) return { source: 'off', data: localDb };
  try {
    await login();
    const remote = await pull();
    if (!remote || !remote.data) {
      await push(localDb);
      return { source: 'local', data: localDb };
    }
    const localAt = localDb.updatedAt || '';
    const remoteAt = remote.updatedAt || '';
    if (remoteAt > localAt) {
      return { source: 'cloud', data: remote.data };
    }
    await push(localDb);
    return { source: 'local', data: localDb };
  } catch (e) {
    return { source: 'off', data: localDb };
  }
}
