/**
 * 对照测试：同一份数据分别喂给 web 端（src/services）和小程序端（weapp/utils/rules.js），
 * 断言两边算出来完全一致。只改一边就会红，避免两个客户端悄悄走偏。
 */
import { describe, it, expect } from 'vitest';
import * as webPackages from '../../src/services/packages';
import * as webReviews from '../../src/services/reviews';
import * as webBooking from '../../src/services/booking';
import * as webAvailability from '../../src/services/availability';
import * as webStudents from '../../src/services/students';
import * as app from '../utils/rules';

const day = n => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const at = (d, h, m = 0) => {
  const [y, mo, da] = d.split('-').map(Number);
  return new Date(y, mo - 1, da, h, m, 0, 0).toISOString();
};

function fixture() {
  const coach = { id: 'coach-1', name: 'Alex', email: 'a@b.c', created_at: at(day(-60), 9) };
  const types = [
    { id: 't1', name: '力量训练', default_duration: 60, color: '#ff7052' },
    { id: 't2', name: '功能训练', default_duration: 60, color: '#4263eb' },
    { id: 't3', name: '普拉提', default_duration: 60, color: '#0e9f8e' }
  ];
  const students = ['s1', 's2', 's3'].map((id, i) => ({
    id,
    coach_id: coach.id,
    name: ['林晓', '陈宇', '王可欣'][i],
    phone: `1380000000${i}`,
    goal: '',
    notes: '',
    created_at: at(day(-60), 9),
    preferences: [types[i].id]
  }));
  const mk = (id, student, type, d, hour, status, packageId = null) => ({
    id,
    coach_id: coach.id,
    student_id: student,
    course_type_id: type,
    start_at: at(d, hour),
    end_at: at(d, hour + 1),
    status,
    notes: '',
    package_id: packageId,
    created_at: at(d, hour),
    updated_at: at(d, hour)
  });
  const bookings = [
    mk('b1', 's1', 't1', day(-1), 9, 'completed', 'pkg1'),
    mk('b2', 's2', 't2', day(-3), 11, 'completed'),
    mk('b3', 's1', 't1', day(-10), 9, 'completed', 'pkg1'),
    mk('b4', 's3', 't3', day(-40), 15, 'completed'),
    mk('b5', 's2', 't2', day(0), 11, 'confirmed'),
    mk('b6', 's3', 't3', day(0), 14, 'pending'),
    mk('b7', 's1', 't1', day(0), 17, 'confirmed', 'pkg1'),
    mk('b8', 's2', 't2', day(-2), 9, 'cancelled'),
    mk('b9', 's1', 't1', day(1), 10, 'confirmed'),
    mk('b10', 's1', 't1', day(2), 10, 'completed')
  ];
  const reviews = [
    { id: 'r1', booking_id: 'b1', coach_id: coach.id, rating: 4, effort: 7, actual_minutes: 55, notes: '稳定', created_at: at(day(-1), 10), updated_at: at(day(-1), 10) },
    { id: 'r2', booking_id: 'b2', coach_id: coach.id, rating: null, effort: null, actual_minutes: 45, notes: '', created_at: at(day(-3), 12), updated_at: at(day(-3), 12) },
    { id: 'r3', booking_id: 'b4', coach_id: coach.id, rating: 5, effort: null, actual_minutes: null, notes: '', created_at: at(day(-40), 16), updated_at: at(day(-40), 16) }
  ];
  const packages = [
    { id: 'pkg1', coach_id: coach.id, student_id: 's1', course_type_id: null, name: '私教 12 节', total_sessions: 12, initial_used: 7, purchased_on: day(-20), expires_on: null, notes: '', created_at: at(day(-20), 9) },
    { id: 'pkg2', coach_id: coach.id, student_id: 's2', course_type_id: 't2', name: '功能 10 节', total_sessions: 10, initial_used: 0, purchased_on: day(-30), expires_on: day(-1), notes: '', created_at: at(day(-30), 9) }
  ];
  const lesson_tx = [
    { id: 'x1', coach_id: coach.id, package_id: 'pkg1', booking_id: null, kind: 'purchase', quantity: 12, reason: '购买', created_at: at(day(-20), 9) },
    { id: 'x2', coach_id: coach.id, package_id: 'pkg1', booking_id: null, kind: 'adjust', quantity: -7, reason: '期初已用', created_at: at(day(-20), 9) },
    { id: 'x3', coach_id: coach.id, package_id: 'pkg1', booking_id: 'b1', kind: 'consume', quantity: -1, reason: '完成课程', created_at: at(day(-1), 10) },
    { id: 'x4', coach_id: coach.id, package_id: 'pkg2', booking_id: null, kind: 'purchase', quantity: 10, reason: '购买', created_at: at(day(-30), 9) }
  ];
  return {
    coach,
    types,
    students,
    bookings,
    reviews,
    booking_events: [],
    packages,
    lesson_tx,
    availability: {
      business: [{ id: 'w1', days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '21:00' }],
      work: [{ id: 'w2', days: [0, 1, 2, 3, 4, 5, 6], start: '08:00', end: '21:00' }],
      breaks: [],
      buffer_minutes: 0,
      blocked: []
    }
  };
}

const sum = (data, id) => {
  const p = data.packages.find(x => x.id === id);
  return p ? webPackages.summarize(data, p) : null;
};

function webRecords(data, days) {
  const r = webReviews.teachingRecords(data, days, new Date());
  return {
    allCount: r.allCount,
    rows: r.rows.map(x => x.booking.id),
    latest: r.latest.map(x => x.booking.id),
    rest: r.rest.map(x => x.booking.id),
    pending: r.pending.map(x => x.booking.id),
    scheduledMinutes: r.scheduledMinutes,
    loggedMinutes: r.loggedMinutes,
    loggedCount: r.loggedCount,
    ratedCount: r.ratedCount,
    effortCount: r.effortCount
  };
}
function appRecords(data, days) {
  const r = app.teachingRecords(data, days, new Date());
  return {
    allCount: r.allCount,
    rows: r.rows.map(x => x.booking.id),
    latest: r.latest.map(x => x.booking.id),
    rest: r.rest.map(x => x.booking.id),
    pending: r.pending.map(x => x.booking.id),
    scheduledMinutes: r.scheduledMinutes,
    loggedMinutes: r.loggedMinutes,
    loggedCount: r.loggedCount,
    ratedCount: r.ratedCount,
    effortCount: r.effortCount
  };
}

describe('小程序与 web 端业务口径一致', () => {
  const data = fixture();

  it('套餐余额、占用、可约', () => {
    for (const id of ['pkg1', 'pkg2']) {
      const w = sum(data, id);
      const a = app.summarize(data, data.packages.find(p => p.id === id));
      expect([a.total, a.used, a.remaining, a.occupied, a.available, a.expired]).toEqual([w.total, w.used, w.remaining, w.occupied, w.available, w.expired]);
    }
    // 12 − 7 − 1 = 4；今天那节已确认，占 1；可约 3。
    expect(app.summarize(data, data.packages[0]).remaining).toBe(4);
    expect(app.summarize(data, data.packages[0]).available).toBe(3);
  });

  it('档案套餐排序与可约套餐筛选', () => {
    const w = webPackages.studentPackages(data, 's1', new Date()).map(p => [p.pkg.id, p.remaining, p.available, p.expired]);
    const a = app.studentPackages(data, 's1', new Date()).map(p => [p.pkg.id, p.remaining, p.available, p.expired]);
    expect(a).toEqual(w);

    const wm = webPackages.matchingPackages(data, 's1', 't1', day(0)).map(p => p.pkg.id);
    const am = app.matchingPackages(data, 's1', 't1', day(0)).map(p => p.pkg.id);
    expect(am).toEqual(wm);

    // 已过期的那份不参与排课选择。
    expect(app.matchingPackages(data, 's2', 't2', day(0)).map(p => p.pkg.id)).toEqual(webPackages.matchingPackages(data, 's2', 't2', day(0)).map(p => p.pkg.id));
  });

  it('课程关联套餐的校验文案', () => {
    const base = data.bookings[6]; // b7：s1 + t1 + pkg1
    const cases = [
      { ...base, student_id: 's2' },
      { ...base, package_id: 'missing' },
      { ...base, course_type_id: 't2' },
      { ...base, start_at: at(day(-30), 9), end_at: at(day(-30), 10) }
    ];
    for (const c of cases) expect(app.packageError(data, c)).toBe(webPackages.packageError(data, c));
  });

  it('授课记录：7 / 30 / 90 / 全部', () => {
    for (const days of [7, 30, 90, 0]) expect(appRecords(data, days)).toEqual(webRecords(data, days));
    // 未来标记完成的课程不计入。
    expect(appRecords(data, 0).rows).toEqual(['b1', 'b2', 'b3', 'b4']);
    // 待补反馈 = 范围内没有评分的已完成课程：b2 有记录但未评分，也算待补。
    expect(appRecords(data, 30).pending).toEqual(['b2', 'b3']);
  });

  it('学员个人训练表现', () => {
    for (const id of ['s1', 's2', 's3']) {
      for (const days of [30, 0]) {
        const w = webReviews.trainingStats(data, id, days, new Date());
        const a = app.trainingStats(data, id, days, new Date());
        expect([a.completed, a.unrated, a.average, a.effort, a.effortCount, a.loggedCount, a.minutes]).toEqual([
          w.completed,
          w.unrated,
          w.average,
          w.effort,
          w.effortCount,
          w.loggedCount,
          w.minutes
        ]);
      }
    }
  });

  it('时间文案：排课时长与训练时长分开', () => {
    for (const n of [0, 30, 45, 59, 60, 75, 120, 125]) expect(app.durationText(n)).toBe(webReviews.durationText(n));
  });

  it('状态流转与不可逆规则', () => {
    expect(app.changeStatus(data.bookings[5], 'confirmed').status).toBe(webBooking.changeStatus(data.bookings[5], 'confirmed').status);
    const completed = data.bookings[0];
    expect(() => app.changeStatus(completed, 'confirmed')).toThrow();
    expect(() => webBooking.changeStatus(completed, 'confirmed')).toThrow();
    const future = data.bookings[8]; // 明天的已确认
    expect(() => app.changeStatus(future, 'completed')).toThrow('课程尚未开始，不能标记完成');
    expect(() => webBooking.changeStatus(future, 'completed')).toThrow('课程尚未开始，不能标记完成');
  });

  it('冲突与可预约时间判定', () => {
    const ranges = [
      [at(day(0), 11), at(day(0), 12)], // 与 b5 重叠
      [at(day(0), 12), at(day(0), 13)], // 空档
      [at(day(0), 6), at(day(0), 7)], // 营业时间外
      [at(day(0), 20, 30), at(day(0), 21, 30)] // 跨营业结束
    ];
    for (const [s, e] of ranges) expect(app.availabilityError(data, s, e)).toBe(webAvailability.availabilityError(data, s, e));
    expect(app.availableSlots(data, day(0), 60)).toEqual(webAvailability.availableSlots(data, day(0), 60));
    expect(app.dayWindows(data.availability, day(0)).map(w => [w.start, w.end])).toEqual(webAvailability.dayWindows(data.availability, day(0)).map(w => [w.start, w.end]));
  });

  it('新建课程走同一套保存规则', () => {
    const draft = {
      id: 'new-1',
      coach_id: 'coach-1',
      student_id: 's2',
      course_type_id: 't2',
      start_at: at(day(0), 12),
      end_at: at(day(0), 13),
      status: 'confirmed',
      notes: '',
      package_id: null,
      created_at: at(day(0), 9),
      updated_at: at(day(0), 9)
    };
    const w = webBooking.saveBookingRecord(data, draft);
    const a = app.saveBookingRecord(data, draft);
    expect(a.bookings.length).toBe(w.bookings.length);
    expect(a.booking_events.length).toBe(w.booking_events.length);

    const overlapping = { ...draft, id: 'new-2', start_at: at(day(0), 11), end_at: at(day(0), 12) };
    expect(() => app.saveBookingRecord(data, overlapping)).toThrow('此时段与已有课程重叠，请选择其他时间');
    expect(() => webBooking.saveBookingRecord(data, overlapping)).toThrow('此时段与已有课程重叠，请选择其他时间');
  });

  it('完成扣课与冲正幂等', () => {
    // 用一节「已经过去的已确认课程」来验证完成扣课（今天的课可能还没开始）。
    const past = { ...data.bookings[0], id: 'b11', status: 'confirmed', start_at: at(day(-1), 19), end_at: at(day(-1), 20) };
    const state = { ...data, bookings: [...data.bookings, past] };
    const done = app.setBookingStatus(state, 'b11', 'completed');
    const after = app.consumeLesson(done, 'b11');
    expect(app.packageBalance(after, 'pkg1')).toBe(3);
    // 重复调用只留一条扣减。
    expect(app.packageBalance(app.consumeLesson(after, 'b11'), 'pkg1')).toBe(3);
    expect(after.lesson_tx.filter(t => t.booking_id === 'b11' && t.kind === 'consume')).toHaveLength(1);

    const reverted = app.revertLesson(after, 'b11', '选错套餐');
    expect(app.packageBalance(reverted, 'pkg1')).toBe(4);
    expect(() => app.revertLesson(reverted, 'b11', '再来一次')).toThrow('这节课已冲正过，不能重复操作');
  });

  it('登记套餐写购买与期初已用两条流水', () => {
    const input = { student_id: 's3', course_type_id: null, name: '体验 6 节', total_sessions: 6, initial_used: 2, purchased_on: day(0), expires_on: null, notes: '' };
    const w = webPackages.savePackage(data, input, 'pkg3');
    const a = app.savePackage(data, input, 'pkg3');
    expect(a.lesson_tx.length).toBe(w.lesson_tx.length);
    expect(a.packages.length).toBe(w.packages.length);
    expect(app.packageBalance(a, 'pkg3')).toBe(4);
    expect(() => app.savePackage(data, { ...input, initial_used: 9 }, 'pkg4')).toThrow('期初已用需在 0 到总节数之间');
  });

  it('课后记录：未评分合法，空记录被拒', () => {
    const only = { rating: null, effort: null, actual_minutes: 40, notes: '' };
    const w = webReviews.saveReview(data, 'b3', only);
    const a = app.saveReview(data, 'b3', only);
    expect(a.reviews.find(r => r.booking_id === 'b3').rating).toBe(null);
    expect(w.reviews.find(r => r.booking_id === 'b3').rating).toBe(null);
    expect(() => app.saveReview(data, 'b3', { rating: null, effort: null, actual_minutes: null, notes: '  ' })).toThrow('至少填写一项');
    expect(() => webReviews.saveReview(data, 'b3', { rating: null, effort: null, actual_minutes: null, notes: '  ' })).toThrow('至少填写一项');
  });

  it('学员汇总与搜索', () => {
    for (const id of ['s1', 's2', 's3']) {
      const w = webStudents.studentSummary(data, id, new Date());
      const a = app.studentSummary(data, id, new Date());
      expect([a.completed, a.active]).toEqual([w.completed, w.active]);
    }
    expect(app.searchStudents(data, '林').map(s => s.id)).toEqual(webStudents.searchStudents(data, '林').map(s => s.id));
    expect(app.searchStudents(data, '13800000001').map(s => s.id)).toEqual(webStudents.searchStudents(data, '13800000001').map(s => s.id));
  });
});
