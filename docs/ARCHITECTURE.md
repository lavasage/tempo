# ARCHITECTURE
## 当前测试版
Vue 3 / TypeScript strict / Vite + Tailwind / Pinia / Vue Router hash。三入口：课表、学员、新建。保留既有源码结构，不初始化新工程。

UI（views/components）→ Store（操作、提交结果与错误）→ Services（课程状态/关联/区间/反馈/统计）→ Repository（localStorage 快照读写）。没有远程后端；前端 coach_id 检查是数据完整性保护，不是安全权限。

课程：UTC ISO 时间，UUID，半开时间区间；取消不占用、完成仍占用。pending 只可 confirmed/cancelled；confirmed 只可 completed/cancelled；终态只读。新建默认 confirmed。

每次创建/编辑/状态变更产生 BookingEvent（id、booking_id、coach_id、kind、before、after、created_at），与课程同次 localStorage.setItem 提交。保存失败时 Store 不更新。历史记录 UI 展示动作/状态/时间；完整差异保存在事件快照。旧数据只补空事件列表，不编造历史。

首次载入演示数据立即保存。读取错误时业务视图被阻止，原始内容保留，明确重置才清除。Repository 比较最后读取的原始字符串拒绝陈旧标签页写入；此检查无法消除两个并发标签间的竞态，不替代服务端事务。评分与课程共享存储提交边界。

## 后续 Supabase（M4 已实现，未联调）
Auth user 对应 coaches；students/course_types/bookings/availability_rules/blocked_times/packages/transactions/events/reviews 均需归属字段、外键、RLS。CourseType 当前无 coach_id，数据库迁移时补齐。绝不将 service role 放入 Vite 环境变量。
并发：同一教练写入前取 `pg_advisory_xact_lock`；重叠、缓冲、工作时间与临时阻塞在锁内校验；课程、事件同事务；`request_id` 与主键 upsert 吸收重试。数据库层是最终一致性边界，前端队列只是投递。

## M4 客户端形态（本地优先 + 异步推送）
未配置 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 时是本地演示：Store 同步读写 localStorage，无登录门槛，现有单测与 E2E 都走这条路径。
配置后进入远端模式：路由守卫先看会话，未登录只到 `/login`；登录后 `snapshot()` 一次拉取本账号数据替换内存副本，拉取完成前不渲染业务视图。此后写操作先落内存（界面即时），再由 `sync` 队列顺序调用异步远端仓库；失败保留队列并在页头提示重试。
远端模式不使用 `tempo.v1`，避免同设备换账号残留。同步是至少一次投递，靠 `booking_create` 的 `p_request`、主键 upsert 与状态机保证重放安全。断网自动补发与冲突合并留给 M5 的离线策略。

## 课时账户（仅设计）
LessonPackage: id、coach_id、student_id、course_type_id、name、expires_at、created_at。
LessonTransaction: id、package_id、coach_id、booking_id（可空）、kind(purchase/consume/refund/adjust)、quantity（带符号）、reason、created_at、idempotency_key。
总购买=购买流水之和；已消耗=扣减与相关返还净额；剩余=全部流水之和，不按课程数量推算。不直接覆盖余额。
默认完成时扣减，后续可配置扣减时点。consume 对关联 booking_id 唯一；refund 必须有关联 consume 且只能返还一次；手动调整需原因；套餐过期/不足时的阻止或透支政策须先确认。completed 取消不走普通状态机，需专门更正流程。本轮不接入 UI、不实际扣课时，因此幂等扣减测试留独立课时里程碑。

## App 路径
先完成移动 Web + PWA 与后台隔离；使用设备能力出现明确需求后再决策原生容器。此次不做原生打包、签名、商店发布。

## Milestone 2 时间域
AvailabilitySettings：business/work/breaks 每项为 WeeklyWindow(id,days,start,end)，blocked 为绝对UTC时间，buffer_minutes为课间隔。availabilityError 是创建、编辑、确认与可约建议的共同判断入口；dayWindows负责生成当地日窗口。默认值在seed和旧数据解码时一致生成。
设置表单是独立副本，通过Store一次保存；旧课不因新设置自动改期/取消，课表提示异常。Settings没有新增底部入口，由课表工具按钮进入。

## Milestone 3 学员与工作台
`services/students.ts` 负责学员输入校验、新增/编辑、搜索、档案统计和课程筛选。编辑只接受姓名、电话、备注、偏好；保留UUID、教练归属、创建时间及课程关联。Store复用先保存后更新的提交边界，存储失败保留表单供重试。学员变更尚无独立审计事件。

路由增加 `/students/new`、`/students/:id`、`/students/:id/edit`。手机采用列表→档案→编辑的独立页面；桌面列表与档案并排。刷新可恢复选中的学员；进入排课页预选该学员及其首选课程类型。偏好不自动改变已存在课程。

`services/workbench.ts` 根据课程派生今日、本周、本月完成、下一节与待办，不另存统计计数。按浏览器当地日历与课程开始日归属；自然周为周一至周日；取消不计入数量。下一节仅取尚未结束的confirmed课程，正在进行的优先；待办覆盖异常、待确认、过期未完成和两小时内开始的课程，同一课程只出现一次。

`composables/useNow.ts` 每30秒及窗口重新聚焦/恢复可见时更新时间，课表和学员页共享此时间更新方式。快捷确认/完成仍经过既有Booking Service及事件保存流程。`CoachOverview.vue` 负责紧凑展示，次要内容折叠；全局成功反馈自动消失，错误留在操作处。

## Milestone 4 远端接入
`services/remote/` 分五层：config（两个环境变量齐全才启用）、session（GoTrue 会话与续期）、client（PostgREST/RPC 与错误翻译）、mapping（分钟↔时钟、快照↔Database）、repository（异步写入）。`stores/auth` 管登录态与路由门槛；`stores/sync` 是顺序推送队列，失败停住并保留操作；`stores/tempo` 在远端模式改用内存仓库，`replaceData` 只接受服务端快照。数据库约束是最终边界，前端校验只做提前提示。

## Milestone 5 离线与安装
`services/pwa.ts` 是唯一持有 PWA 状态的地方：网络、可安装、已安装、更新待应用、iOS 指引，全部暴露在 `pwa` 响应式对象上，由 `stores/pwa` 转给视图。`initPwa()` 在生产构建或 `?sw=1` 时注册 `public/sw.js` 并返回清理函数，测试可注入假 window 与 storage。

缓存分两层：`sw.js` 负责请求级缓存（导航网络优先、`/assets` 与 `/icons` 缓存优先、跨域不接管），`services/offline.ts` 负责数据级缓存（按 `userId` 存整份 `Database`，读取时校验结构）。`boot.ts` 是唯一入口：在线拉快照并刷新数据缓存，离线且本账号有缓存时回放并在 `tempo.cachedAt` 标记时间。

离线写入的边界写在 `tempo.assertWritable()`：远端模式且离线时拒绝所有变更，避免内存队列在刷新后静默丢失。恢复网络由 App 监听 `pwa.online`：先补发队列，队列清空后再拉一次快照对齐服务端。构建期由 `vite.config.ts` 的 `tempo-sw-precache` 插件把带 hash 的产物清单注入 `dist/sw.js`，保证首次访问后即可离线。
