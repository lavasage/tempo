-- Tempo M4-C 一致性 v1：时段校验、缓冲、阻塞、事务内事件、请求幂等。
-- 设计要点：
--   1) 校验放在 BEFORE 触发器里，任何写入路径（REST、RPC、脚本）都绕不过去；
--   2) 先取教练级事务咨询锁，再判重叠，避免两个并发请求同时通过检查；
--   3) 课程 + 事件由同一函数写入，处在同一事务，失败一起回滚；
--   4) 幂等键落在 bookings.request_id，重复请求返回已存在的课程，不重复建单。

-- ── 当地日与时段换算 ────────────────────────────────────────────────────
create or replace function public.local_midnight(p_day date, p_tz text) returns timestamptz
language sql immutable as $$
  select (p_day::timestamp at time zone p_tz)
$$;

-- 把某种规则（business/work/break）在 [from,to] 覆盖到的当地日展开成绝对时间段合集。
-- 跨夜：end_minute <= start_minute 时结束落在次日；end_minute = 1440 即当地 24:00。
create or replace function public.rules_multirange(p_coach uuid, p_kind text, p_from timestamptz, p_to timestamptz)
returns tstzmultirange language sql stable as $$
  with cfg as (select timezone as tz from public.coaches where id = p_coach),
  span as (
    select generate_series(
      (p_from at time zone (select tz from cfg))::date - 1,
      (p_to   at time zone (select tz from cfg))::date + 1,
      interval '1 day')::date as day
  )
  select coalesce(range_agg(tstzrange(
           public.local_midnight(s.day, cfg.tz) + make_interval(mins => r.start_minute),
           public.local_midnight(s.day, cfg.tz) + make_interval(mins => r.end_minute)
             + case when r.end_minute <= r.start_minute then interval '1 day' else interval '0' end,
           '[)')), '{}'::tstzmultirange)
  from public.availability_rules r
  join span s on extract(dow from s.day)::smallint = any (r.days)
  cross join cfg
  where r.coach_id = p_coach and r.kind = p_kind
$$;

-- 可约时间 =（营业 ∩ 个人工作）− 固定休息。空集表示当天完全不可约。
create or replace function public.effective_windows(p_coach uuid, p_from timestamptz, p_to timestamptz)
returns tstzmultirange language sql stable as $$
  select (public.rules_multirange(p_coach, 'business', p_from, p_to)
          * public.rules_multirange(p_coach, 'work', p_from, p_to))
         - public.rules_multirange(p_coach, 'break', p_from, p_to)
$$;

-- ── 课程写入校验 ────────────────────────────────────────────────────────
create or replace function public.booking_guard() returns trigger
language plpgsql as $$
declare
  v_gap integer;
  v_windows tstzmultirange;
begin
  -- 历史取消记录不占用时段，也不因规则变化被拒。
  if new.status = 'cancelled' then return new; end if;

  -- 只改状态（完成/确认）时不重新校验时间，规则调整后仍可收尾历史课程。
  if tg_op = 'UPDATE' and new.start_at = old.start_at and new.end_at = old.end_at then
    return new;
  end if;

  if new.end_at <= new.start_at then
    raise exception '结束时间必须晚于开始时间' using errcode = '22007';
  end if;

  -- 同一教练串行化检查，避免并发请求同时通过。
  perform pg_advisory_xact_lock(hashtext('tempo:booking:' || new.coach_id::text));

  select coalesce(buffer_minutes, 0) into v_gap
  from public.availability_settings where coach_id = new.coach_id;
  v_gap := coalesce(v_gap, 0);

  if exists (
    select 1 from public.blocked_times t
    where t.coach_id = new.coach_id
      and tstzrange(t.start_at, t.end_at, '[)') && tstzrange(new.start_at, new.end_at, '[)')
  ) then
    raise exception '该时段已标记为不可约' using errcode = 'P0001';
  end if;

  v_windows := public.effective_windows(new.coach_id, new.start_at - interval '1 day', new.end_at + interval '1 day');
  if not (tstzrange(new.start_at, new.end_at, '[)') <@ v_windows) then
    raise exception '不在可约时间内（营业/工作时间之外或处于休息段）' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.coach_id = new.coach_id
      and b.status <> 'cancelled'
      and b.id <> new.id
      and b.start_at < new.end_at + make_interval(mins => v_gap)
      and b.end_at   > new.start_at - make_interval(mins => v_gap)
  ) then
    raise exception '与其他课程时间冲突' using errcode = 'P0001';
  end if;

  return new;
end $$;

drop trigger if exists bookings_guard_trg on public.bookings;
create trigger bookings_guard_trg
before insert or update of start_at, end_at, status on public.bookings
for each row execute function public.booking_guard();

-- ── 学员偏好必须属于同一教练 ────────────────────────────────────────────
create or replace function public.validate_student_preferences() returns trigger
language plpgsql as $$
declare v_bad integer;
begin
  if new.preferences is null or cardinality(new.preferences) = 0 then return new; end if;
  select count(*) into v_bad
  from unnest(new.preferences) p
  where not exists (select 1 from public.course_types t where t.id = p and t.coach_id = new.coach_id);
  if v_bad > 0 then
    raise exception '课程偏好包含不属于当前教练的类型' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists students_preferences_check on public.students;
create trigger students_preferences_check
before insert or update of preferences, coach_id on public.students
for each row execute function public.validate_student_preferences();

-- ── 评价只能写在已完成的课程上 ──────────────────────────────────────────
create or replace function public.validate_review_booking() returns trigger
language plpgsql as $$
declare v_status public.booking_status;
begin
  select status into v_status from public.bookings where id = new.booking_id and coach_id = new.coach_id;
  if v_status is null then
    raise exception '课程不存在或不属于当前教练' using errcode = '23503';
  end if;
  if v_status <> 'completed' then
    raise exception '只能评价已完成的课程' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists reviews_booking_check on public.training_reviews;
create trigger reviews_booking_check
before insert or update of booking_id on public.training_reviews
for each row execute function public.validate_review_booking();

-- ── 课时流水：扣减需关联课程，退款需先有扣减 ────────────────────────────
create or replace function public.validate_lesson_transaction() returns trigger
language plpgsql as $$
begin
  if new.kind in ('consume','refund') and new.booking_id is null then
    raise exception '% 必须关联课程', new.kind using errcode = '23502';
  end if;
  if new.kind = 'refund' and not exists (
    select 1 from public.lesson_transactions t
    where t.booking_id = new.booking_id and t.kind = 'consume' and t.package_id = new.package_id
  ) then
    raise exception '没有对应的课时扣减，不能退款' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists lesson_tx_validate on public.lesson_transactions;
create trigger lesson_tx_validate
before insert or update on public.lesson_transactions
for each row execute function public.validate_lesson_transaction();

-- ── 事务化写入入口 ──────────────────────────────────────────────────────
-- 课程 + created 事件同事务；request_id 相同则返回原课程，不重复建单。
create or replace function public.booking_create(
  p_student uuid,
  p_type uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_notes text default '',
  p_request uuid default null,
  p_status public.booking_status default 'confirmed'
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare b public.bookings;
begin
  if p_request is not null then
    select * into b from public.bookings where coach_id = auth.uid() and request_id = p_request;
    if found then return to_jsonb(b); end if;
  end if;

  begin
    insert into public.bookings (coach_id, student_id, course_type_id, start_at, end_at, status, notes, request_id)
    values (auth.uid(), p_student, p_type, p_start, p_end, p_status, p_notes, p_request)
    returning * into b;
  exception when unique_violation then
    select * into b from public.bookings where coach_id = auth.uid() and request_id = p_request;
    if found then return to_jsonb(b); end if;
    raise;
  end;

  insert into public.booking_events (booking_id, coach_id, kind, before, after)
  values (b.id, b.coach_id, 'created', null, to_jsonb(b));

  return to_jsonb(b);
end $$;

-- 改期/改备注：终态不可改，事件与课程同事务。
create or replace function public.booking_update(
  p_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_type uuid default null,
  p_notes text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare b public.bookings; v_before jsonb;
begin
  select * into b from public.bookings where id = p_id and coach_id = auth.uid() for update;
  if not found then raise exception '课程不存在或不属于当前教练' using errcode = 'P0001'; end if;
  if b.status in ('completed','cancelled') then raise exception '已结束的课程不可修改' using errcode = 'P0001'; end if;

  v_before := to_jsonb(b);
  update public.bookings
     set start_at = p_start,
         end_at = p_end,
         course_type_id = coalesce(p_type, course_type_id),
         notes = coalesce(p_notes, notes)
   where id = b.id
  returning * into b;

  insert into public.booking_events (booking_id, coach_id, kind, before, after)
  values (b.id, b.coach_id, 'edited', v_before, to_jsonb(b));

  return to_jsonb(b);
end $$;

-- 状态机与前端白名单一致：pending→confirmed|cancelled；confirmed→completed|cancelled；终态只读。
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

  v_before := to_jsonb(b);
  update public.bookings set status = p_status where id = b.id returning * into b;
  insert into public.booking_events (booking_id, coach_id, kind, before, after)
  values (b.id, b.coach_id, 'status', v_before, to_jsonb(b));

  return to_jsonb(b);
end $$;
