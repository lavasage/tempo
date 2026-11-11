-- Tempo V2：学员「训练目标」独立于教练备注。
-- 只新增可空默认空串的列，不迁移、不删除既有备注；快照同步返回该字段。
alter table public.students
  add column if not exists goal text not null default '';

alter table public.students
  drop constraint if exists students_goal_len;
alter table public.students
  add constraint students_goal_len check (char_length(goal) <= 200);

-- 重定义快照以带出 goal（其余字段与 0004 一致）。
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

grant execute on function public.snapshot() to authenticated;
