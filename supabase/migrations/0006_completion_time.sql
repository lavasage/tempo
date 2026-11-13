-- 在数据库写入边界约束完成时间，覆盖RPC与直接更新。
create or replace function public.guard_completion_time()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='completed' and new.start_at>now() then
    raise exception '课程尚未开始，不能标记完成' using errcode='P0001';
  end if;
  return new;
end $$;
drop trigger if exists bookings_completion_time on public.bookings;
create trigger bookings_completion_time before insert or update on public.bookings
for each row execute function public.guard_completion_time();
