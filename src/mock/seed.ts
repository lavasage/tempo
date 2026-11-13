import type {Database, LessonPackage} from '../types';
import {defaultAvailability} from '../services/availability';
import {dateKey} from '../composables/date';

/** 本地演示数据：4 节今天的课 + 林晓的一份私教套餐（12 节，期初已用 7 节）。 */
export function seed(): Database {
  const now = new Date().toISOString();
  const cid = crypto.randomUUID();
  const types = ['力量训练', '功能训练', '普拉提'].map((name, i) => ({
    id: crypto.randomUUID(), name, default_duration: 60, color: ['#ff7052', '#4263eb', '#0e9f8e'][i]!
  }));
  const roster: [string, string, string][] = [
    ['林晓', '12 周改善圆肩，能完成标准硬拉', '改善体态，循序渐进'],
    ['陈宇', '提升深蹲 1RM 到 100kg', '专注基础力量'],
    ['王可欣', '体脂降到 22%，保持每周三练', '喜欢上午训练'],
    ['赵一鸣', '增肌期，重点关注肩背', '时间不固定，提前一天确认'],
    ['周宁', '产后恢复核心与盆底功能', '避免高冲击动作']
  ];
  const students = roster.map(([name, goal, notes], i) => ({
    id: crypto.randomUUID(), coach_id: cid, name, phone: `1380000000${i}`, goal, notes,
    created_at: now, preferences: [types[i % 3]!.id]
  }));
  const lessons = [9, 11, 14, 17].map((h, i) => ({
    id: crypto.randomUUID(), coach_id: cid, student_id: students[i]!.id, course_type_id: types[i % 3]!.id,
    start_at: new Date(`${dateKey()}T${String(h).padStart(2, '0')}:00`).toISOString(),
    end_at: new Date(`${dateKey()}T${String(h + 1).padStart(2, '0')}:00`).toISOString(),
    status: (i === 2 ? 'pending' : 'confirmed') as 'pending' | 'confirmed',
    notes: '', package_id: null as string | null, created_at: now, updated_at: now
  }));
  const pkg: LessonPackage = {
    id: crypto.randomUUID(), coach_id: cid, student_id: students[0]!.id, course_type_id: null,
    name: '私教 12 节', total_sessions: 12, initial_used: 7,
    purchased_on: dateKey(new Date(Date.now() - 20 * 86400000)),
    expires_on: null, notes: '', created_at: now
  };
  // 第一节课归属这份套餐，用来演示「已占用 / 还可约」。
  lessons[0]!.package_id = pkg.id;
  return {
    availability: defaultAvailability(),
    booking_events: [], reviews: [],
    coach: {id: cid, name: 'Alex', email: 'demo@tempo.local', created_at: now},
    types, students, bookings: lessons,
    packages: [pkg],
    lesson_tx: [
      {id: crypto.randomUUID(), coach_id: cid, package_id: pkg.id, booking_id: null, kind: 'purchase', quantity: 12, reason: '购买', created_at: now},
      {id: crypto.randomUUID(), coach_id: cid, package_id: pkg.id, booking_id: null, kind: 'adjust', quantity: -7, reason: '期初已用', created_at: now}
    ]
  };
}
