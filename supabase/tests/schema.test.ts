import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {
  applyMigrations, asAdmin, asCoach, createBooking, createCoaches, createDb, expectReject,
  fixture, resetData, COACH_A, COACH_B
} from './harness';

let db: PGlite;
const setStatus = (id: string, status: string) =>
  db.query(`select public.booking_set_status($1, $2::public.booking_status)`, [id, status]);

beforeAll(async () => {
  db = await createDb();
  await createCoaches(db);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => { await resetData(db); });

describe('M4-A 迁移', () => {
  it('重复执行不报错，业务表与策略齐全', async () => {
    const tables = await db.query<{ c: number }>(
      `select count(*)::int c from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`
    );
    expect(tables.rows[0]!.c).toBeGreaterThanOrEqual(11);
    const policies = await db.query<{ c: number }>(
      `select count(distinct policyname)::int c from pg_policies where schemaname='public' and policyname like '%_owner'`
    );
    expect(policies.rows[0]!.c).toBeGreaterThanOrEqual(11);
    await expect(applyMigrations(db)).resolves.toBeUndefined();
  });

  it('注册即生成教练档案、默认可用性与 08:00–21:00 规则', async () => {
    await asAdmin(db);
    const id = '33333333-3333-3333-3333-333333333333';
    await db.query(`insert into auth.users (id,email,raw_user_meta_data) values ($1,'c@tempo.test','{"name":"丙教练"}')`, [id]);
    const coach = await db.query<{ name: string; timezone: string }>(`select name, timezone from public.coaches where id=$1`, [id]);
    expect(coach.rows[0]).toEqual({name: '丙教练', timezone: 'Asia/Shanghai'});
    const rules = await db.query<{ kind: string; start_minute: number; end_minute: number }>(
      `select kind, start_minute, end_minute from public.availability_rules where coach_id=$1 order by kind`, [id]
    );
    expect(rules.rows).toEqual([
      {kind: 'business', start_minute: 480, end_minute: 1260},
      {kind: 'work', start_minute: 480, end_minute: 1260}
    ]);
    const settings = await db.query<{ buffer_minutes: number }>(`select buffer_minutes from public.availability_settings where coach_id=$1`, [id]);
    expect(settings.rows[0]!.buffer_minutes).toBe(0);
  });
});

describe('M4-B 双教练隔离', () => {
  it('只能读自己的学员，冒用他人归属写入被拒', async () => {
    await fixture(db, COACH_A, '甲');
    await asCoach(db, COACH_A);
    expect((await db.query('select id from public.students')).rows).toHaveLength(1);

    await asCoach(db, COACH_B);
    expect((await db.query('select id from public.students')).rows).toHaveLength(0);
    await expectReject(
      db.query(`insert into public.students (coach_id, name) values ($1,'越权学员')`, [COACH_A]),
      'row-level security'
    );
  });

  it('更新他人记录影响 0 行', async () => {
    const a = await fixture(db, COACH_A, '甲');
    await asCoach(db, COACH_B);
    const res = await db.query(`update public.students set name='改名' where id=$1 returning id`, [a.studentId]);
    expect(res.rows).toHaveLength(0);
  });

  it('无法用他人学员建课（复合外键）', async () => {
    const a = await fixture(db, COACH_A, '甲');
    const b = await fixture(db, COACH_B, '乙');
    await asCoach(db, COACH_A);
    await expectReject(
      createBooking(db, b.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00'),
      'foreign key'
    );
  });
});

describe('M4-C 时段与事务', () => {
  it('建课写入 created 事件，before 为空', async () => {
    const a = await fixture(db, COACH_A, '甲');
    const booking = await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00');
    expect(booking.status).toBe('confirmed');
    const events = await db.query<{ kind: string; before: unknown }>(`select kind, before from public.booking_events where booking_id=$1`, [booking.id]);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]).toMatchObject({kind: 'created', before: null});
  });

  it('重叠被拒，边界相接允许', async () => {
    const a = await fixture(db, COACH_A, '甲');
    await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00');
    await expectReject(
      createBooking(db, a.studentId, a.typeId, '2026-11-12T09:30:00+08:00', '2026-11-12T10:30:00+08:00'),
      '冲突'
    );
    const next = await createBooking(db, a.studentId, a.typeId, '2026-11-12T10:00:00+08:00', '2026-11-12T11:00:00+08:00');
    expect(next.id).toBeTruthy();
  });

  it('缓冲 30 分钟：10:15 冲突，10:30 通过', async () => {
    const a = await fixture(db, COACH_A, '甲');
    await db.query(`update public.availability_settings set buffer_minutes=30 where coach_id=$1`, [COACH_A]);
    await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00');
    await expectReject(
      createBooking(db, a.studentId, a.typeId, '2026-11-12T10:15:00+08:00', '2026-11-12T11:15:00+08:00'),
      '冲突'
    );
    const ok = await createBooking(db, a.studentId, a.typeId, '2026-11-12T10:30:00+08:00', '2026-11-12T11:30:00+08:00');
    expect(ok.id).toBeTruthy();
  });

  it('取消释放时段，且不重新校验规则', async () => {
    const a = await fixture(db, COACH_A, '甲');
    const first = await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00');
    await setStatus(first.id, 'cancelled');
    const again = await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00');
    expect(again.id).not.toBe(first.id);
  });

  it('营业时间外、休息段与临时不可约都拒绝', async () => {
    const a = await fixture(db, COACH_A, '甲');
    await expectReject(
      createBooking(db, a.studentId, a.typeId, '2026-11-12T07:00:00+08:00', '2026-11-12T08:00:00+08:00'),
      '不在可约时间'
    );
    await expectReject(
      createBooking(db, a.studentId, a.typeId, '2026-11-12T21:00:00+08:00', '2026-11-12T22:00:00+08:00'),
      '不在可约时间'
    );
    await db.query(
      `insert into public.blocked_times (coach_id,start_at,end_at,label) values ($1,'2026-11-12T12:00:00+08:00','2026-11-12T13:00:00+08:00','午休')`,
      [COACH_A]
    );
    await expectReject(
      createBooking(db, a.studentId, a.typeId, '2026-11-12T12:30:00+08:00', '2026-11-12T13:30:00+08:00'),
      '不可约'
    );
  });

  it('休息段从可约时间中扣除', async () => {
    const a = await fixture(db, COACH_A, '甲');
    await db.query(
      `insert into public.availability_rules (coach_id,kind,days,start_minute,end_minute) values ($1,'break',array[0,1,2,3,4,5,6]::smallint[],720,780)`,
      [COACH_A]
    );
    await expectReject(
      createBooking(db, a.studentId, a.typeId, '2026-11-12T12:30:00+08:00', '2026-11-12T13:00:00+08:00'),
      '不在可约时间'
    );
    const ok = await createBooking(db, a.studentId, a.typeId, '2026-11-12T13:00:00+08:00', '2026-11-12T14:00:00+08:00');
    expect(ok.id).toBeTruthy();
  });

  it('跨夜窗口 22:00–02:00：次日凌晨可约，窗口外拒绝', async () => {
    const a = await fixture(db, COACH_A, '甲');
    await db.query(`delete from public.availability_rules where coach_id=$1`, [COACH_A]);
    await db.query(
      `insert into public.availability_rules (coach_id,kind,days,start_minute,end_minute) values
        ($1,'business',array[0,1,2,3,4,5,6]::smallint[],1320,120),
        ($1,'work',array[0,1,2,3,4,5,6]::smallint[],1320,120)`, [COACH_A]
    );
    const late = await createBooking(db, a.studentId, a.typeId, '2026-11-12T23:00:00+08:00', '2026-11-13T00:30:00+08:00');
    expect(late.id).toBeTruthy();
    const early = await createBooking(db, a.studentId, a.typeId, '2026-11-13T01:00:00+08:00', '2026-11-13T01:30:00+08:00');
    expect(early.id).toBeTruthy();
    await expectReject(
      createBooking(db, a.studentId, a.typeId, '2026-11-13T02:00:00+08:00', '2026-11-13T02:30:00+08:00'),
      '不在可约时间'
    );
  });

  it('状态白名单：pending 不可直接完成，终态只读', async () => {
    const a = await fixture(db, COACH_A, '甲');
    const pending = await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00', {status: 'pending'});
    await expectReject(setStatus(String(pending.id), 'completed'), '待确认');
    await setStatus(String(pending.id), 'confirmed');
    await setStatus(String(pending.id), 'completed');
    await expectReject(setStatus(String(pending.id), 'confirmed'), '已结束');
    const events = await db.query<{ c: number }>(`select count(*)::int c from public.booking_events where booking_id=$1`, [pending.id]);
    expect(events.rows[0]!.c).toBe(3);
  });

  it('已完成课程改期被拒', async () => {
    const a = await fixture(db, COACH_A, '甲');
    const booking = await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00');
    await setStatus(String(booking.id), 'completed');
    await expectReject(
      db.query(`select public.booking_update($1,'2026-11-12T11:00:00+08:00','2026-11-12T12:00:00+08:00')`, [booking.id]),
      '已结束'
    );
  });

  it('相同 request_id 幂等：不重复建单、不重复写事件', async () => {
    const a = await fixture(db, COACH_A, '甲');
    const request = '44444444-4444-4444-4444-444444444444';
    const first = await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00', {request});
    const second = await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00', {request});
    expect(second.id).toBe(first.id);
    const bookings = await db.query<{ c: number }>('select count(*)::int c from public.bookings');
    const events = await db.query<{ c: number }>('select count(*)::int c from public.booking_events');
    expect(bookings.rows[0]!.c).toBe(1);
    expect(events.rows[0]!.c).toBe(1);
  });

  it('失败写入不留下课程与事件', async () => {
    const a = await fixture(db, COACH_A, '甲');
    await expectReject(
      createBooking(db, a.studentId, a.typeId, '2026-11-12T07:00:00+08:00', '2026-11-12T08:00:00+08:00'),
      '不在可约时间'
    );
    expect((await db.query<{ c: number }>('select count(*)::int c from public.bookings')).rows[0]!.c).toBe(0);
    expect((await db.query<{ c: number }>('select count(*)::int c from public.booking_events')).rows[0]!.c).toBe(0);
  });
});

describe('M4-B 快照与可用性', () => {
  const snapshot = async () =>
    (await db.query<{ snapshot: Record<string, any> }>(`select public.snapshot()`)).rows[0]!.snapshot;

  it('未登录时 snapshot 不返回教练与业务数据', async () => {
    await asAdmin(db);
    const raw = await snapshot();
    expect(raw.coach).toBeNull();
    expect(raw.students).toEqual([]);
    expect(raw.availability.buffer_minutes).toBe(0);
  });

  it('snapshot 只含本人数据', async () => {
    const a = await fixture(db, COACH_A, '甲');
    await fixture(db, COACH_B, '乙');
    await asCoach(db, COACH_A);
    await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00');
    const raw = await snapshot();
    expect(raw.coach.name).toBe('甲教练');
    expect(raw.students).toHaveLength(1);
    expect(raw.bookings).toHaveLength(1);
    expect(raw.events).toHaveLength(1);
    expect(raw.types).toHaveLength(1);
  });

  it('save_availability 原子替换规则与临时不可约', async () => {
    await asCoach(db, COACH_A);
    const business = [{id: 'aaaaaaaa-0000-0000-0000-000000000001', days: [1, 2, 3], start_minute: 540, end_minute: 1200}];
    const work = [{id: 'aaaaaaaa-0000-0000-0000-000000000002', days: [1, 2, 3], start_minute: 600, end_minute: 1080}];
    const payload = (buffer: number, blocked: unknown[]) =>
      db.query(`select public.save_availability($1,$2::jsonb,$3::jsonb,'[]'::jsonb,$4::jsonb)`,
        [buffer, JSON.stringify(business), JSON.stringify(work), JSON.stringify(blocked)]);

    await payload(20, [{id: 'aaaaaaaa-0000-0000-0000-000000000003', start_at: '2026-11-12T04:00:00+08:00', end_at: '2026-11-12T05:00:00+08:00', label: '午休'}]);
    let raw = await snapshot();
    expect(raw.availability.buffer_minutes).toBe(20);
    expect(raw.availability.rules).toHaveLength(2);
    expect(raw.availability.blocked).toHaveLength(1);

    await payload(0, []);
    raw = await snapshot();
    expect(raw.availability.buffer_minutes).toBe(0);
    expect(raw.availability.rules).toHaveLength(2);
    expect(raw.availability.blocked).toHaveLength(0);
  });

  it('可用性保存受 RLS 约束，未登录被拒', async () => {
    await asAdmin(db);
    await expectReject(
      db.query(`select public.save_availability(0,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb)`),
      '未登录'
    );
  });
});

describe('M4 关联与业务约束', () => {
  it('学员偏好必须属于同一教练', async () => {
    const a = await fixture(db, COACH_A, '甲');
    const b = await fixture(db, COACH_B, '乙');
    await asCoach(db, COACH_A);
    await expectReject(
      db.query(`update public.students set preferences=array[$1]::uuid[] where id=$2`, [b.typeId, a.studentId]),
      '不属于当前教练'
    );
    const ok = await db.query(`update public.students set preferences=array[$1]::uuid[] where id=$2 returning id`, [a.typeId, a.studentId]);
    expect(ok.rows).toHaveLength(1);
  });

  it('电话与备注长度受约束', async () => {
    await asCoach(db, COACH_A);
    await expectReject(
      db.query(`insert into public.students (coach_id,name,phone) values ($1,'号码错','123')`, [COACH_A]),
      'students_phone_check'
    );
    await expectReject(
      db.query(`insert into public.students (coach_id,name,notes) values ($1,'太长',$2)`, [COACH_A, 'x'.repeat(1001)]),
      'students_notes_check'
    );
    await expectReject(
      db.query(`insert into public.students (coach_id,name,phone) values ($1,'号码带空格','+86 138 1234 5678')`, [COACH_A]),
      'students_phone_check'
    );
    const ok = await db.query(`insert into public.students (coach_id,name,phone) values ($1,'电话正常','+8613812345678') returning id`, [COACH_A]);
    expect(ok.rows).toHaveLength(1);
  });

  it('评价只能写给已完成课程，且一课一条', async () => {
    const a = await fixture(db, COACH_A, '甲');
    const booking = await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00');
    await expectReject(
      db.query(`insert into public.training_reviews (booking_id,coach_id,rating,actual_minutes) values ($1,$2,5,60)`, [booking.id, COACH_A]),
      '已完成的课程'
    );
    await setStatus(String(booking.id), 'completed');
    await db.query(`insert into public.training_reviews (booking_id,coach_id,rating,actual_minutes) values ($1,$2,5,60)`, [booking.id, COACH_A]);
    await expectReject(
      db.query(`insert into public.training_reviews (booking_id,coach_id,rating,actual_minutes) values ($1,$2,4,55)`, [booking.id, COACH_A]),
      'duplicate key'
    );
    await expectReject(
      db.query(`insert into public.training_reviews (booking_id,coach_id,rating,actual_minutes) values ($1,$2,6,55)`, [booking.id, COACH_A]),
      'rating'
    );
  });

  it('课时：一课只扣一次，退款需先有扣减且只退一次', async () => {
    const a = await fixture(db, COACH_A, '甲');
    const first = await createBooking(db, a.studentId, a.typeId, '2026-11-12T09:00:00+08:00', '2026-11-12T10:00:00+08:00');
    const second = await createBooking(db, a.studentId, a.typeId, '2026-11-12T11:00:00+08:00', '2026-11-12T12:00:00+08:00');
    const pack = await db.query<{ id: string }>(
      `insert into public.lesson_packages (coach_id,student_id,course_type_id,name) values ($1,$2,$3,'十次卡') returning id`,
      [COACH_A, a.studentId, a.typeId]
    );
    const packageId = pack.rows[0]!.id;
    const consume = (bookingId: string, key: string) =>
      db.query(`insert into public.lesson_transactions (package_id,coach_id,booking_id,kind,quantity,idempotency_key)
                values ($1,$2,$3,'consume',-1,$4)`, [packageId, COACH_A, bookingId, key]);

    await consume(String(first.id), 'consume-0001');
    await expectReject(consume(String(first.id), 'consume-0002'), 'duplicate key');
    await expectReject(
      db.query(`insert into public.lesson_transactions (package_id,coach_id,booking_id,kind,quantity,idempotency_key)
                values ($1,$2,$3,'refund',1,'refund-0001')`, [packageId, COACH_A, second.id]),
      '没有对应的课时扣减'
    );
    await db.query(`insert into public.lesson_transactions (package_id,coach_id,booking_id,kind,quantity,idempotency_key)
                    values ($1,$2,$3,'refund',1,'refund-0002')`, [packageId, COACH_A, first.id]);
    await expectReject(
      db.query(`insert into public.lesson_transactions (package_id,coach_id,booking_id,kind,quantity,idempotency_key)
                values ($1,$2,$3,'refund',1,'refund-0003')`, [packageId, COACH_A, first.id]),
      'duplicate key'
    );
    const net = await db.query<{ sum: number }>(`select coalesce(sum(quantity),0)::int sum from public.lesson_transactions`);
    expect(net.rows[0]!.sum).toBe(0);
  });
});
