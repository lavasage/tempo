import type {
  AvailabilitySettings, BlockedTime, Booking, BookingEvent, Coach, CourseType, Database,
  Status, Student, TrainingReview, WeeklyWindow
} from '../../types';
import {defaultAvailability} from '../availability';

export interface RuleRow {id: string; kind: 'business' | 'work' | 'break'; days: number[]; start_minute: number; end_minute: number}
export interface BlockedRow {id: string; start_at: string; end_at: string; label: string}
export interface SnapshotJson {
  coach: {id: string; name: string; email: string; created_at: string} | null;
  students: {id: string; coach_id: string; name: string; phone: string; notes: string; preferences: string[]; created_at: string}[];
  types: {id: string; name: string; default_duration: number; color: string}[];
  bookings: {id: string; coach_id: string; student_id: string; course_type_id: string; start_at: string; end_at: string; status: Status; notes: string; created_at: string; updated_at: string}[];
  reviews: {id: string; booking_id: string; coach_id: string; rating: number; effort: number | null; actual_minutes: number; notes: string; created_at: string; updated_at: string}[];
  events: {id: string; booking_id: string; coach_id: string; kind: BookingEvent['kind']; before: Booking | null; after: Booking; created_at: string}[];
  availability: {buffer_minutes: number; rules: RuleRow[]; blocked: BlockedRow[]};
}

/** 0–1440 分钟 → 前端时钟串；1440 表示 24:00。 */
export function clockFromMinutes(minutes: number): string {
  const value = Math.round(minutes);
  if (value === 1440) return '24:00';
  const h = Math.floor(value / 60), m = value % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function minutesFromClock(clock: string): number {
  if (clock === '24:00') return 1440;
  const [h, m] = clock.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function windows(rules: RuleRow[], kind: RuleRow['kind']): WeeklyWindow[] {
  return rules
    .filter(r => r.kind === kind)
    .sort((a, b) => a.start_minute - b.start_minute)
    .map(r => ({id: r.id, days: [...r.days], start: clockFromMinutes(r.start_minute), end: clockFromMinutes(r.end_minute)}));
}

export function decodeAvailability(raw: SnapshotJson['availability'] | undefined): AvailabilitySettings {
  if (!raw) return defaultAvailability();
  const rules = raw.rules ?? [];
  const business = windows(rules, 'business'), work = windows(rules, 'work'), breaks = windows(rules, 'break');
  if (!business.length || !work.length) return defaultAvailability();
  return {
    business, work, breaks,
    buffer_minutes: Number(raw.buffer_minutes ?? 0),
    blocked: (raw.blocked ?? []).map<BlockedTime>(b => ({id: b.id, start_at: b.start_at, end_at: b.end_at, label: b.label ?? ''}))
  };
}

/** 服务端快照 → 前端 Database。未登录（coach 为空）直接拒绝，避免展示空壳。 */
export function decodeSnapshot(raw: SnapshotJson): Database {
  if (!raw?.coach?.id) throw Error('登录状态已失效，请重新登录');
  const coach: Coach = {id: raw.coach.id, name: raw.coach.name, email: raw.coach.email, created_at: raw.coach.created_at};
  const students: Student[] = (raw.students ?? []).map(s => ({
    id: s.id, coach_id: s.coach_id, name: s.name, phone: s.phone ?? '', notes: s.notes ?? '',
    preferences: [...(s.preferences ?? [])], created_at: s.created_at
  }));
  const types: CourseType[] = (raw.types ?? []).map(t => ({id: t.id, name: t.name, default_duration: t.default_duration, color: t.color}));
  const bookings: Booking[] = (raw.bookings ?? []).map(b => ({...b, notes: b.notes ?? ''}));
  const reviews: TrainingReview[] = (raw.reviews ?? []).map(r => ({...r, effort: r.effort ?? null, notes: r.notes ?? ''}));
  const events: BookingEvent[] = (raw.events ?? []).map(e => ({...e, before: e.before ?? null}));
  return {coach, students, types, bookings, reviews, booking_events: events, availability: decodeAvailability(raw.availability)};
}

export function studentRow(s: Student) {
  return {id: s.id, coach_id: s.coach_id, name: s.name, phone: s.phone, notes: s.notes, goal: s.goal ?? '', preferences: s.preferences, created_at: s.created_at};
}

export function typeRow(t: CourseType, coachId: string) {
  return {id: t.id, coach_id: coachId, name: t.name, default_duration: t.default_duration, color: t.color};
}

export function reviewRow(r: TrainingReview) {
  return {id: r.id, booking_id: r.booking_id, coach_id: r.coach_id, rating: r.rating, effort: r.effort, actual_minutes: r.actual_minutes, notes: r.notes, created_at: r.created_at, updated_at: r.updated_at};
}

function ruleRows(list: WeeklyWindow[]) {
  return list.map(w => ({id: w.id, days: w.days, start_minute: minutesFromClock(w.start), end_minute: minutesFromClock(w.end)}));
}

/** 可用性 → save_availability RPC 参数。 */
export function availabilityPayload(a: AvailabilitySettings) {
  return {
    p_buffer: a.buffer_minutes,
    p_business: ruleRows(a.business),
    p_work: ruleRows(a.work),
    p_breaks: ruleRows(a.breaks),
    p_blocked: a.blocked.map(b => ({id: b.id, start_at: b.start_at, end_at: b.end_at, label: b.label}))
  };
}

/** 空数据库占位：仅在远端模式登录前使用，界面由 App 的门禁挡住。 */
export function emptyDatabase(): Database {
  return {
    coach: {id: '', name: '', email: '', created_at: new Date(0).toISOString()},
    students: [], types: [], bookings: [], reviews: [], booking_events: [],
    availability: defaultAvailability()
  };
}
