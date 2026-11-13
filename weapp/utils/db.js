/** 本地存储：唯一写入点。键名与 web 端分开，互不影响。 */
import { seed, emptyDb } from './seed.js';

export const KEY = 'tempo.weapp.v1';
const LISTS = ['students', 'types', 'bookings', 'reviews', 'booking_events', 'packages', 'lesson_tx'];

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !raw.coach) return null;
  const db = { ...raw };
  for (const key of LISTS) if (!Array.isArray(db[key])) db[key] = [];
  if (!db.availability || typeof db.availability !== 'object') db.availability = emptyDb().availability;
  return db;
}

/** 没有任何本地记录时给空库，而不是演示数据——上线后新用户不该看到别人的学员。 */
export function load() {
  try {
    return normalize(wx.getStorageSync(KEY)) || emptyDb();
  } catch (e) {
    return emptyDb();
  }
}

/** 每次写入都盖时间戳，云端同步靠它判断哪边更新。 */
export function save(db) {
  const next = { ...db, updatedAt: new Date().toISOString() };
  wx.setStorageSync(KEY, next);
  return next;
}

/** 写入云端拉回来的整份状态（不重新盖时间戳，保留云端的先后顺序）。 */
export function adopt(db) {
  const next = normalize(db) || emptyDb();
  wx.setStorageSync(KEY, next);
  return next;
}

export function reset() {
  return save(emptyDb());
}

/** 只在用户主动点「载入演示数据」时调用。 */
export function resetToDemo() {
  return save(seed());
}
