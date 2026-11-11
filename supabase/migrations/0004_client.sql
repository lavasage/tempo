-- Tempo M4-B 客户端配套 v1：一次拉取本教练快照；可用性原子保存。
-- 两者都用 security invoker，RLS 仍然生效，函数本身不扩大权限。

-- 返回前端 Database 所需的全部数据；未登录时 coach 为 null，其余为空数组。
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
        'notes', s.notes, 'preferences', to_jsonb(s.preferences), 'created_at', s.created_at
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
        'status', b.status, 'notes', b.notes, 'created_at', b.created_at, 'updated_at', b.updated_at
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

-- 可用性整块替换：设置、固定规则、临时不可约在同一事务里生效。
create or replace function public.save_availability(
  p_buffer integer,
  p_business jsonb,
  p_work jsonb,
  p_breaks jsonb,
  p_blocked jsonb
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  v_coach uuid := auth.uid();
  v_kind text;
  v_rows jsonb;
begin
  if v_coach is null then raise exception '未登录' using errcode = '28000'; end if;
  if p_buffer is null or p_buffer < 0 or p_buffer > 240 then
    raise exception '课程间隔需在 0–240 分钟' using errcode = '22023';
  end if;

  insert into public.availability_settings (coach_id, buffer_minutes)
  values (v_coach, p_buffer)
  on conflict (coach_id) do update set buffer_minutes = excluded.buffer_minutes;

  delete from public.availability_rules where coach_id = v_coach;
  delete from public.blocked_times where coach_id = v_coach;

  foreach v_kind in array array['business','work','break'] loop
    v_rows := case v_kind when 'business' then p_business when 'work' then p_work else p_breaks end;
    if v_rows is null then continue; end if;
    if jsonb_typeof(v_rows) <> 'array' then raise exception '% 规则需为数组', v_kind using errcode = '22023'; end if;
    insert into public.availability_rules (id, coach_id, kind, days, start_minute, end_minute)
    select coalesce((e->>'id')::uuid, gen_random_uuid()), v_coach, v_kind,
           (select array_agg(x::smallint) from jsonb_array_elements_text(e->'days') x),
           (e->>'start_minute')::smallint, (e->>'end_minute')::smallint
    from jsonb_array_elements(v_rows) e;
  end loop;

  if p_blocked is not null and jsonb_typeof(p_blocked) = 'array' then
    insert into public.blocked_times (id, coach_id, start_at, end_at, label)
    select coalesce((e->>'id')::uuid, gen_random_uuid()), v_coach,
           (e->>'start_at')::timestamptz, (e->>'end_at')::timestamptz,
           coalesce(e->>'label','')
    from jsonb_array_elements(p_blocked) e;
  end if;

  return public.snapshot();
end $$;
