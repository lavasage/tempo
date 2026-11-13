/**
 * 空库：新用户首次进入时用它，不带任何演示数据。
 * 课程类型属于配置而非数据，所以默认给三种，用户可直接排课。
 */
import { defaultAvailability } from './rules.js';

export function emptyDb() {
  const now = new Date().toISOString();
  const coach = { id: 'coach-1', name: '教练', email: '', created_at: now };
  return {
    availability: defaultAvailability(),
    booking_events: [],
    reviews: [],
    coach,
    types: [
      { id: 'ty-1', name: '力量训练', default_duration: 60, color: '#ff7052' },
      { id: 'ty-2', name: '功能训练', default_duration: 60, color: '#4263eb' },
      { id: 'ty-3', name: '普拉提', default_duration: 60, color: '#0e9f8e' }
    ],
    students: [],
    bookings: [],
    packages: [],
    lesson_tx: [],
    updatedAt: now
  };
}

/**
 * 演示数据：4 节今天的课 + 3 节已完成的过往课程（覆盖「有评分 / 有记录未评分 / 无记录」三种状态），
 * 以及林晓的一份「私教 12 节」（期初已用 7 节，已上 1 节，今天那节占用 1 节）。
 * 固定 id，重置后仍然可复现。只在「我的 → 载入演示数据」时使用。
 */

export function seed() {
  const now = new Date().toISOString();
  const today = dateKey();
  const coach = { id: 'coach-1', name: 'Alex', email: 'demo@tempo.local', created_at: now };
  const types = [
    { id: 'ty-1', name: '力量训练', default_duration: 60, color: '#ff7052' },
    { id: 'ty-2', name: '功能训练', default_duration: 60, color: '#4263eb' },
    { id: 'ty-3', name: '普拉提', default_duration: 60, color: '#0e9f8e' }
  ];
  const roster = [
    ['st-1', '林晓', '12 周改善圆肩，能完成标准硬拉', '改善体态，循序渐进'],
    ['st-2', '陈宇', '提升深蹲 1RM 到 100kg', '专注基础力量'],
    ['st-3', '王可欣', '体脂降到 22%，保持每周三练', '喜欢上午训练'],
    ['st-4', '赵一鸣', '增肌期，重点关注肩背', '时间不固定，提前一天确认'],
    ['st-5', '周宁', '产后恢复核心与盆底功能', '避免高冲击动作']
  ];
  const students = roster.map(([id, name, goal, notes], i) => ({
    id,
    coach_id: coach.id,
    name,
    phone: `1380000000${i}`,
    goal,
    notes,
    created_at: now,
    preferences: [types[i % 3].id]
  }));

  const booking = (id, student, type, day, hour, status, packageId = null) => ({
    id,
    coach_id: coach.id,
    student_id: student,
    course_type_id: type,
    start_at: at(day, hour),
    end_at: at(day, hour + 1),
    status,
    notes: '',
    package_id: packageId,
    created_at: now,
    updated_at: now
  });

  const bookings = [
    booking('bk-1', 'st-1', 'ty-1', today, 9, 'confirmed', 'pkg-1'),
    booking('bk-2', 'st-2', 'ty-2', today, 11, 'confirmed'),
    booking('bk-3', 'st-3', 'ty-3', today, 14, 'pending'),
    booking('bk-4', 'st-4', 'ty-1', today, 17, 'confirmed'),
    // 过往已完成：有评分
    booking('bk-5', 'st-1', 'ty-1', shift(today, -2), 9, 'completed', 'pkg-1'),
    // 有训练记录但没评分
    booking('bk-6', 'st-2', 'ty-2', shift(today, -3), 11, 'completed'),
    // 完成了但还没记录
    booking('bk-7', 'st-3', 'ty-3', shift(today, -4), 14, 'completed')
  ];

  const pkg = {
    id: 'pkg-1',
    coach_id: coach.id,
    student_id: 'st-1',
    course_type_id: null,
    name: '私教 12 节',
    total_sessions: 12,
    initial_used: 7,
    purchased_on: shift(today, -20),
    expires_on: null,
    notes: '',
    created_at: now
  };

  const reviews = [
    { id: 'rv-1', booking_id: 'bk-5', coach_id: coach.id, rating: 4, effort: 7, actual_minutes: 55, notes: '硬拉动作稳定，右肩放松了些', created_at: now, updated_at: now },
    { id: 'rv-2', booking_id: 'bk-6', coach_id: coach.id, rating: null, effort: null, actual_minutes: 45, notes: '', created_at: now, updated_at: now }
  ];

  return {
    availability: defaultAvailability(),
    booking_events: [],
    reviews,
    coach,
    types,
    students,
    bookings,
    packages: [pkg],
    lesson_tx: [
      { id: 'tx-1', coach_id: coach.id, package_id: 'pkg-1', booking_id: null, kind: 'purchase', quantity: 12, reason: '购买', created_at: at(shift(today, -20), 10) },
      { id: 'tx-2', coach_id: coach.id, package_id: 'pkg-1', booking_id: null, kind: 'adjust', quantity: -7, reason: '期初已用', created_at: at(shift(today, -20), 10) },
      { id: 'tx-3', coach_id: coach.id, package_id: 'pkg-1', booking_id: 'bk-5', kind: 'consume', quantity: -1, reason: '完成课程', created_at: at(shift(today, -2), 10) }
    ]
  };
}
