-- Tempo M4-A 数据结构 v1
-- 目标：与 src/types 对齐；每张业务表以 coach_id 归属；可重复执行（不依赖执行顺序以外的前提）。
-- 在 Supabase SQL Editor 或 supabase db push 应用；本地测试见 supabase/tests。
-- 约定：时间为 timestamptz（UTC 存储）；标识用 uuid；半开区间 [start, end)。

-- ── 枚举 ────────────────────────────────────────────────────────────────
do $$ begin
  create type public.booking_status as enum ('pending','confirmed','completed','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.booking_event_kind as enum ('created','edited','status');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lesson_tx_kind as enum ('purchase','consume','refund','adjust');
exception when duplicate_object then null; end $$;

-- ── 教练 ────────────────────────────────────────────────────────────────
create table if not exists public.coaches (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  email text not null,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now()
);

-- ── 学员 ────────────────────────────────────────────────────────────────
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  phone text not null default '' check (phone = '' or phone ~ '^\+?[0-9]{7,15}$'),
  notes text not null default '' check (char_length(notes) <= 1000),
  preferences uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (id, coach_id)
);

-- ── 课程类型 ────────────────────────────────────────────────────────────
create table if not exists public.course_types (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 20),
  default_duration integer not null default 60 check (default_duration between 5 and 480),
  color text not null default '#e6eee5',
  created_at timestamptz not null default now(),
  unique (coach_id, name),
  unique (id, coach_id)
);

-- ── 课程 ────────────────────────────────────────────────────────────────
-- 学员与课程类型用复合外键绑定同一教练，数据库层面拒绝跨教练关联。
create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id) on delete cascade,
  student_id uuid not null,
  course_type_id uuid not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status public.booking_status not null default 'confirmed',
  notes text not null default '' check (char_length(notes) <= 1000),
  request_id uuid unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bookings_time_order check (end_at > start_at),
  constraint bookings_max_length check (end_at - start_at <= interval '8 hours'),
  foreign key (student_id, coach_id) references public.students(id, coach_id) on delete restrict,
  foreign key (course_type_id, coach_id) references public.course_types(id, coach_id) on delete restrict,
  unique (id, coach_id)
);

-- ── 课后评价 ────────────────────────────────────────────────────────────
create table if not exists public.training_reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  coach_id uuid not null references public.coaches(id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  effort smallint check (effort between 1 and 10),
  actual_minutes integer not null check (actual_minutes between 0 and 600),
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id),
  foreign key (booking_id, coach_id) references public.bookings(id, coach_id) on delete cascade
);

-- ── 变更事件 ────────────────────────────────────────────────────────────
create table if not exists public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null,
  coach_id uuid not null references public.coaches(id) on delete cascade,
  kind public.booking_event_kind not null,
  before jsonb,
  after jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (booking_id, coach_id) references public.bookings(id, coach_id) on delete cascade
);

-- ── 可用性 ──────────────────────────────────────────────────────────────
create table if not exists public.availability_settings (
  coach_id uuid primary key references public.coaches(id) on delete cascade,
  buffer_minutes integer not null default 0 check (buffer_minutes between 0 and 240),
  updated_at timestamptz not null default now()
);

-- 时段用“当地日 + 分钟”表达：0–1439 起，1–1440 止；end <= start 表示跨夜。
create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id) on delete cascade,
  kind text not null check (kind in ('business','work','break')),
  days smallint[] not null check (cardinality(days) between 1 and 7 and days <@ array[0,1,2,3,4,5,6]::smallint[]),
  start_minute smallint not null check (start_minute between 0 and 1439),
  end_minute smallint not null check (end_minute between 1 and 1440),
  unique (id, coach_id)
);

create table if not exists public.blocked_times (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id) on delete cascade,
  start_at timestamptz not null,
  end_at timestamptz not null,
  label text not null default '' check (char_length(label) <= 60),
  constraint blocked_time_order check (end_at > start_at)
);

-- ── 课时账户（仅结构，M6 才接业务） ─────────────────────────────────────
create table if not exists public.lesson_packages (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.coaches(id) on delete cascade,
  student_id uuid not null,
  course_type_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, coach_id),
  foreign key (student_id, coach_id) references public.students(id, coach_id) on delete restrict,
  foreign key (course_type_id, coach_id) references public.course_types(id, coach_id) on delete restrict
);

create table if not exists public.lesson_transactions (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null,
  coach_id uuid not null references public.coaches(id) on delete cascade,
  booking_id uuid,
  kind public.lesson_tx_kind not null,
  quantity integer not null check (quantity <> 0),
  reason text not null default '' check (char_length(reason) <= 200),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 120),
  created_at timestamptz not null default now(),
  unique (coach_id, idempotency_key),
  foreign key (package_id, coach_id) references public.lesson_packages(id, coach_id) on delete restrict,
  foreign key (booking_id, coach_id) references public.bookings(id, coach_id) on delete restrict,
  constraint lesson_tx_sign check (
    (kind = 'purchase' and quantity > 0) or
    (kind = 'consume'  and quantity < 0) or
    (kind = 'refund'   and quantity > 0) or
    kind = 'adjust'
  )
);

-- 一次课程只能扣一次课时；退款必须挂在有扣减的课程上，且只能退一次。
create unique index if not exists lesson_tx_consume_once on public.lesson_transactions (booking_id) where kind = 'consume';
create unique index if not exists lesson_tx_refund_once on public.lesson_transactions (booking_id) where kind = 'refund';

-- ── 索引 ────────────────────────────────────────────────────────────────
create index if not exists bookings_coach_start on public.bookings (coach_id, start_at);
create index if not exists bookings_coach_active on public.bookings (coach_id, start_at) where status <> 'cancelled';
create index if not exists students_coach_name on public.students (coach_id, lower(name));
create index if not exists events_booking_time on public.booking_events (booking_id, created_at desc);
create index if not exists rules_coach_kind on public.availability_rules (coach_id, kind);
create index if not exists blocked_coach_time on public.blocked_times (coach_id, start_at);
create index if not exists packages_coach_student on public.lesson_packages (coach_id, student_id);

-- ── updated_at 维护 ─────────────────────────────────────────────────────
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists bookings_touch on public.bookings;
create trigger bookings_touch before update on public.bookings
for each row execute function public.touch_updated_at();

drop trigger if exists reviews_touch on public.training_reviews;
create trigger reviews_touch before update on public.training_reviews
for each row execute function public.touch_updated_at();

drop trigger if exists availability_settings_touch on public.availability_settings;
create trigger availability_settings_touch before update on public.availability_settings
for each row execute function public.touch_updated_at();
