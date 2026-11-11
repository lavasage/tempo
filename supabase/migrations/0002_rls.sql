-- Tempo M4-B 权限 v1：每张表按 coach_id = auth.uid() 隔离。
-- 依赖 Supabase 提供的 auth.uid()；本地测试用 supabase/tests/bootstrap 里的同名 shim。
-- 说明：RLS 是权限边界；复合外键（0001）是数据完整性边界，两者不可互相替代。

alter table public.coaches               enable row level security;
alter table public.students              enable row level security;
alter table public.course_types          enable row level security;
alter table public.bookings              enable row level security;
alter table public.training_reviews      enable row level security;
alter table public.booking_events        enable row level security;
alter table public.availability_settings enable row level security;
alter table public.availability_rules    enable row level security;
alter table public.blocked_times         enable row level security;
alter table public.lesson_packages       enable row level security;
alter table public.lesson_transactions   enable row level security;

-- 教练本人：只能读写自己那一行
drop policy if exists coaches_owner on public.coaches;
create policy coaches_owner on public.coaches
  for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- 其余业务表：单个 for all 策略，读与写同一判据
do $$
declare t text;
begin
  foreach t in array array['students','course_types','bookings','training_reviews','booking_events',
                           'availability_settings','availability_rules','blocked_times',
                           'lesson_packages','lesson_transactions'] loop
    execute format('drop policy if exists %I_owner on public.%I', t, t);
    execute format('create policy %I_owner on public.%I for all to authenticated using (coach_id = auth.uid()) with check (coach_id = auth.uid())', t, t);
  end loop;
end $$;

-- 授权：Supabase 默认已给 authenticated，这里只在角色存在时补齐，便于本地复现。
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      grant usage on schema public to anon;
      grant select on all tables in schema public to anon;
    end if;
  end if;
end $$;

-- ── 注册即建教练档案与默认可用性 ────────────────────────────────────────
create or replace function public.handle_new_coach() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; v_tz text;
begin
  v_name := coalesce(nullif(btrim(coalesce(new.raw_user_meta_data->>'name','')), ''), split_part(new.email,'@',1));
  v_tz := coalesce(nullif(coalesce(new.raw_user_meta_data->>'timezone',''), ''), 'Asia/Shanghai');

  insert into public.coaches (id, name, email, timezone)
  values (new.id, left(v_name, 40), coalesce(new.email,''), v_tz)
  on conflict (id) do nothing;

  insert into public.availability_settings (coach_id, buffer_minutes)
  values (new.id, 0) on conflict (coach_id) do nothing;

  -- 与前端 defaultAvailability() 一致：营业与工作时间 08:00–21:00，无休息段，缓冲 0。
  if not exists (select 1 from public.availability_rules where coach_id = new.id) then
    insert into public.availability_rules (coach_id, kind, days, start_minute, end_minute) values
      (new.id, 'business', array[0,1,2,3,4,5,6]::smallint[], 480, 1260),
      (new.id, 'work',     array[0,1,2,3,4,5,6]::smallint[], 480, 1260);
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_coach();
