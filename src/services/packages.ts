/**
 * 套餐课时（本地原子服务）
 *
 * 规则来自产品评审「套餐课时 MVP」：
 * - 每次购买独立建档，续购是新的记录，不回改旧记录的总节数；
 * - 余额只有一个来源：该套餐全部流水求和（购买 +N、期初已用 −N、完成 −1、冲正 +1）；
 * - 待确认不占课，已确认占 1 节；完成时把占用转成扣减；取消只释放占用，不写流水；
 * - 旧课默认未关联，不从历史完成数推算余额。
 *
 * 这里全部是纯函数：输入 Database 返回新的 Database，由 store 一次性提交。
 */
import type {Booking, Database, LessonPackage, LessonTransaction} from '../types';
import {dateKey} from '../composables/date';

export interface PackageInput {
  student_id: string;
  course_type_id: string | null;
  name: string;
  total_sessions: number;
  initial_used: number;
  purchased_on: string;
  expires_on: string | null;
  notes: string;
}

export interface PackageSummary {
  pkg: LessonPackage;
  total: number;
  /** 已上 = 总节数 − 余额，含期初已用与已完成的课。 */
  used: number;
  /** 剩余 = 流水求和，可继续约的总量。 */
  remaining: number;
  /** 已被已确认（未完成）的课程占用的节数。 */
  occupied: number;
  /** 可约 = 剩余 − 占用。 */
  available: number;
  expired: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function own(data: Database, pkg: LessonPackage) {
  return pkg.coach_id === data.coach.id;
}

export function packageBalance(data: Database, packageId: string): number {
  return data.lesson_tx
    .filter(t => t.package_id === packageId && t.coach_id === data.coach.id)
    .reduce((sum, t) => sum + t.quantity, 0);
}

/** 已确认（还没完成）的课程才算占用；exclude 用于编辑已有课程时不把它自己算进去。 */
export function packageOccupied(data: Database, packageId: string, excludeBookingId = ''): number {
  return data.bookings.filter(
    b => b.package_id === packageId && b.coach_id === data.coach.id && b.status === 'confirmed' && b.id !== excludeBookingId
  ).length;
}

/** 有效期按上课当地日判断：当天仍可用。 */
export function isPackageExpired(pkg: LessonPackage, day: string): boolean {
  return !!pkg.expires_on && day > pkg.expires_on;
}

export function summarize(data: Database, pkg: LessonPackage, now = new Date()): PackageSummary {
  const remaining = packageBalance(data, pkg.id);
  const occupied = packageOccupied(data, pkg.id);
  return {
    pkg,
    total: pkg.total_sessions,
    used: pkg.total_sessions - remaining,
    remaining,
    occupied,
    available: remaining - occupied,
    expired: isPackageExpired(pkg, dateKey(now))
  };
}

/** 档案里逐份显示：先未过期，再按到期时间近到远，没填有效期的排最后。 */
export function studentPackages(data: Database, studentId: string, now = new Date()): PackageSummary[] {
  return data.packages
    .filter(p => p.student_id === studentId && own(data, p))
    .map(p => summarize(data, p, now))
    .sort(
      (a, b) =>
        Number(a.expired) - Number(b.expired) ||
        (a.pkg.expires_on ?? '9999-12-31').localeCompare(b.pkg.expires_on ?? '9999-12-31') ||
        a.pkg.created_at.localeCompare(b.pkg.created_at)
    );
}

/** 排课时可选的套餐：学员一致、课程类型适配、未过期、还有余额。 */
export function matchingPackages(data: Database, studentId: string, typeId: string, day: string): PackageSummary[] {
  return data.packages
    .filter(
      p =>
        p.student_id === studentId &&
        own(data, p) &&
        (!p.course_type_id || p.course_type_id === typeId) &&
        !isPackageExpired(p, day) &&
        packageBalance(data, p.id) > 0
    )
    .map(p => summarize(data, p))
    .sort(
      (a, b) =>
        (a.pkg.expires_on ?? '9999-12-31').localeCompare(b.pkg.expires_on ?? '9999-12-31') ||
        b.available - a.available ||
        a.pkg.created_at.localeCompare(b.pkg.created_at)
    );
}

/** 建议默认选中的套餐：最早到期的那份，且真的还能约。 */
export function defaultPackage(data: Database, studentId: string, typeId: string, day: string): string {
  const options = matchingPackages(data, studentId, typeId, day);
  return (options.find(o => o.available > 0) ?? options[0])?.pkg.id ?? '';
}

/** 课程与套餐的匹配校验；返回空串表示没问题。 */
export function packageError(data: Database, b: Booking): string {
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

/** 登记或续购：写入套餐 + 购买流水（+N）+ 期初已用（−N）。 */
export function savePackage(data: Database, input: PackageInput, id: string, now = new Date()): Database {
  if (!id) throw Error('套餐标识缺失，请重试');
  if (data.packages.some(p => p.id === id)) throw Error('这份套餐已经登记过了');
  const student = data.students.find(s => s.id === input.student_id && s.coach_id === data.coach.id);
  if (!student) throw Error('请选择学员');
  if (input.course_type_id && !data.types.some(t => t.id === input.course_type_id)) throw Error('课程类型不存在');
  const name = input.name.trim();
  if (!name || name.length > 40) throw Error('套餐名称需为 1–40 个字');
  if (!Number.isInteger(input.total_sessions) || input.total_sessions < 1 || input.total_sessions > 500) {
    throw Error('总节数需为 1–500 的整数');
  }
  if (!Number.isInteger(input.initial_used) || input.initial_used < 0 || input.initial_used > input.total_sessions) {
    throw Error('期初已用需在 0 到总节数之间');
  }
  if (!DAY.test(input.purchased_on)) throw Error('请选择购买日期');
  if (input.expires_on) {
    if (!DAY.test(input.expires_on)) throw Error('请选择有效的到期日期');
    if (input.expires_on < input.purchased_on) throw Error('到期日期不能早于购买日期');
  }
  if (input.notes.length > 200) throw Error('备注最多 200 字');

  const stamp = now.toISOString();
  const pkg: LessonPackage = {
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
  const ledger: LessonTransaction[] = [
    {id: crypto.randomUUID(), coach_id: data.coach.id, package_id: id, booking_id: null, kind: 'purchase', quantity: input.total_sessions, reason: '购买', created_at: stamp}
  ];
  if (input.initial_used > 0) {
    ledger.push({id: crypto.randomUUID(), coach_id: data.coach.id, package_id: id, booking_id: null, kind: 'adjust', quantity: -input.initial_used, reason: '期初已用', created_at: stamp});
  }
  return {...data, packages: [...data.packages, pkg], lesson_tx: [...data.lesson_tx, ...ledger]};
}

/** 完成课程后扣 1 节；同一节课重复调用只会产生一条扣减。 */
export function consumeLesson(data: Database, bookingId: string, now = new Date()): Database {
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
    lesson_tx: [
      ...data.lesson_tx,
      {id: crypto.randomUUID(), coach_id: data.coach.id, package_id: pkg.id, booking_id: bookingId, kind: 'consume', quantity: -1, reason: '完成课程', created_at: now.toISOString()}
    ]
  };
}

/** 撤销误扣：写一条冲正流水，原扣减保留；课程状态不因此回退。 */
export function revertLesson(data: Database, bookingId: string, reason: string, now = new Date()): Database {
  const text = reason.trim();
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
      {
        id: crypto.randomUUID(), coach_id: data.coach.id, package_id: consume.package_id, booking_id: bookingId,
        kind: 'refund', quantity: 1, reason: text, created_at: now.toISOString()
      }
    ]
  };
}

/** 流水按时间倒序，给课程抽屉和档案展示。 */
export function packageLedger(data: Database, packageId: string): LessonTransaction[] {
  return data.lesson_tx
    .filter(t => t.package_id === packageId && t.coach_id === data.coach.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

export function consumeOf(data: Database, bookingId: string): LessonTransaction | null {
  return data.lesson_tx.find(t => t.booking_id === bookingId && t.kind === 'consume') ?? null;
}

export function hasRefund(data: Database, bookingId: string): boolean {
  return data.lesson_tx.some(t => t.booking_id === bookingId && t.kind === 'refund');
}

export const txLabels: Record<LessonTransaction['kind'], string> = {
  purchase: '购买',
  consume: '完成扣课',
  refund: '撤销扣课',
  adjust: '调整'
};
