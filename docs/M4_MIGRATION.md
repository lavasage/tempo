# M4 数据底座（迁移与约束）
状态：结构与约束已完成，并在本地 Postgres（PGlite 18.6）上验证 20 项用例。客户端尚未接 Supabase，应用仍以 localStorage 运行；真实项目联调需要 Supabase URL 与 anon key。

## 文件
| 文件 | 内容 |
|---|---|
| `supabase/migrations/0001_schema.sql` | 11 张表、枚举、检查约束、复合外键、索引、updated_at 触发器 |
| `supabase/migrations/0002_rls.sql` | 全表 RLS、教练隔离策略、注册建档案与默认 08:00–21:00 |
| `supabase/migrations/0003_guard.sql` | 可约时间计算、时段/缓冲/阻塞校验、状态白名单、事务化 RPC、幂等键 |
| `supabase/migrations/0004_client.sql` | `snapshot()` 一次拉取本账号快照；`save_availability()` 原子替换可用性 |
| `src/services/remote/` | 配置、认证请求、PostgREST/RPC 客户端、字段映射、异步远端仓库 |
| `src/stores/auth.ts`、`src/stores/sync.ts` | 登录态与推送队列 |
| `src/views/Login.vue` | 邮箱登录/注册页 |
| `supabase/tests/harness.ts` | 本地 Postgres + `auth.uid()` shim，按教练切换登录态 |
| `supabase/tests/schema.test.ts` | 20 项数据库用例 |

## 前端字段 → 列
| 前端 | 列 |
|---|---|
| `AvailabilitySettings.buffer_minutes` | `availability_settings.buffer_minutes`（0–240） |
| `WeeklyWindow.start/end` | `availability_rules.start_minute/end_minute`（0–1439 / 1–1440；`24:00` → 1440） |
| `WeeklyWindow.days` | `availability_rules.days smallint[]`，0–6 与 JS `getDay()` 一致 |
| `WeeklyWindow` 跨夜 | `end_minute <= start_minute` 表示跨到次日 |
| `Student.preferences` | `students.preferences uuid[]`，触发器校验同教练 |
| `Booking.status` | 枚举 `booking_status`，默认 `confirmed` |
| `BookingEvent.before/after` | `booking_events` 的 jsonb 快照 |
| `TrainingReview.effort` | 可空，1–10；`rating` 1–5 |
| `coach.timezone` | `coaches.timezone`，默认 `Asia/Shanghai` |

## 部署
1. 建 Supabase 项目，启用 Email 登录。
2. 按 `0001 → 0002 → 0003 → 0004` 在 SQL Editor 执行，或 `supabase db push`。脚本可重复执行。
3. 注册用户时触发器 `handle_new_coach` 建 `coaches` 行、`availability_settings` 与两条默认规则。
4. 前端配置 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`（构建期注入，例如 `.env.local`）。两者缺一就退回本地演示模式；`service_role` 只允许留在服务端，绝不进 Vite 环境变量。

## 客户端模式
- **本地演示**（未配置环境变量）：数据走 `localStorage` 的 `tempo.v1`，无登录页，行为与 M3 一致；79 项单测与 20 条 E2E 都跑在这条路径上。
- **远端**（配置了 URL 与 anon key）：启动进 `/login`，未登录时路由守卫挡在登录页；登录后 `snapshot()` 拉本账号数据替换内存副本，再渲染业务视图。学员、课程、评价、可用性的写操作先落本地缓存保证界面即时，随后由 `sync` 队列按顺序推送；失败保留队列并在页头显示原因与「重试」。
- 远端模式不使用本地缓存文件，避免同设备切换账号时残留上一位教练的数据。

## 写入路径与重试
| 前端动作 | 远端调用 |
|---|---|
| 新增/编辑学员 | `students` upsert（冲突列 `id`） |
| 新建课程 | `booking_create`，`p_request` 用课程 id 作幂等键 |
| 改期/改备注 | `booking_update` |
| 确认/完成/取消 | `booking_set_status` |
| 评价 | `training_reviews` upsert（冲突列 `id`） |
| 可用性 | `save_availability`（设置、规则、临时不可约同一事务） |

同步队列是「至少一次」投递：重复推送由 `request_id`、主键 upsert 与状态机幂等吸收；不会产生第二节课或第二条评价。

## 权限与完整性是两道闸
- RLS：每表 `coach_id = auth.uid()`，`coaches` 按 `id`；策略只授予 `authenticated`，未登录读不到数据。
- 复合外键 `(student_id, coach_id)`、`(course_type_id, coach_id)`：即使用 RLS 放行，也不能把别人的学员挂到自己课上。

## 时段与事务口径
- 可约时间 =（营业 ∩ 个人工作）− 固定休息；按 `coaches.timezone` 展开当地日，跨夜窗口顺延一天。
- 缓冲是两课之间的一次间隔：已有课程满足 `b.start_at < new.end_at + gap` 且 `b.end_at > new.start_at − gap` 即判冲突。
- 取消记录不占用时段，也不因规则变化被拒；只有时间字段变化才重新校验，改状态（完成/确认）不重校验。
- 同一教练写入前取 `pg_advisory_xact_lock`，并发请求串行判定。
- `booking_create / booking_update / booking_set_status`：课程与事件同一事务；`bookings.request_id` 唯一，重复请求返回原单不重复写事件；状态白名单在函数内再校验一次。

## 本地验证
```
npm run test:db
```
数据库 24 项用例覆盖：迁移重复执行、注册建档、双教练读写隔离、跨教练外键、重叠与边界相接、30 分钟缓冲、取消释放、营业外/休息段/临时不可约、跨夜窗口、状态白名单、终态不可改期、幂等、失败不落库、偏好同教练、电话与备注长度、评价一课一条且仅 completed、课时扣减一次与退款前置、快照只含本人数据、可用性原子替换。

前端 96 项单测（79 项业务 + 16 项远端层 + 1 项认证模式）覆盖分钟/时钟互转、快照映射、RPC 与 upsert 请求形状、认证错误信息、唯一约束与过期会话提示。

## 尚未完成 / 风险
- **未与真实 Supabase 联调**：迁移只在本地 Postgres 18.6 跑过，远端请求只用假 fetch 做过单测。上线前必须在真实项目重跑迁移，并用两个账号验证隔离、重复提交与网络中断。
- 同步是「本地先成功后推送」，网络失败时界面上已是新状态，需要看页头提示重试；未实现断网自动补发与冲突合并（M5 离线策略一并处理）。
- 并发保证在数据库层（咨询锁 + 触发器），但前端没有跨标签页的远端协调；同一账号多端同时改同一节课以最后一次推送为准。
- 教练删除被 `restrict` 外键挡住，需先清课程；后续可改软删除。
- 时区按教练单一字段建模，多门店/多时区未覆盖。
- 登录页未接入找回密码与邮箱确认回调页；注册后若需邮箱确认，当前提示回登录页。

## 已验证的边界（本地）
- 同一教练同一时段并发插入：由咨询锁 + 重叠检查串行，第二个请求报「与其他课程时间冲突」；真实并发需在两个连接上复测。
