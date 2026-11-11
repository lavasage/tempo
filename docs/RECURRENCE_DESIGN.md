# 周期课程 · 设计与技术方案

本轮**只做方案**，不落半成品。原因：周期课程会同时影响数据模型、冲突校验、状态机、事件日志与远端事务，任何一部分只做一半都会让「单次修改 vs 整系列修改」变成数据不一致。

---

## 1. 现有架构能支持到什么程度

| 能力 | 现状 | 结论 |
|---|---|---|
| 单节课实体 | `Booking`：学员、类型、起止、状态、备注 | 可作为「一次 occurrence」直接复用 |
| 冲突校验 | `validateBooking` / `availabilityError`，半开区间、排除自身、缓冲只算一次 | 每节课单独校验即可，无需改判定 |
| 数据库并发 | `booking_guard` 触发器 + 教练级 advisory lock + 排除约束 | 批量写入必须在一个事务内逐条走同一触发器 |
| 状态机 | `pending/confirmed/completed/cancelled`，白名单转换 | 取消「某一次」与「后续全部」是两种操作，需要显式区分 |
| 事件日志 | `booking_events` 记录 created/edited/status | 系列级操作需要额外事件类型或 `series_id` 关联 |
| 客户端同步 | `sync` 顺序队列，逐条 RPC | 批量创建不能逐条排队，否则中途失败会留下半个系列 |

结论：**单节结构可复用，缺的是「系列」这一层与批量原子写入**。

---

## 2. 数据模型（建议）

```sql
create table booking_series (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references coaches(id) on delete cascade,
  student_id uuid not null,
  course_type_id uuid not null,
  weekdays smallint[] not null,          -- 1=周一 … 7=周日，ISO 口径
  start_time time not null,              -- 教练本地时间
  duration_minutes integer not null check (duration_minutes between 5 and 480),
  starts_on date not null,
  ends_on date,                          -- 与 count 二选一
  occurrence_count integer,              -- 总次数上限
  timezone text not null,                -- 生成时按该时区解释 start_time
  created_at timestamptz not null default now(),
  check (cardinality(weekdays) > 0),
  check (ends_on is not null or occurrence_count is not null)
);

alter table bookings add column series_id uuid references booking_series(id) on delete set null;
alter table bookings add column series_index integer;   -- 第几次，便于「从第 N 次起修改」
create unique index bookings_series_slot on bookings (series_id, start_at) where series_id is not null;
```

单次修改产生的「例外课」：`series_id = null`，同时在 `series_exceptions(series_id, original_start_at)` 记录占位，避免下次展开时又生成同一时间。

不引入完整 RRULE 字段（`FREQ/BYDAY/COUNT`）的原因：私教场景 95% 是「每周固定几天、固定时间、到某个日期为止」，用结构化字段做校验和展示都更简单；真正需要复杂规则时再加 `rrule text` 扩展列即可，不影响已有数据。

---

## 3. 写入与冲突

1. **展开**：客户端按 `timezone` 把 `weekdays + start_time` 展开为具体 `timestamptz`，最多提前 8 周生成。
2. **预检**：对每个待生成时段调用现有 `availabilityError`，把冲突按日期列出来，界面先展示「9/12、9/19 与已有课程冲突」，不直接写入。
3. **原子写入**：新增 RPC `create_series(payload jsonb)`：
   - `pg_advisory_xact_lock(hashtext(coach_id))` 一次；
   - 循环插入 `bookings`，逐条走 `booking_guard`；
   - 任一条冲突 → 抛错回滚整批，返回冲突日期；
   - 成功时写一条 `booking_events(kind='created', series_id)`。
4. **幂等**：请求带 `request_id`，唯一索引兜底；重复提交不产生第二批。

---

## 4. 修改与取消的作用域

| 操作 | 行为 |
|---|---|
| 只改这一次 | 该课 `series_id=null`，写 `series_exceptions`；其余课不动 |
| 改这一次及以后 | 旧系列 `ends_on = 本次前一天`；以本次为新起点复制系列；已发生的课不动 |
| 改整个系列 | 更新 `weekdays/start_time/duration`，删除「未来且未开始」的旧 occurrence，重新展开；冲突则整批回滚 |
| 取消这一次 | 该课 `status=cancelled`，写例外，不重新生成 |
| 取消后续 | 系列 `ends_on = 今天-1`，未来 occurrence 置 `cancelled`（保留历史） |

状态机不变：取消仍是终态；已完成的课不参与系列修改。

---

## 5. 交互设计

- 排课抽屉里新增「重复」折叠区：星期多选、结束条件（日期 / 次数）、预览「共 12 节，9/8–11/24」。
- 冲突预览出现在提交按钮上方，按日期分组，可直接「跳过冲突的 2 节」或改时间重试。
- 课程详情页对系列课显示「系列 · 每周一、三 19:00」以及作用域选择（仅这次 / 这次及以后 / 全部）。
- 日历卡片右上角加一个小的循环图标，仅作识别，不使用颜色区分。

---

## 6. 分期计划

| 阶段 | 内容 | 风险 |
|---|---|---|
| R1 | 表结构 + `create_series` RPC + 冲突回滚 + 数据库用例 | 低：纯新增，不动既有单节路径 |
| R2 | 抽屉「重复」区 + 客户端展开 + 同步队列改为批量 op | 中：需要新增 sync op 类型与失败恢复 |
| R3 | 三种作用域修改/取消 + 例外表 + 事件日志展示 | 中高：跨课一致性，需要专门的对照用例 |

R1 建议与 M4 真实 Supabase 联调一起做，因为批量事务必须在真实 Postgres 上验证；PGlite 可以覆盖逻辑，但并发锁行为仍需线上复测。
