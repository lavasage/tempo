import {describe, it, expect} from 'vitest';
import {defaultAvailability} from './availability';
import {
  consumeLesson, defaultPackage, matchingPackages, packageBalance, packageError,
  packageLedger, revertLesson, savePackage, studentPackages, summarize, type PackageInput
} from './packages';
import type {Booking, Database, LessonPackage} from '../types';

const COACH = 'coach-1';

function base(): Database {
  return {
    coach: {id: COACH, name: 'Alex', email: 'a@tempo.local', created_at: '2026-01-01T00:00:00Z'},
    students: [
      {id: 's1', coach_id: COACH, name: '林晓', phone: '', notes: '', preferences: [], created_at: '2026-01-01T00:00:00Z'},
      {id: 's2', coach_id: COACH, name: '陈宇', phone: '', notes: '', preferences: [], created_at: '2026-01-01T00:00:00Z'}
    ],
    types: [
      {id: 't1', name: '力量训练', default_duration: 60, color: '#ff7052'},
      {id: 't2', name: '普拉提', default_duration: 60, color: '#0e9f8e'}
    ],
    bookings: [], reviews: [], booking_events: [], packages: [], lesson_tx: [],
    availability: defaultAvailability()
  };
}

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'b1', coach_id: COACH, student_id: 's1', course_type_id: 't1',
    start_at: '2026-12-01T09:00:00', end_at: '2026-12-01T10:00:00',
    status: 'confirmed', notes: '', package_id: 'p1',
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...over
  };
}

const input = (over: Partial<PackageInput> = {}): PackageInput => ({
  student_id: 's1', course_type_id: null, name: '私教 12 节',
  total_sessions: 12, initial_used: 7, purchased_on: '2026-11-01', expires_on: null, notes: '', ...over
});

function withPackage(over: Partial<PackageInput> = {}): Database {
  return savePackage(base(), input(over), 'p1', new Date('2026-11-01T10:00:00'));
}

describe('套餐课时', () => {
  it('登记 12 节、期初已用 7 节：剩余 5、已上 7、可约 5', () => {
    const data = withPackage();
    const [p] = studentPackages(data, 's1', new Date('2026-11-02T00:00:00'));
    expect(p!.total).toBe(12);
    expect(p!.used).toBe(7);
    expect(p!.remaining).toBe(5);
    expect(p!.occupied).toBe(0);
    expect(p!.available).toBe(5);
    expect(packageLedger(data, 'p1')).toHaveLength(2);
  });

  it('已确认占 1 节，待确认不占课', () => {
    let data = withPackage();
    data = {...data, bookings: [booking()]};
    expect(summarize(data, data.packages[0]!).occupied).toBe(1);
    expect(summarize(data, data.packages[0]!).available).toBe(4);
    data = {...data, bookings: [booking({status: 'pending'})]};
    expect(summarize(data, data.packages[0]!).available).toBe(5);
  });

  it('完成扣 1 节并释放占用，重复调用只扣一次', () => {
    let data = {...withPackage(), bookings: [booking()]};
    data = {...data, bookings: [{...data.bookings[0]!, status: 'completed'}]};
    data = consumeLesson(data, 'b1');
    let p = summarize(data, data.packages[0]!);
    expect(p.remaining).toBe(4);
    expect(p.occupied).toBe(0);
    expect(p.used).toBe(8);
    const again = consumeLesson(data, 'b1');
    p = summarize(again, again.packages[0]!);
    expect(p.remaining).toBe(4);
    expect(again.lesson_tx.filter(t => t.kind === 'consume')).toHaveLength(1);
  });

  it('取消只释放占用，不动流水', () => {
    let data = {...withPackage(), bookings: [booking()]};
    data = {...data, bookings: [{...data.bookings[0]!, status: 'cancelled'}]};
    const p = summarize(data, data.packages[0]!);
    expect(p.remaining).toBe(5);
    expect(p.occupied).toBe(0);
    expect(data.lesson_tx.filter(t => t.kind === 'consume')).toHaveLength(0);
  });

  it('撤销扣课写冲正流水，保留原扣减，且不能重复冲正', () => {
    let data: Database = {...withPackage(), bookings: [{...booking(), status: 'completed' as const}]};
    data = consumeLesson(data, 'b1');
    const reverted = revertLesson(data, 'b1', '误点完成');
    const p = summarize(reverted, reverted.packages[0]!);
    expect(p.remaining).toBe(5);
    expect(reverted.lesson_tx.filter(t => t.kind === 'consume')).toHaveLength(1);
    expect(reverted.lesson_tx.filter(t => t.kind === 'refund')).toHaveLength(1);
    expect(() => revertLesson(reverted, 'b1', 'again')).toThrow('冲正');
    expect(() => revertLesson(data, 'b1', '   ')).toThrow('原因');
  });

  it('课程与套餐不匹配时给出可执行的原因', () => {
    const data = withPackage();
    expect(packageError(data, booking({package_id: null}))).toBe('');
    expect(packageError(data, booking({student_id: 's2'}))).toContain('不属于这位学员');
    expect(packageError(data, booking({course_type_id: 't2', package_id: 'p1'}))).toBe('');
    const typed = withPackage({course_type_id: 't2'});
    expect(packageError(typed, booking({course_type_id: 't1'}))).toContain('不适用于这个课程类型');
    const expired = withPackage({expires_on: '2026-11-30'});
    expect(packageError(expired, booking())).toContain('已过期');
    expect(packageError(expired, booking({start_at: '2026-11-30T09:00:00', end_at: '2026-11-30T10:00:00'}))).toBe('');
  });

  it('排满后不能再确认，且编辑已有课程时不把自己算成占用', () => {
    // 12 节全部用掉，只剩 0 节可约
    let data = withPackage({total_sessions: 2, initial_used: 2});
    expect(packageError(data, booking())).toContain('课时不足');
    // 剩 1 节、已有 1 节确认占用：新课被拒，正在编辑的那节课本身仍然通过
    data = withPackage({total_sessions: 2, initial_used: 1});
    data = {...data, bookings: [booking()]};
    expect(packageError(data, booking())).toBe('');
    expect(packageError(data, booking({id: 'b2'}))).toContain('课时不足');
  });

  it('可约套餐按最早到期排序，过期与类型不符的被排除', () => {
    let data = base();
    const p1: LessonPackage = {id: 'p1', coach_id: COACH, student_id: 's1', course_type_id: null, name: 'A', total_sessions: 4, initial_used: 0, purchased_on: '2026-11-01', expires_on: '2027-02-01', notes: '', created_at: '2026-11-01T00:00:00Z'};
    const p2: LessonPackage = {...p1, id: 'p2', name: 'B', expires_on: '2026-12-15', created_at: '2026-11-02T00:00:00Z'};
    const p3: LessonPackage = {...p1, id: 'p3', name: '过期', expires_on: '2026-11-01'};
    const p4: LessonPackage = {...p1, id: 'p4', name: '普拉提', course_type_id: 't2'};
    data = {
      ...data, packages: [p1, p2, p3, p4],
      lesson_tx: [p1, p2, p3, p4].map((p, i) => ({id: 'tx' + i, coach_id: COACH, package_id: p.id, booking_id: null, kind: 'purchase' as const, quantity: 4, reason: '购买', created_at: '2026-11-01T00:00:00Z'}))
    };
    const options = matchingPackages(data, 's1', 't1', '2026-11-20');
    expect(options.map(o => o.pkg.id)).toEqual(['p2', 'p1']);
    expect(defaultPackage(data, 's1', 't1', '2026-11-20')).toBe('p2');
    expect(packageBalance(data, 'p3')).toBe(4);
  });

  it('登记参数校验：总节数、期初、有效期', () => {
    expect(() => savePackage(base(), input({total_sessions: 0}), 'p1')).toThrow('总节数');
    expect(() => savePackage(base(), input({initial_used: 13}), 'p1')).toThrow('期初已用');
    expect(() => savePackage(base(), input({expires_on: '2026-10-01'}), 'p1')).toThrow('不能早于购买日期');
    expect(() => savePackage(base(), input({name: '  '}), 'p1')).toThrow('套餐名称');
    expect(() => savePackage(withPackage(), input(), 'p1')).toThrow('已经登记');
  });
});
