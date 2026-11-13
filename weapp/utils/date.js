/** 日期与时间：与 src/composables/date.ts 同口径，全部按本地时区。 */
export function pad(n) {
  return String(n).padStart(2, '0');
}

export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** iOS 不接受 `2026-11-14T09:00` 这种短格式，统一用年月日构造。 */
export function at(day, hour = 9, minute = 0) {
  const parts = day.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2], hour, minute, 0, 0).toISOString();
}

export function shift(day, n) {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

export function time(iso) {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return dateKey();
  const d = new Date(value + 'T12:00:00');
  return Number.isFinite(d.getTime()) && dateKey(d) === value ? value : dateKey();
}

export function weekdayCn(day) {
  return ['日', '一', '二', '三', '四', '五', '六'][new Date(day + 'T12:00:00').getDay()];
}

/** 周一开头的一周，和课表周视图一致。 */
export function weekDays(day) {
  const offset = (new Date(day + 'T12:00:00').getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => shift(day, i - offset));
}

export function monthDays(day) {
  const start = weekDays(day.slice(0, 7) + '-01')[0];
  return Array.from({ length: 42 }, (_, i) => shift(start, i));
}

export function moveMonth(day, n) {
  const d = new Date(day + 'T12:00:00');
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return dateKey(d);
}

export function monthTitle(day) {
  const d = new Date(day + 'T12:00:00');
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

export function dayLabel(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function caption(day, mode) {
  const d = new Date(day + 'T12:00:00');
  if (mode === 'month') return monthTitle(day);
  if (mode === 'week') return `${shift(day, -((d.getDay() + 6) % 7)).slice(5).replace('-', '/')} – ${weekDays(day)[6].slice(5).replace('-', '/')}`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${weekdayCn(day)}`;
}

export function isSameDay(iso, day) {
  return dateKey(new Date(iso)) === day;
}
