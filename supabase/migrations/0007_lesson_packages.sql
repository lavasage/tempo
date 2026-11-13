-- Tempo M6-A 套餐课时：字段、预约归属与原子写入
-- 设计要点：
--   1) 余额只有流水一个来源：购买 +N、期初已用 −N、完成 −1、冲正 +1；
--   2) 完成课程与扣课时在同一事务里提交，用课程 id 做扣减幂等键；
--   3) 同一套餐的余额校验前取咨询锁，避免两台设备同时确认最后一节；
--   4) 锁顺序统一为「先课程行，后套餐」，避免交叉等待。

-- ── 套餐字段 ────────────────────────────────────────────────────────────
alter table public.lesson_packages
  add column if not exists total_sessions integer not null default 1,
  add column if not exists initial_used integer not null default 0,
  add column if not exists purchased_on date not null default current_date,
  add column if not exists expires_on date,
  add column if not exists notes text not null default '';

alter table public.lesson_packages
  drop constraint if exists lesson_packages_total_check,
  drop constraint if exists lesson_packages_initial_check,
  drop constraint if exists lesson_packages_expires_check,
  drop constraint if exists lesson_packages_notes_check,
  add constraint lesson_packages_total_check check (total_sessions between 1 and 500),
  add constraint lesson_packages_initial_check check (initial_used between 0 and total_sessions),
  add constraint lesson_packages_expires_check check (expires_on is null or expires_on >= purchased_on),
  add constraint lesson_packages_notes_check check (char_length(notes) <= 200);

-- ── 预约归属：为空表示这节不计套餐 ──────────────────────────────────────
alter table public.bookings add column if not exists package_id uuid;

alter table public.bookings drop constraint if exists bookings_package_fk;
alter table public.bookings
  add constraint bookings_package_fk foreign key (package_id, coach_id)
  references public.lesson_packages (id, coach_id) on delete restrict;

create index if not exists bookings_package on public.bookings (coach_id, package_id) where package_id is not null;
create index if not exists lesson_tx_package on public.lesson_transactions (package_id, created_at);

-- ── 套餐可用性校验 ──────────────────────────────────────────────────────
-- 校验归属、类型、有效期，并在确认预约时守住余额。调用方必须已经锁住课程行。
create or replace function public.package_guard(
  p_package uuid,
  p_student uuid,
  p_type uuid,
  p_start timestamptz,
  p_status public.booking_status,
  p_exclude uuid default null
) returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_pkg public.lesson_packages;
  v_tz text;
  v_day date;
  v_remaining integer;
  v_occupied integer;
begin
  if p_package is null then return; end if;

  select * into v_pkg from public.lesson_packages
   where id = p_package and coach_id = auth.uid();
  if not found then
    raise exception '套餐不存在或不属于当前教练' using errcode = 'P0001';
  end if;
  if v_pkg.student_id <> p_student then
    raise exception '该套餐不属于这位学员' using errcode = 'P0001';
  end if;
  if v_pkg.course_type_id is not null and v_pkg.course_type_id <> p_type then
    raise exception '该套餐不适用于这个课程类型' using errcode = 'P0001';
  end if;

  select coalesce(timezone, 'Asia/Shanghai') into v_tz from public.coaches where id = auth.uid();
  v_day := (p_start at time zone coalesce(v_tz, 'Asia/Shanghai'))::date;
  if v_pkg.expires_on is not null and v_day > v_pkg.expires_on then
    raise exception '套餐已过期（有效期至 %）', v_pkg.expires_on using errcode = 'P0001';
  end if;

  -- 待确认不占课，也就不消耗余额；确认与直接创建已确认预约都要守住可约数。
  if p_status <> 'confirmed' then return; end if;

  perform pg_advisory_xact_lock(hashtext('tempo:package:' || p_package::text));

  select coalesce(sum(quantity), 0) into v_remaining
    from public.lesson_transactions where package_id = p_package and coach_id = auth.uid();

  select count(*) into v_occupied from public.bookings
   where package_id = p_package and coach_id = auth.uid() and status = 'confirmed'
     and (p_exclude is null or id <> p_exclude);

  if v_remaining - v_occupied < 1 then
    raise exception '套餐「%」课时不足：剩余 % 节，已占用 % 节', v_pkg.name, v_remaining, v_occupied
      using errcode = 'P0001';
  end if;
end $$;

-- ── 登记 / 续购 ─────────────────────────────────────────────────────────
-- 套餐 id 由客户端生成：队列重放时命中同一行，不会建出第二份，也不会重复记账。
create or replace function public.package_save(
  p_id uuid,
  p_student uuid,
  p_type uuid,
  p_name text,
  p_total integer,
  p_initial integer,
  p_purchased date,
  p_expires date,
  p_notes text
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_coach uuid := auth.uid();
  v_pkg public.lesson_packages;
begin
  if v_coach is null then raise exception '未登录' using errcode = '28000'; end if;
  if p_total is null or p_total < 1 or p_total > 500 then
    raise exception '总节数需为 1–500 的整数' using errcode = '22023';
  end if;
  if p_initial is null then p_initial := 0; end if;
  if p_initial < 0 or p_initial > p_total then
    raise exception '期初已用需在 0 到总节数之间' using errcode = '22023';
  end if;
  if p_expires is not null and p_expires < coalesce(p_purchased, current_date) then
    raise exception '到期日期不能早于购买日期' using errcode = '22023';
  end if;

  select * into v_pkg from public.lesson_packages where id = p_id and coach_id = v_coach;
  if found then return to_jsonb(v_pkg); end if;

  insert into public.lesson_packages
    (id, coach_id, student_id, course_type_id, name, total_sessions, initial_used, purchased_on, expires_on, notes)
  values
    (p_id, v_coach, p_student, p_type, btrim(p_name), p_total, p_initial,
     coalesce(p_purchased, current_date), p_expires, coalesce(p_notes, ''))
  returning * into v_pkg;

  insert into public.lesson_transactions
    (package_id, coach_id, booking_id, kind, quantity, reason, idempotency_key)
  values
    (v_pkg.id, v_coach, null, 'purchase', p_total, '购买', 'purchase:' || v_pkg.id)
  on conflict do nothing;

  if p_initial > 0 then
    insert into public.lesson_transactions
      (package_id, coach_id, booking_id, kind, quantity, reason, idempotency_key)
    values
      (v_pkg.id, v_coach, null, 'adjust', -p_initial, '期初已用', 'initial:' || v_pkg.id)
    on conflict do nothing;
  end if;

  return to_jsonb(v_pkg);
end $$;

-- ── 建课：带套餐归属 ────────────────────────────────────────────────────
-- 新增参数会形成新重载，先删旧签名，避免 7 参调用出现歧义。
drop function if exists public.booking_create(uuid, uuid, timestamptz, timestamptz, text, uuid, public.booking_status);

create or replace function public.booking_create(
  p_student uuid,
  p_type uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_notes text default '',
  p_request uuid default null,
  p_status public.booking_status default 'confirmed',
  p_package uuid default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare b public.bookings;
begin
  if p_request is not null then
    select * into b from public.bookings where coach_id = auth.uid() and request_id = p_request;
    if found then return to_jsonb(b); end if;
  end if;

  begin
    insert into public.bookings (coach_id, student_id, course_type_id, start_at, end_at, status, notes, request_id, package_id)
    values (auth.uid(), p_student, p_type, p_start, p_end, p_status, p_notes, p_request, p_package)
    returning * into b;
  exception when unique_violation then
    select * into b from public.bookings where coach_id = auth.uid() and request_id = p_request;
    if found then return to_jsonb(b); end if;
    raise;
  end;

  perform public.package_guard(p_package, p_student, p_type, p_start, p_status, b.id);

  insert into public.booking_events (booking_id, coach_id, kind, before, after)
  values (b.id, b.coach_id, 'created', null, to_jsonb(b));

  return to_jsonb(b);
end $$;

-- ── 改课：可换套餐，也可显式改为不计套餐 ────────────────────────────────
drop function if exists public.booking_update(uuid, timestamptz, timestamptz, uuid, text);

create or replace function public.booking_update(
  p_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_type uuid default null,
  p_notes text default null,
  p_package uuid default null,
  p_package_set boolean default false
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare b public.bookings; v_before jsonb; v_package uuid;
begin
  select * into b from public.bookings where id = p_id and coach_id = auth.uid() for update;
  if not found then raise exception '课程不存在或不属于当前教练' using errcode = 'P0001'; end if;
  if b.status in ('completed','cancelled') then raise exception '已结束的课程不可修改' using errcode = 'P0001'; end if;

  v_package := case when p_package_set then p_package else b.package_id end;
  v_before := to_jsonb(b);
  update public.bookings
     set start_at = p_start,
         end_at = p_end,
         course_type_id = coalesce(p_type, course_type_id),
         notes = coalesce(p_notes, notes),
         package_id = v_package
   where id = b.id
  returning * into b;

  perform public.package_guard(b.package_id, b.student_id, b.course_type_id, b.start_at, b.status, b.id);

  insert into public.booking_events (booking_id, coach_id, kind, before, after)
  values (b.id, b.coach_id, 'edited', v_before, to_jsonb(b));

  return to_jsonb(b);
end $$;

-- ── 状态变更：完成与扣课时同事务 ────────────────────────────────────────
create or replace function public.booking_set_status(p_id uuid, p_status public.booking_status)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare b public.bookings; v_before jsonb;
begin
  select * into b from public.bookings where id = p_id and coach_id = auth.uid() for update;
  if not found then raise exception '课程不存在或不属于当前教练' using errcode = 'P0001'; end if;

  if b.status = p_status then return to_jsonb(b); end if;
  if b.status = 'pending' and p_status not in ('confirmed','cancelled') then
    raise exception '待确认课程只能改为已确认或已取消' using errcode = 'P0001';
  end if;
  if b.status = 'confirmed' and p_status not in ('completed','cancelled') then
    raise exception '已确认课程只能改为已完成或已取消' using errcode = 'P0001';
  end if;
  if b.status in ('completed','cancelled') then
    raise exception '已结束的课程不可修改状态' using errcode = 'P0001';
  end if;

  if p_status = 'confirmed' then
    perform public.package_guard(b.package_id, b.student_id, b.course_type_id, b.start_at, p_status, b.id);
  end if;

  if p_status = 'completed' and b.package_id is not null then
    perform pg_advisory_xact_lock(hashtext('tempo:package:' || b.package_id::text));
    if (select coalesce(sum(quantity), 0) from public.lesson_transactions
         where package_id = b.package_id and coach_id = b.coach_id) < 1 then
      raise exception '套餐课时不足，无法完成扣课' using errcode = 'P0001';
    end if;
    insert into public.lesson_transactions
      (package_id, coach_id, booking_id, kind, quantity, reason, idempotency_key)
    values
      (b.package_id, b.coach_id, b.id, 'consume', -1, '完成课程', 'consume:' || b.id)
    on conflict do nothing;
  end if;

  v_before := to_jsonb(b);
  update public.bookings set status = p_status where id = b.id returning * into b;
  insert into public.booking_events (booking_id, coach_id, kind, before, after)
  values (b.id, b.coach_id, 'status', v_before, to_jsonb(b));

  return to_jsonb(b);
end $$;

-- ── 撤销误扣：追加冲正流水，原扣减保留 ──────────────────────────────────
create or replace function public.lesson_revert(p_booking uuid, p_reason text)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_coach uuid := auth.uid();
  v_consume public.lesson_transactions;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_coach is null then raise exception '未登录' using errcode = '28000'; end if;
  if v_reason = '' then raise exception '请填写更正原因' using errcode = '22023'; end if;
  if char_length(v_reason) > 200 then raise exception '更正原因最多 200 字' using errcode = '22023'; end if;

  perform 1 from public.bookings where id = p_booking and coach_id = v_coach for update;
  if not found then raise exception '课程不存在或不属于当前教练' using errcode = 'P0001'; end if;

  select * into v_consume from public.lesson_transactions
   where booking_id = p_booking and coach_id = v_coach and kind = 'consume';
  if not found then raise exception '这节课没有扣课记录，无需更正' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtext('tempo:package:' || v_consume.package_id::text));

  insert into public.lesson_transactions
    (package_id, coach_id, booking_id, kind, quantity, reason, idempotency_key)
  values
    (v_consume.package_id, v_coach, p_booking, 'refund', 1, v_reason, 'refund:' || p_booking)
  on conflict do nothing;

  return to_jsonb(v_consume);
end $$;

-- ── 快照：带出套餐、流水与预约归属 ──────────────────────────────────────
create or replace function public.snapshot()
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'coach', (
      select jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email,
                                'timezone', c.timezone, 'created_at', c.created_at)
      from public.coaches c where c.id = auth.uid()
    ),
    'students', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'coach_id', s.coach_id, 'name', s.name, 'phone', s.phone,
        'notes', s.notes, 'goal', s.goal, 'preferences', to_jsonb(s.preferences),
        'created_at', s.created_at
      ) order by s.created_at, s.id) from public.students s), '[]'::jsonb),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'coach_id', t.coach_id, 'name', t.name,
        'default_duration', t.default_duration, 'color', t.color
      ) order by t.created_at, t.id) from public.course_types t), '[]'::jsonb),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id, 'coach_id', b.coach_id, 'student_id', b.student_id,
        'course_type_id', b.course_type_id, 'start_at', b.start_at, 'end_at', b.end_at,
        'status', b.status, 'notes', b.notes, 'package_id', b.package_id,
        'created_at', b.created_at, 'updated_at', b.updated_at
      ) order by b.start_at, b.id) from public.bookings b), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'booking_id', r.booking_id, 'coach_id', r.coach_id, 'rating', r.rating,
        'effort', r.effort, 'actual_minutes', r.actual_minutes, 'notes', r.notes,
        'created_at', r.created_at, 'updated_at', r.updated_at
      ) order by r.created_at, r.id) from public.training_reviews r), '[]'::jsonb),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'booking_id', e.booking_id, 'coach_id', e.coach_id, 'kind', e.kind,
        'before', e.before, 'after', e.after, 'created_at', e.created_at
      ) order by e.created_at, e.id) from public.booking_events e), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'coach_id', p.coach_id, 'student_id', p.student_id,
        'course_type_id', p.course_type_id, 'name', p.name,
        'total_sessions', p.total_sessions, 'initial_used', p.initial_used,
        'purchased_on', p.purchased_on, 'expires_on', p.expires_on,
        'notes', p.notes, 'created_at', p.created_at
      ) order by p.purchased_on, p.created_at, p.id) from public.lesson_packages p), '[]'::jsonb),
    'lesson_tx', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'coach_id', t.coach_id, 'package_id', t.package_id,
        'booking_id', t.booking_id, 'kind', t.kind, 'quantity', t.quantity,
        'reason', t.reason, 'created_at', t.created_at
      ) order by t.created_at, t.id) from public.lesson_transactions t), '[]'::jsonb),
    'availability', jsonb_build_object(
      'buffer_minutes', coalesce((select a.buffer_minutes from public.availability_settings a where a.coach_id = auth.uid()), 0),
      'rules', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'kind', r.kind, 'days', to_jsonb(r.days),
          'start_minute', r.start_minute, 'end_minute', r.end_minute
        )) from public.availability_rules r), '[]'::jsonb),
      'blocked', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'start_at', t.start_at, 'end_at', t.end_at, 'label', t.label
        ) order by t.start_at) from public.blocked_times t), '[]'::jsonb)
    )
  )
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.snapshot() to authenticated;
    grant execute on function public.package_save(uuid, uuid, uuid, text, integer, integer, date, date, text) to authenticated;
    grant execute on function public.lesson_revert(uuid, text) to authenticated;
    grant execute on function public.package_guard(uuid, uuid, uuid, timestamptz, public.booking_status, uuid) to authenticated;
    grant execute on function public.booking_create(uuid, uuid, timestamptz, timestamptz, text, uuid, public.booking_status, uuid) to authenticated;
    grant execute on function public.booking_update(uuid, timestamptz, timestamptz, uuid, text, uuid, boolean) to authenticated;
    grant execute on function public.booking_set_status(uuid, public.booking_status) to authenticated;
  end if;
end $$;
