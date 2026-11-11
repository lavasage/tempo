import type {Database} from '../types';

const KEY = 'tempo.cache.v1';

export interface CachedDatabase {
  database: Database;
  savedAt: number;
  userId: string;
}

/** 只接受结构完整的缓存，任何字段缺失都当作没有缓存，避免用坏数据覆盖界面。 */
function isDatabase(value: unknown): value is Database {
  const db = value as Database;
  return !!db && typeof db === 'object'
    && !!db.coach && typeof db.coach.id === 'string'
    && Array.isArray(db.students) && Array.isArray(db.types)
    && Array.isArray(db.bookings) && Array.isArray(db.reviews)
    && !!db.availability && Array.isArray(db.availability.business);
}

/** 离线时用上一次的快照启动；账号必须一致，避免换账号看到别人的数据。 */
export function readCache(userId: string, storage: Storage = localStorage): CachedDatabase | null {
  if (!userId) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDatabase;
    if (parsed.userId !== userId || !isDatabase(parsed.database)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache(database: Database, userId: string, storage: Storage = localStorage, now = Date.now()) {
  if (!userId) return;
  try { storage.setItem(KEY, JSON.stringify({database, userId, savedAt: now} satisfies CachedDatabase)); }
  catch { /* 配额不足时放弃缓存，不影响在线使用 */ }
}

export function clearCache(storage: Storage = localStorage) {
  try { storage.removeItem(KEY); } catch { /* 忽略 */ }
}

/** 缓存时间：今天只显示时分，更早显示月日。 */
export function formatCachedAt(savedAt: number, now = new Date()): string {
  const at = new Date(savedAt);
  const sameDay = at.toDateString() === now.toDateString();
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return sameDay ? `${hh}:${mm}` : `${at.getMonth() + 1}月${at.getDate()}日 ${hh}:${mm}`;
}
