import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {
  asCoach, createBooking, createCoaches, createDb, createPackage, expectReject, fixture, packageState,
  resetData, COACH_A, COACH_B
} from './harness';

let db: PGlite;
let studentId = '';
let typeId = '';
let other: {studentId: string; typeId: string};

const setStatus = (id: string, status: string) =>
  db.query(`select public.booking_set_status($1, $2::public.booking_status)`, [id, status]);
const revert = (id: string, reason: string) =>
  db.query(`select public.lesson_revert($1,$2)`, [id, reason]);
const at = (day: string, hour: number) => `${day}T${String(hour).padStart(2, '0')}:00:00+08:00`;

beforeAll(async () => {
  db = await createDb();
  await createCoaches(db);
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await resetData(db);
  const made = await fixture(db, COACH_A, 'A');
  studentId = made.studentId;
  typeId = made.typeId;
  other = await fixture(db, COACH_B, 'B');
  // fixture 会把登录态切到最后一位教练，回到甲教练继续后面的用例。
  await asCoach(db, COACH_A);
});

describe('套餐课时闭环', () => {
  it('登记 12 节、期初已用 7 节，确认两节后剩余 5、占用 2、可约 3', async () => {
    const {id} = await createPackage(db, studentId, null, 12, 7);
    expect(await packageState(db, id)).toEqual({remaining: 5, occupied: 0});

    await createBooking(db, studentId, typeId, at('2026-11-01', 9), at('2026-11-01', 10), {packageId: id});
    await createBooking(db, studentId, typeId, at('2026-11-01', 11), at('2026-11-01', 12), {packageId: id});
    expect(await packageState(db, id)).toEqual({remaining: 5, occupied: 2});

    // 待确认不占课
    const pending = await createBooking(db, studentId, typeId, at('2026-11-01', 14), at('2026-11-01', 15), {packageId: id, status: 'pending'});
    expect((await packageState(db, id)).occupied).toBe(2);
    await setStatus(String(pending.id), 'confirmed');
    expect((await packageState(db, id)).occupied).toBe(3);
  });

  it('完成与扣课在同一事务：重复调用只扣一次', async () => {
    const {id} = await createPackage(db, studentId, null, 12, 7);
    const booking = await createBooking(db, studentId, typeId, at('2026-11-01', 9), at('2026-11-01', 10), {packageId: id});

    await setStatus(String(booking.id), 'completed');
    expect(await packageState(db, id)).toEqual({remaining: 4, occupied: 0});

    await setStatus(String(booking.id), 'completed');
    const tx = await db.query<{ c: number }>(
      `select count(*)::int c from public.lesson_transactions where booking_id=$1 and kind='consume'`, [booking.id]
    );
    expect(tx.rows[0]!.c).toBe(1);
    expect(await packageState(db, id)).toEqual({remaining: 4, occupied: 0});
  });

  it('取消只释放占用，不写流水', async () => {
    const {id} = await createPackage(db, studentId, null, 12, 7);
    const booking = await createBooking(db, studentId, typeId, at('2026-11-01', 9), at('2026-11-01', 10), {packageId: id});
    await setStatus(String(booking.id), 'cancelled');
    expect(await packageState(db, id)).toEqual({remaining: 5, occupied: 0});
  });

  it('最后一节只能被一笔确认占住，另一笔收到可处理提示', async () => {
    const {id} = await createPackage(db, studentId, null, 1, 0);
    await createBooking(db, studentId, typeId, at('2026-11-01', 9), at('2026-11-01', 10), {packageId: id});
    const second = await createBooking(db, studentId, typeId, at('2026-11-01', 11), at('2026-11-01', 12), {packageId: id, status: 'pending'});
    await expectReject(setStatus(String(second.id), 'confirmed'), '课时不足');
  });

  it('改期到套餐到期之后被拒，原预约保留', async () => {
    const {id} = await createPackage(db, studentId, null, 4, 0, '2026-11-02');
    const booking = await createBooking(db, studentId, typeId, at('2026-11-01', 9), at('2026-11-01', 10), {packageId: id});
    await expectReject(
      db.query(`select public.booking_update($1,$2::timestamptz,$3::timestamptz,null,null,null,false)`,
        [booking.id, at('2026-11-05', 9), at('2026-11-05', 10)]),
      '已过期'
    );
    const row = await db.query<{ start_at: Date }>(`select start_at from public.bookings where id=$1`, [booking.id]);
    expect(row.rows[0]!.start_at.toISOString()).toBe(new Date(at('2026-11-01', 9)).toISOString());
  });

  it('套餐只适用于指定课程类型', async () => {
    const extra = await db.query<{ id: string }>(
      `insert into public.course_types (coach_id, name) values ($1,'普拉提') returning id`, [COACH_A]
    );
    const pilates = extra.rows[0]!.id;
    const {id} = await createPackage(db, studentId, pilates, 4, 0);
    await expectReject(
      createBooking(db, studentId, typeId, at('2026-11-01', 9), at('2026-11-01', 10), {packageId: id}),
      '不适用于这个课程类型'
    );
    await expect(createBooking(db, studentId, pilates, at('2026-11-01', 9), at('2026-11-01', 10), {packageId: id}))
      .resolves.toBeTruthy();
  });

  it('撤销误扣写冲正流水，原扣减保留', async () => {
    const {id} = await createPackage(db, studentId, null, 12, 7);
    const booking = await createBooking(db, studentId, typeId, at('2026-11-01', 9), at('2026-11-01', 10), {packageId: id});
    await setStatus(String(booking.id), 'completed');
    await revert(String(booking.id), '误点完成');
    expect(await packageState(db, id)).toEqual({remaining: 5, occupied: 0});
    const tx = await db.query<{ kind: string }>(
      `select kind from public.lesson_transactions where booking_id=$1 order by kind`, [booking.id]
    );
    expect(tx.rows.map(r => r.kind)).toEqual(['consume', 'refund']);
    // 队列重放时冲正必须幂等：再调一次不改变余额，也不会多出一条流水。
    await revert(String(booking.id), '再撤一次');
    expect(await packageState(db, id)).toEqual({remaining: 5, occupied: 0});
    const again = await db.query<{ c: number }>(
      `select count(*)::int c from public.lesson_transactions where booking_id=$1 and kind='refund'`, [booking.id]
    );
    expect(again.rows[0]!.c).toBe(1);
    await expectReject(revert(String(booking.id), '  '), '原因');
  });

  it('不计套餐的课程完成时不产生课时流水', async () => {
    const booking = await createBooking(db, studentId, typeId, at('2026-11-01', 9), at('2026-11-01', 10), {});
    await setStatus(String(booking.id), 'completed');
    const tx = await db.query<{ c: number }>(`select count(*)::int c from public.lesson_transactions where booking_id=$1`, [booking.id]);
    expect(tx.rows[0]!.c).toBe(0);
  });

  it('跨教练无法关联他人套餐', async () => {
    const {id} = await createPackage(db, studentId, null, 12, 7);
    expect((await packageState(db, id)).remaining).toBe(5);
    await asCoach(db, COACH_B);
    // 复合外键 (package_id, coach_id) 先于业务校验挡下跨教练关联。
    await expectReject(
      createBooking(db, other.studentId, other.typeId, at('2026-11-01', 9), at('2026-11-01', 10), {packageId: id}),
      'package'
    );
  });

  it('快照带出套餐、流水与预约归属', async () => {
    const {id} = await createPackage(db, studentId, null, 12, 7);
    const booking = await createBooking(db, studentId, typeId, at('2026-11-01', 9), at('2026-11-01', 10), {packageId: id});
    const snap = await db.query<{ snapshot: {packages: {id: string; total_sessions: number; initial_used: number}[]; lesson_tx: {kind: string; quantity: number}[]; bookings: {id: string; package_id: string | null}[]} }>(
      `select public.snapshot()`
    );
    const data = snap.rows[0]!.snapshot;
    expect(data.packages).toHaveLength(1);
    expect(data.packages[0]).toMatchObject({id, total_sessions: 12, initial_used: 7});
    expect(data.lesson_tx.map(t => [t.kind, t.quantity]).sort()).toEqual([['adjust', -7], ['purchase', 12]]);
    expect(data.bookings.find(b => b.id === booking.id)?.package_id).toBe(id);
  });

  it('登记幂等：同一份套餐重放不会重复记账', async () => {
    const first = await createPackage(db, studentId, null, 12, 7);
    await createPackage(db, studentId, null, 12, 7, null, first.id);
    expect(await packageState(db, first.id)).toEqual({remaining: 5, occupied: 0});
    const rows = await db.query<{ c: number }>(`select count(*)::int c from public.lesson_transactions where package_id=$1`, [first.id]);
    expect(rows.rows[0]!.c).toBe(2);
  });
});
