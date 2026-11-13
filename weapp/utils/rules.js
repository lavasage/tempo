/**
 * 业务规则：逐条移植自 src/services/{booking,availability,packages,reviews,students}.ts。
 * 这里全是纯函数（输入 Database，返回新的 Database），页面只负责渲染与调用。
 * 任何口径改动必须同时改 web 端并跑 tests/parity.test.mjs，否则两边会走偏。
 */
import { dateKey, shift, at } from './date.js';
import { uid } from './id.js';

/* ============================== 课程状态 ============================== */

export const labels = { pending: '待确认', confirmed: '已确认', completed: '已完成', cancelled: '已取消' };
const transitions = { pending: ['confirmed', 'cancelled'], confirmed: ['completed', 'cancelled'], completed: [], cancelled: [] };
const MINUTE = 60000;

export function overlaps(a, b) {
  return (
    a.id !== b.id &&
    a.coach_id === b.coach_id &&
    a.status !== 'cancelled' &&
    b.status !== 'cancelled' &&
    Date.parse(a.start_at) < Date.parse(b.end_at) &&
    Date.parse(b.start_at) < Date.parse(a.end_at)
  );
}

export function validateBooking(b, all) {
  if (!Number.isFinite(Date.parse(b.start_at)) || !Number.isFinite(Date.parse(b.end_at)) || Date.parse(b.end_at) <= Date.parse(b.start_at)) {
    throw Error('请选择有效的开始时间和时长');
  }
  if (!b.id || !b.coach_id || !b.student_id || !b.course_type_id) throw Error('请选择学员和课程类型');
  if (!Object.prototype.hasOwnProperty.call(labels, b.status)) throw Error('无效课程状态');
  if (b.notes.length > 1000) throw Error('课程备注最多 1000 字');
  if (all.some(x => overlaps(b, x))) throw Error('此时段与已有课程重叠，请选择其他时间');
}

export function changeStatus(b, status, now = new Date()) {
  if (!(transitions[b.status] || []).includes(status)) throw Error('不允许此状态变更，请先确认预约；已结束课程不可恢复');
  if (status === 'completed' && (!Number.isFinite(Date.parse(b.start_at)) || Date.parse(b.start_at) > now.getTime())) {
    throw Error('课程尚未开始，不能标记完成');
  }
  return { ...b, status, updated_at: now.toISOString() };
}

export function saveBooking(b, all) {
  const old = all.find(x => x.id === b.id);
  if (old) {
    if (['completed', 'cancelled'].includes(old.status)) throw Error('已结束课程不可修改');
    if (old.status !== b.status || old.coach_id !== b.coach_id || old.created_at !== b.created_at) throw Error('不能通过编辑更改状态或课程归属');
  } else if (!['pending', 'confirmed'].includes(b.status)) {
    throw Error('新建课程必须为待确认或已确认');
  }
  validateBooking(b, all);
  return [...all.filter(x => x.id !== b.id), b];
}

export function validateReferences(data, b) {
  if (b.coach_id !== data.coach.id) throw Error('课程不属于当前教练');
  if (!data.students.some(s => s.id === b.student_id && s.coach_id === b.coach_id)) throw Error('学员不存在或不属于当前教练');
  if (!data.types.some(t => t.id === b.course_type_id)) throw Error('课程类型不存在');
}

function event(data, before, after, kind) {
  return {
    ...data,
    booking_events: [
      ...data.booking_events,
      { id: uid(), booking_id: after.id, coach_id: data.coach.id, kind, before: before ? { ...before } : null, after: { ...after }, created_at: new Date().toISOString() }
    ]
  };
}

export function saveBookingRecord(data, b) {
  validateReferences(data, b);
  const old = data.bookings.find(x => x.id === b.id) || null;
  const updated = { ...b, updated_at: new Date().toISOString() };
  const bookings = saveBooking(updated, data.bookings);
  const packageIssue = packageError(data, updated);
  if (packageIssue) throw Error(packageIssue);
  const unavailable = availabilityError(data, updated.start_at, updated.end_at, old ? old.id : '');
  if (unavailable) throw Error(unavailable);
  return event({ ...data, bookings }, old, updated, old ? 'edited' : 'created');
}

export function setBookingStatus(data, id, status) {
  const old = data.bookings.find(b => b.id === id);
  if (!old) throw Error('课程不存在');
  validateReferences(data, old);
  const updated = changeStatus(old, status);
  // 待确认不占课；确认时既要守住时段，也要守住套餐余额。
  if (status === 'confirmed') {
    const unavailable = availabilityError(data, updated.start_at, updated.end_at, updated.id);
    if (unavailable) throw Error(unavailable);
    const packageIssue = packageError(data, updated);
    if (packageIssue) throw Error(packageIssue);
  }
  return event({ ...data, bookings: data.bookings.map(b => (b.id === id ? updated : b)) }, old, updated, 'status');
}

/** 一节课属于它跨越的每个自然日（半开区间）。 */
export function onDay(b, day) {
  const start = new Date(day + 'T00:00:00');
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return Date.parse(b.start_at) < end.getTime() && Date.parse(b.end_at) > start.getTime();
}

/* ============================== 可预约时间 ============================== */

export function defaultAvailability() {
  const window = () => ({ id: uid(), days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '21:00' });
  return { business: [window()], work: [window()], breaks: [], buffer_minutes: 0, blocked: [] };
}

function localDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(day + 'T00:00:00');
  return Number.isFinite(d.getTime()) && dateKey(d) === day ? d : null;
}
function nextDate(d, offset = 1) {
  const n = new Date(d);
  n.setDate(n.getDate() + offset);
  return n;
}
function timeOnDate(d, hhmm) {
  const parts = hhmm.split(':').map(Number);
  const r = new Date(d);
  r.setHours(parts[0], parts[1], 0, 0);
  return r.getTime();
}
function rangeOverlaps(a, b) {
  return a.start < b.end && a.end > b.start;
}
function merge(ranges) {
  const out = [];
  for (const r of ranges.filter(x => x.end > x.start).sort((a, b) => a.start - b.start)) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}
function intersect(left, right) {
  return merge(left.flatMap(a => right.filter(b => rangeOverlaps(a, b)).map(b => ({ start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) }))));
}
function subtract(ranges, cuts) {
  let out = ranges;
  for (const cut of merge(cuts)) {
    out = out.flatMap(range => {
      if (!rangeOverlaps(range, cut)) return [range];
      const pieces = [];
      if (cut.start > range.start) pieces.push({ start: range.start, end: cut.start });
      if (cut.end < range.end) pieces.push({ start: cut.end, end: range.end });
      return pieces;
    });
  }
  return out;
}
/** 周期规则按「开始那天」归属，所以周一 22–02 的规则会覆盖周二 00–02。 */
function recurring(rules, date) {
  const anchors = [nextDate(date, -1), date];
  return merge(
    anchors.flatMap(anchor =>
      rules
        .filter(r => r.days.includes(anchor.getDay()))
        .map(rule => {
          const endDate = rule.end < rule.start ? nextDate(anchor) : anchor;
          return { start: timeOnDate(anchor, rule.start), end: timeOnDate(endDate, rule.end) };
        })
    )
  );
}

export function dayWindows(settings, day) {
  const date = localDay(day);
  if (!date) return [];
  const bounds = [{ start: date.getTime(), end: nextDate(date).getTime() }];
  const work = intersect(intersect(recurring(settings.business, date), recurring(settings.work, date)), bounds);
  return subtract(work, [...recurring(settings.breaks, date), ...settings.blocked.map(b => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))]);
}

function covers(settings, range) {
  let cursor = range.start;
  let date = new Date(range.start);
  date.setHours(0, 0, 0, 0);
  while (date.getTime() < range.end) {
    for (const w of dayWindows(settings, dateKey(date))) {
      if (w.end <= cursor) continue;
      if (w.start > cursor) return false;
      cursor = w.end;
      if (cursor >= range.end) return true;
    }
    const tomorrow = nextDate(date);
    if (cursor < tomorrow.getTime()) return false;
    date = tomorrow;
  }
  return cursor >= range.end;
}

export function availabilityError(data, start_at, end_at, excludeId) {
  const range = { start: Date.parse(start_at), end: Date.parse(end_at) };
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) return '请选择有效的开始时间和时长';
  const active = data.bookings.filter(b => b.id !== excludeId && b.coach_id === data.coach.id && b.status !== 'cancelled');
  if (active.some(b => rangeOverlaps(range, { start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))) return '此时段与已有课程重叠，请选择其他时间';
  const buffer = data.availability.buffer_minutes * MINUTE;
  if (buffer && active.some(b => rangeOverlaps(range, { start: Date.parse(b.start_at) - buffer, end: Date.parse(b.end_at) + buffer }))) {
    return `课程之间需间隔 ${data.availability.buffer_minutes} 分钟`;
  }
  if (data.availability.blocked.some(b => rangeOverlaps(range, { start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))) return '此时段已设为不可预约';
  if (!covers(data.availability, range)) return '此时段不在可预约时间内';
  return '';
}

/** 半小时一档的建议时段，用于排课页的时间选择。 */
export function availableSlots(data, day, duration = 60, excludeId) {
  const date = localDay(day);
  if (!date || !Number.isFinite(duration) || duration <= 0) return [];
  const slots = [];
  for (let minute = 0; minute < 1440; minute += 30) {
    const hour = Math.floor(minute / 60);
    const part = minute % 60;
    const start = new Date(date);
    start.setHours(hour, part, 0, 0);
    if (start.getHours() !== hour || start.getMinutes() !== part) continue;
    const end = new Date(start.getTime() + duration * MINUTE);
    if (!Number.isFinite(end.getTime())) continue;
    if (!availabilityError(data, start.toISOString(), end.toISOString(), excludeId)) {
      slots.push(`${String(hour).padStart(2, '0')}:${String(part).padStart(2, '0')}`);
    }
  }
  return slots;
}

/* ============================== 套餐课时 ============================== */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function packageBalance(data, packageId) {
  return data.lesson_tx.filter(t => t.package_id === packageId && t.coach_id === data.coach.id).reduce((sum, t) => sum + t.quantity, 0);
}

export function packageOccupied(data, packageId, excludeBookingId) {
  return data.bookings.filter(
    b => b.package_id === packageId && b.coach_id === data.coach.id && b.status === 'confirmed' && b.id !== excludeBookingId
  ).length;
}

export function isPackageExpired(pkg, day) {
  return !!pkg.expires_on && day > pkg.expires_on;
}

export function summarize(data, pkg, now = new Date()) {
  const remaining = packageBalance(data, pkg.id);
  const occupied = packageOccupied(data, pkg.id);
  return { pkg, total: pkg.total_sessions, used: pkg.total_sessions - remaining, remaining, occupied, available: remaining - occupied, expired: isPackageExpired(pkg, dateKey(now)) };
}

export function studentPackages(data, studentId, now = new Date()) {
  return data.packages
    .filter(p => p.student_id === studentId && p.coach_id === data.coach.id)
    .map(p => summarize(data, p, now))
    .sort(
      (a, b) =>
        Number(a.expired) - Number(b.expired) ||
        (a.pkg.expires_on || '9999-12-31').localeCompare(b.pkg.expires_on || '9999-12-31') ||
        a.pkg.created_at.localeCompare(b.pkg.created_at)
    );
}

export function matchingPackages(data, studentId, typeId, day) {
  return data.packages
    .filter(
      p =>
        p.student_id === studentId &&
        p.coach_id === data.coach.id &&
        (!p.course_type_id || p.course_type_id === typeId) &&
        !isPackageExpired(p, day) &&
        packageBalance(data, p.id) > 0
    )
    .map(p => summarize(data, p))
    .sort(
      (a, b) =>
        (a.pkg.expires_on || '9999-12-31').localeCompare(b.pkg.expires_on || '9999-12-31') ||
        b.available - a.available ||
        a.pkg.created_at.localeCompare(b.pkg.created_at)
    );
}

export function packageError(data, b) {
  if (!b.package_id) return '';
  const pkg = data.packages.find(p => p.id === b.package_id && p.coach_id === b.coach_id);
  if (!pkg) return '所选套餐不存在，请重新选择';
  if (pkg.student_id !== b.student_id) return '该套餐不属于这位学员';
  if (pkg.course_type_id && pkg.course_type_id !== b.course_type_id) return '该套餐不适用于这个课程类型';
  const day = dateKey(new Date(b.start_at));
  if (isPackageExpired(pkg, day)) return `套餐已过期（有效期至 ${pkg.expires_on}）`;
  if (b.status === 'confirmed') {
    const remaining = packageBalance(data, pkg.id);
    const occupied = packageOccupied(data, pkg.id, b.id);
    if (remaining - occupied < 1) return `套餐「${pkg.name}」课时不足：剩余 ${remaining} 节，已占用 ${occupied} 节`;
  }
  return '';
}

export function savePackage(data, input, id, now = new Date()) {
  if (!id) throw Error('套餐标识缺失，请重试');
  if (data.packages.some(p => p.id === id)) throw Error('这份套餐已经登记过了');
  const student = data.students.find(s => s.id === input.student_id && s.coach_id === data.coach.id);
  if (!student) throw Error('请选择学员');
  if (input.course_type_id && !data.types.some(t => t.id === input.course_type_id)) throw Error('课程类型不存在');
  const name = input.name.trim();
  if (!name || name.length > 40) throw Error('套餐名称需为 1–40 个字');
  if (!Number.isInteger(input.total_sessions) || input.total_sessions < 1 || input.total_sessions > 500) throw Error('总节数需为 1–500 的整数');
  if (!Number.isInteger(input.initial_used) || input.initial_used < 0 || input.initial_used > input.total_sessions) throw Error('期初已用需在 0 到总节数之间');
  if (!DAY_RE.test(input.purchased_on)) throw Error('请选择购买日期');
  if (input.expires_on) {
    if (!DAY_RE.test(input.expires_on)) throw Error('请选择有效的到期日期');
    if (input.expires_on < input.purchased_on) throw Error('到期日期不能早于购买日期');
  }
  if (input.notes.length > 200) throw Error('备注最多 200 字');

  const stamp = now.toISOString();
  const pkg = {
    id,
    coach_id: data.coach.id,
    student_id: input.student_id,
    course_type_id: input.course_type_id,
    name,
    total_sessions: input.total_sessions,
    initial_used: input.initial_used,
    purchased_on: input.purchased_on,
    expires_on: input.expires_on,
    notes: input.notes.trim(),
    created_at: stamp
  };
  const ledger = [{ id: uid(), coach_id: data.coach.id, package_id: id, booking_id: null, kind: 'purchase', quantity: input.total_sessions, reason: '购买', created_at: stamp }];
  if (input.initial_used > 0) {
    ledger.push({ id: uid(), coach_id: data.coach.id, package_id: id, booking_id: null, kind: 'adjust', quantity: -input.initial_used, reason: '期初已用', created_at: stamp });
  }
  return { ...data, packages: [...data.packages, pkg], lesson_tx: [...data.lesson_tx, ...ledger] };
}

export function consumeLesson(data, bookingId, now = new Date()) {
  const booking = data.bookings.find(b => b.id === bookingId && b.coach_id === data.coach.id);
  if (!booking) throw Error('课程不存在');
  if (booking.status !== 'completed') throw Error('只有已完成的课程才扣课时');
  if (!booking.package_id) return data;
  if (data.lesson_tx.some(t => t.booking_id === bookingId && t.kind === 'consume')) return data;
  const pkg = data.packages.find(p => p.id === booking.package_id);
  if (!pkg) throw Error('课程关联的套餐不存在，请先更正套餐归属');
  if (packageBalance(data, pkg.id) < 1) throw Error(`套餐「${pkg.name}」课时不足，请先续购或撤销扣课`);
  return {
    ...data,
    lesson_tx: [...data.lesson_tx, { id: uid(), coach_id: data.coach.id, package_id: pkg.id, booking_id: bookingId, kind: 'consume', quantity: -1, reason: '完成课程', created_at: now.toISOString() }]
  };
}

export function revertLesson(data, bookingId, reason, now = new Date()) {
  const text = (reason || '').trim();
  if (!text) throw Error('请填写更正原因');
  if (text.length > 200) throw Error('更正原因最多 200 字');
  const booking = data.bookings.find(b => b.id === bookingId && b.coach_id === data.coach.id);
  if (!booking) throw Error('课程不存在');
  const consume = data.lesson_tx.find(t => t.booking_id === bookingId && t.kind === 'consume');
  if (!consume) throw Error('这节课没有扣课记录，无需更正');
  if (data.lesson_tx.some(t => t.booking_id === bookingId && t.kind === 'refund')) throw Error('这节课已冲正过，不能重复操作');
  return {
    ...data,
    lesson_tx: [
      ...data.lesson_tx,
      { id: uid(), coach_id: data.coach.id, package_id: consume.package_id, booking_id: bookingId, kind: 'refund', quantity: 1, reason: text, created_at: now.toISOString() }
    ]
  };
}

export function packageLedger(data, packageId) {
  return data.lesson_tx
    .filter(t => t.package_id === packageId && t.coach_id === data.coach.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export function consumeOf(data, bookingId) {
  return data.lesson_tx.find(t => t.booking_id === bookingId && t.kind === 'consume') || null;
}

export function hasRefund(data, bookingId) {
  return data.lesson_tx.some(t => t.booking_id === bookingId && t.kind === 'refund');
}

export const txLabels = { purchase: '购买', consume: '完成扣课', refund: '撤销扣课', adjust: '调整' };

/* ============================== 训练记录 ============================== */

/** 训练记录存在（哪怕没评分）与评分存在是两件事；未评分不等于 0 分。 */
export const hasLog = r => !!r;
export const hasRating = r => !!r && r.rating !== null && r.rating !== undefined;

export function saveReview(data, bookingId, input) {
  const booking = data.bookings.find(b => b.id === bookingId && b.coach_id === data.coach.id);
  if (!booking || booking.status !== 'completed') throw Error('只能记录已完成的课程');
  const rating = input.rating;
  const minutes = input.actual_minutes;
  const notes = (input.notes || '').trim();
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw Error('训练表现应为 1–5 分，暂不评分时请留空');
  if (input.effort !== null && (!Number.isInteger(input.effort) || input.effort < 1 || input.effort > 10)) throw Error('用力程度应为 1–10，未询问学员时请留空');
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) throw Error('训练时长应为 1–600 分钟，未记录时请留空');
  if (notes.length > 1000) throw Error('训练记录最多 1000 字');
  if (rating === null && input.effort === null && minutes === null && !notes) throw Error('至少填写一项：评分、训练时长、用力程度或文字记录');
  const old = data.reviews.find(r => r.booking_id === bookingId);
  const now = new Date().toISOString();
  const review = {
    ...input,
    rating,
    actual_minutes: minutes,
    notes,
    id: old ? old.id : uid(),
    booking_id: bookingId,
    coach_id: data.coach.id,
    created_at: old ? old.created_at : now,
    updated_at: now
  };
  return { ...data, reviews: [...data.reviews.filter(r => r.booking_id !== bookingId), review] };
}

const minutesOf = b => Math.max(0, Math.round((Date.parse(b.end_at) - Date.parse(b.start_at)) / 60000));

/** 排课时长 = 预约起止时间之和，不是实际授课时长；页面必须按这个名字展示。 */
export function durationText(minutes) {
  if (!minutes) return '0 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
}

function completedRows(data, studentId, days, now) {
  const since = days ? shift(dateKey(now), 1 - days) : '';
  return data.bookings
    .filter(
      b =>
        b.coach_id === data.coach.id &&
        b.status === 'completed' &&
        (!studentId || b.student_id === studentId) &&
        dateKey(new Date(b.start_at)) >= since &&
        Date.parse(b.start_at) <= now.getTime()
    )
    .map(booking => ({ booking, review: data.reviews.find(r => r.booking_id === booking.id && r.coach_id === data.coach.id) || null }))
    .sort((a, b) => a.booking.start_at.localeCompare(b.booking.start_at));
}

export function teachingRecords(data, days, now = new Date()) {
  const all = completedRows(data, undefined, 0, now);
  const rows = completedRows(data, undefined, days, now).reverse();
  return {
    allCount: all.length,
    rows,
    latest: rows.slice(0, 3),
    rest: rows.slice(3),
    pending: rows.filter(row => !hasRating(row.review)),
    scheduledMinutes: rows.reduce((sum, row) => sum + minutesOf(row.booking), 0),
    loggedMinutes: rows.reduce((sum, row) => sum + ((row.review && row.review.actual_minutes) || 0), 0),
    loggedCount: rows.filter(row => hasLog(row.review)).length,
    ratedCount: rows.filter(row => hasRating(row.review)).length,
    effortCount: rows.filter(row => row.review && row.review.effort !== null && row.review.effort !== undefined).length
  };
}

export function trainingStats(data, studentId, days, now = new Date()) {
  const rows = completedRows(data, studentId, days, now);
  const rated = rows.filter(row => hasRating(row.review));
  const efforts = rows.flatMap(r => (r.review && r.review.effort !== null && r.review.effort !== undefined ? [r.review.effort] : []));
  const mean = values => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
  return {
    rows,
    rated,
    completed: rows.length,
    unrated: rows.length - rated.length,
    average: mean(rated.map(r => r.review.rating)),
    effort: mean(efforts),
    effortCount: efforts.length,
    loggedCount: rows.filter(row => hasLog(row.review)).length,
    minutes: rows.reduce((sum, row) => sum + ((row.review && row.review.actual_minutes) || 0), 0)
  };
}

/** 授课记录行的状态文案：没记录 / 有记录未评分 / 有评分，三者分开写。 */
export function statusText(review) {
  if (!review) return '未记录';
  const parts = [];
  if (review.actual_minutes !== null && review.actual_minutes !== undefined) parts.push(`训练 ${review.actual_minutes} 分钟`);
  parts.push(review.rating !== null && review.rating !== undefined ? `表现 ${review.rating}/5` : '未评分');
  if (review.effort !== null && review.effort !== undefined) parts.push(`用力 ${review.effort}/10`);
  return parts.join(' · ');
}

/* ============================== 学员 ============================== */

export function normalizePhone(phone) {
  return String(phone || '').replace(/[\s()\-]/g, '');
}

export function studentInput(data, input) {
  const name = input.name.trim();
  const phone = normalizePhone(input.phone);
  const notes = (input.notes || '').trim();
  const goal = (input.goal || '').trim();
  if (!name || name.length > 40) throw Error('姓名需为 1–40 个字');
  if (phone && !/^\+?\d{7,15}$/.test(phone)) throw Error('请输入有效联系电话（7–15 位数字）');
  if (notes.length > 1000) throw Error('备注最多 1000 字');
  if (goal.length > 200) throw Error('训练目标最多 200 字');
  if (input.preferences.some(id => !data.types.some(t => t.id === id))) throw Error('课程偏好已失效，请重新选择');
  return { name, phone, notes, goal, preferences: [...new Set(input.preferences)] };
}

export function createStudent(data, input, id, now = new Date()) {
  if (data.students.some(s => s.id === id)) throw Error('学员已保存，请勿重复提交');
  const student = { ...studentInput(data, input), id, coach_id: data.coach.id, created_at: now.toISOString() };
  return { ...data, students: [...data.students, student] };
}

export function updateStudent(data, id, input) {
  const student = data.students.find(s => s.id === id && s.coach_id === data.coach.id);
  if (!student) throw Error('学员不存在或不属于当前教练');
  const next = { ...student, ...studentInput(data, input) };
  return { ...data, students: data.students.map(s => (s.id === id ? next : s)) };
}

export function searchStudents(data, search) {
  const query = String(search || '').trim().toLowerCase();
  const phone = normalizePhone(query);
  return data.students.filter(
    s => s.coach_id === data.coach.id && (!query || s.name.toLowerCase().includes(query) || (phone && normalizePhone(s.phone).includes(phone)))
  );
}

function ownedCourses(data, id) {
  if (!data.students.some(s => s.id === id && s.coach_id === data.coach.id)) return [];
  return data.bookings.filter(b => b.student_id === id && b.coach_id === data.coach.id);
}

export function studentSummary(data, id, now = new Date()) {
  const courses = ownedCourses(data, id);
  const completed = courses
    .filter(b => b.status === 'completed' && Date.parse(b.start_at) <= now.getTime())
    .sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at));
  const active = courses.filter(b => ['confirmed', 'pending'].includes(b.status) && Date.parse(b.end_at) > now.getTime());
  return { completed: completed.length, active: active.length, last: completed[0] ? completed[0].start_at : null };
}

export function studentCourses(data, id, status = 'all', type = '', from = '', to = '', now = new Date()) {
  if (from && to && from > to) return [];
  const rows = ownedCourses(data, id).filter(b => {
    const day = dateKey(new Date(b.start_at));
    if ((type && b.course_type_id !== type) || (from && day < from) || (to && day > to)) return false;
    if (status === 'upcoming') return b.status === 'confirmed' && Date.parse(b.end_at) > now.getTime();
    return status === 'all' || b.status === status;
  });
  const ascending = status === 'upcoming' || status === 'pending';
  return rows.sort((a, b) => (Date.parse(a.start_at) - Date.parse(b.start_at)) * (ascending ? 1 : -1));
}

/* ============================== 工作台 ============================== */

export function workbench(data, now = new Date()) {
  const timestamp = now.getTime();
  const today = dateKey(now);
  const weekStart = weekDaysLocal(today)[0];
  const weekEnd = shift(weekStart, 7);
  const bookings = data.bookings.filter(b => b.coach_id === data.coach.id);
  const active = bookings.filter(b => b.status !== 'cancelled');
  const dayOf = b => dateKey(new Date(b.start_at));
  const todayCourses = active.filter(b => dayOf(b) === today);
  const confirmed = bookings.filter(b => b.status === 'confirmed' && Date.parse(b.end_at) > timestamp).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const next = confirmed[0] || null;
  const items = [];
  for (const b of bookings) {
    if (b.status !== 'pending' && b.status !== 'confirmed') continue;
    const start = Date.parse(b.start_at);
    const end = Date.parse(b.end_at);
    const conflict = end > timestamp ? availabilityError(data, b.start_at, b.end_at, b.id) : '';
    if (conflict) items.push({ booking: b, kind: 'conflict', reason: conflict });
    else if (b.status === 'pending') items.push({ booking: b, kind: 'pending', reason: '待确认' });
    else if (end <= timestamp) items.push({ booking: b, kind: 'unfinished', reason: '待记录完成' });
    else if (start <= timestamp + 2 * 60 * 60 * 1000) items.push({ booking: b, kind: 'soon', reason: start <= timestamp ? '进行中' : '即将开始' });
  }
  items.sort((a, b) => Date.parse(a.booking.start_at) - Date.parse(b.booking.start_at));
  return {
    today,
    todayCount: todayCourses.length,
    todayPending: todayCourses.filter(b => b.status === 'pending').length,
    weekCount: active.filter(b => dayOf(b) >= weekStart && dayOf(b) < weekEnd).length,
    monthCompleted: bookings.filter(b => b.status === 'completed' && dayOf(b).slice(0, 7) === today.slice(0, 7) && Date.parse(b.start_at) <= timestamp).length,
    next,
    ongoing: !!next && Date.parse(next.start_at) <= timestamp,
    items
  };
}

function weekDaysLocal(day) {
  const offset = (new Date(day + 'T12:00:00').getDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, i) => shift(day, i - offset));
}

/* ============================== 课程类型色调 ============================== */

const TONES = [
  { key: 'strength', match: ['力量', '增肌', '硬拉', '深蹲'], bg: '#e2f1df', ink: '#356b43' },
  { key: 'functional', match: ['功能', '体能', '体态', '核心'], bg: '#eae5fa', ink: '#6851a0' },
  { key: 'pilates', match: ['普拉提', '塑形', '瑜伽'], bg: '#fce9db', ink: '#a45d35' },
  { key: 'cardio', match: ['有氧', '心肺', '跑步', '骑行'], bg: '#dfebfc', ink: '#4268a5' },
  { key: 'recovery', match: ['拉伸', '恢复', '放松', '康复'], bg: '#f9e5ed', ink: '#a64d70' }
];
const OTHER = { key: 'other', bg: '#f0f1f3', ink: '#59616d' };

export function toneOf(type) {
  const name = (type && type.name) || '';
  return TONES.find(t => t.match.some(word => name.includes(word))) || OTHER;
}

export function toneById(types, id) {
  return toneOf(types.find(t => t.id === id));
}
