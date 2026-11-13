import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS = ['0001_schema.sql', '0002_rls.sql', '0003_guard.sql', '0004_client.sql', '0005_student_goal.sql', '0006_completion_time.sql', '0007_lesson_packages.sql', '0008_review_optional_rating.sql'];
export const COACH_A = '11111111-1111-1111-1111-111111111111';
export const COACH_B = '22222222-2222-2222-2222-222222222222';

const readMigration = (file: string) => readFileSync(join(here, '..', 'migrations', file), 'utf8');

/** 本地 Postgres（WASM）上复现 Supabase 的 auth 契约：auth.users 与 auth.uid()。 */
export async function createDb() {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(nullif(current_setting('request.jwt.claims', true), '')::json->>'sub','')::uuid
    $$;
  `);
  for (const role of ['authenticated', 'anon']) {
    try { await db.exec(`create role ${role} nologin`); } catch { /* 已存在 */ }
  }
  // Supabase 默认给 authenticated 这些权限；自建 Postgres 需要显式补上。
  await db.exec(`
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
  `);
  await applyMigrations(db);
  return db;
}

export async function applyMigrations(db: PGlite) {
  for (const file of MIGRATIONS) await db.exec(readMigration(file));
}

/** 切换为某个教练的登录态。 */
export async function asCoach(db: PGlite, id: string) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '{"sub":"${id}"}', false); set role authenticated;`);
}

export async function asAdmin(db: PGlite) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`);
}

export async function createCoaches(db: PGlite) {
  await asAdmin(db);
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${COACH_A}', 'a@tempo.test', '{"name":"甲教练"}'),
      ('${COACH_B}', 'b@tempo.test', '{"name":"乙教练"}')
    on conflict (id) do nothing;
  `);
}

/** 清空业务数据并把两名教练的可用性恢复为默认值。 */
export async function resetData(db: PGlite) {
  await asAdmin(db);
  await db.exec(`truncate public.booking_events, public.training_reviews, public.lesson_transactions,
    public.lesson_packages, public.blocked_times, public.bookings, public.students, public.course_types,
    public.availability_rules, public.availability_settings
    restart identity cascade`);
  await db.exec(`
    insert into public.availability_settings (coach_id, buffer_minutes)
    select id, 0 from public.coaches where id in ('${COACH_A}','${COACH_B}')
    on conflict (coach_id) do nothing;
    insert into public.availability_rules (coach_id, kind, days, start_minute, end_minute)
    select c.id, k.kind, array[0,1,2,3,4,5,6]::smallint[], 480, 1260
    from public.coaches c cross join (values ('business'),('work')) as k(kind)
    where c.id in ('${COACH_A}','${COACH_B}');
  `);
}

/** 给教练建一名学员和一个课程类型，返回 id。 */
export async function fixture(db: PGlite, coach: string, suffix = '') {
  await asCoach(db, coach);
  const student = await db.query<{ id: string }>(
    `insert into public.students (coach_id, name) values ($1, $2) returning id`,
    [coach, `学员${suffix}`]
  );
  const type = await db.query<{ id: string }>(
    `insert into public.course_types (coach_id, name) values ($1, $2) returning id`,
    [coach, `类型${suffix}`]
  );
  return {studentId: student.rows[0]!.id, typeId: type.rows[0]!.id};
}

export const at = (iso: string) => iso;

export async function createBooking(
  db: PGlite,
  studentId: string,
  typeId: string,
  start: string,
  end: string,
  extra: {notes?: string; status?: string; request?: string; packageId?: string} = {}
) {
  const row = await db.query<{ booking_create: Record<string, unknown> }>(
    `select public.booking_create($1,$2,$3::timestamptz,$4::timestamptz,$5,$6::uuid,$7::public.booking_status,$8::uuid)`,
    [studentId, typeId, start, end, extra.notes ?? '', extra.request ?? null, extra.status ?? 'confirmed', extra.packageId ?? null]
  );
  return row.rows[0]!.booking_create;
}

/** 登记一份套餐：总节数、期初已用、可选有效期。 */
export async function createPackage(
  db: PGlite,
  studentId: string,
  typeId: string | null,
  total: number,
  initial = 0,
  expires: string | null = null,
  id: string = crypto.randomUUID()
) {
  const row = await db.query<{ package_save: Record<string, unknown> }>(
    `select public.package_save($1::uuid,$2::uuid,$3::uuid,$4,$5::int,$6::int,$7::date,$8::date,$9)`,
    [id, studentId, typeId, '私教 ' + total + ' 节', total, initial, '2026-11-01', expires, '']
  );
  return {id, row: row.rows[0]!.package_save};
}

/** 余额 = 流水求和；占用 = 已确认且未完成的课程数。 */
export async function packageState(db: PGlite, packageId: string) {
  const balance = await db.query<{ c: number }>(
    `select coalesce(sum(quantity),0)::int c from public.lesson_transactions where package_id=$1`, [packageId]
  );
  const occupied = await db.query<{ c: number }>(
    `select count(*)::int c from public.bookings where package_id=$1 and status='confirmed'`, [packageId]
  );
  return {remaining: balance.rows[0]!.c, occupied: occupied.rows[0]!.c};
}

export async function expectReject(promise: Promise<unknown>, fragment: string) {
  try {
    await promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes(fragment)) throw new Error(`拒绝信息不符，期望包含「${fragment}」，实际「${message}」`);
    return;
  }
  throw new Error(`期望被拒绝（${fragment}），实际成功`);
}
