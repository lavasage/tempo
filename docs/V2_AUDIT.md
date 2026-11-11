# Tempo V2 · 代码、业务与视觉审计

审计对象：`D:\GYMeco`（Vue 3.5 + Vite 8 + Pinia + vue-router hash 模式 + localStorage / Supabase 双层仓库）。
视觉基准：根目录 `design.md`（Neo Athletic 1.0）。

---

## 1. 当前架构

| 层 | 位置 | 说明 |
|---|---|---|
| 应用装配 | `src/app/main.ts`、`App.vue`、`boot.ts` | hash 路由 8 条；远端模式带登录守卫与快照拉取；PWA 注册 |
| 视图 | `src/views/*.vue` | 课表、学员（列表+详情）、学员编辑、排课/课程详情、时间设置、登录 |
| 组件 | `src/components/` | 今日工作台、时间轴、训练回顾、训练统计 |
| 状态 | `src/stores/` | `tempo`（业务数据与写操作）、`auth`、`sync`（顺序推送队列）、`pwa` |
| 领域规则 | `src/services/` | 冲突检测、状态机、可用性计算、学员、工作台、评价与统计 |
| 仓库 | `src/repositories/local.ts`、`src/services/remote/` | 本地 localStorage 与远端 PostgREST/RPC，异步队列推送 |
| 数据 | `src/types`、`src/mock/seed.ts` | 11 个实体；演示数据 5 学员 / 3 类型 / 4 节课 |
| 测试 | `src/**/*.test.ts`、`supabase/tests`、`e2e/*.spec.ts` | 110 单测、24 数据库用例、40 浏览器用例 |

现有约束（本轮不得破坏）：E2E 依赖 `aria-label`（`查看 YYYY-MM-DD 课表`、`08:00 排课`、`我的工作时间 1 开始` 等）、结构类名（`.timeline-column`、`.timeline-booking`、`.student-row`、`.course-history-row`、`.work-item`）、`data-testid`（`today-count`、`week-count`、`month-completed`、`student-active`、`student-completed`）。

---

## 2. 业务问题清单

| # | 问题 | 证据 | 影响 | 本轮处理 |
|---|---|---|---|---|
| B1 | 冲突提示只给笼统文案，不说明撞了谁 | `services/availability.ts` 返回「此时段与已有课程重叠」 | 教练无法判断改哪一节 | 新增 `findConflict`，抽屉内展示冲突课程学员与起止时间 |
| B2 | 新建/编辑课程是整页跳转，丢失课表上下文 | `/create`、`/booking/:id` 为独立页面 | 反复来回切页，改期时看不到周边课程 | 改为路由驱动的右侧抽屉，课表保持挂载 |
| B3 | 表单无保存中/防重复提交状态 | `Editor.vue` 直接 `store.save` | 连点会产生重复事件与提示 | 增加 `saving` 守卫与按钮 loading 态 |
| B4 | 抽屉/页面关闭不检查未保存改动 | `Editor.vue` 无 dirty 判断 | 误触即丢失输入 | 抽屉关闭、路由离开、beforeunload 三重保护 |
| B5 | 新增学员后需再跳一次才能排课 | `StudentEditor` 保存后跳详情 | 多一步操作 | 增加「保存并排课」，直接带学员上下文开抽屉 |
| B6 | 周期课程缺失 | 数据结构无 recurrence 字段 | 私教周课需逐条建 | 只出设计与技术方案（`docs/RECURRENCE_DESIGN.md`），不做半成品 |
| B7 | 状态机与统计口径未在界面显式表达 | `labels` 仅 4 词 | 教练不确定「待确认」能否直接完成 | 统一状态徽标 + 详情页状态说明；转换仍由 `changeStatus` 兜底 |
| B8 | 时间设置页保存后只显示「已保存」 | `Availability.vue` | 不知道影响了哪些天 | 保留反馈，同时在页头展示时区与规则摘要 |

已核查无误：状态转换白名单、重叠判定（半开区间、排除自身）、缓冲只算一次间隔、跨夜窗口、完成课程后学员统计联动、刷新持久化、冲突时禁用提交、月/周/日共用同一数据源。

---

## 3. 视觉问题清单（对照 design.md）

| # | 问题 | 规范要求 |
|---|---|---|
| V1 | 侧栏为浅灰绿，无品牌层 | 深石墨导航 + 浅色工作区 |
| V2 | 主色 `#245e49` 深绿，整体低饱和、偏传统后台 | 多巴胺配色：青柠 `#D5FA45`、钴蓝 `#4263EB`、珊瑚 `#FF7052` |
| V3 | 所有卡片同款白底细边框，层级扁平 | 四级空间层级（Brand / Highlight / Workspace / Overlay） |
| V4 | 统计数字与正文同字号，缺力量感 | Display 40–48、数字等宽、重点数据放大 |
| V5 | 课程卡片用整块浅色背景，状态只靠颜色 | 彩色边缘 + 浅底 + 文字/图标双通道状态 |
| V6 | 页面 max-width 1100，右侧大片空白 | 主内容 1440、留白 24–40 |
| V7 | 圆角 8–14 混杂，无 token | 20 / 16 / 12 / 8 / pill 五档 |
| V8 | 动效几乎为零，仅 hover 亮度 | 120–300ms 目的性动效 + reduced-motion |
| V9 | 图标按钮无统一尺寸与状态 | 44×44 触控目标、统一 focus ring |
| V10 | 空状态只有一行文字 | 品牌几何图形 + 下一步操作 |
| V11 | 品牌图形语言缺失 | Pulse / Motion / Geometry 母题 |

---

## 4. 改造计划（按优先级）

**P0 · 视觉基础**
1. `styles/tokens.css`：品牌色、语义色、字号、间距、圆角、阴影、动效、焦点环。
2. `styles/main.css` 重写：reset、排版、按钮/输入/徽标/卡片、深色侧栏外壳。
3. 新增 `ui/StatusBadge.vue`，统一四种课程状态的文字+图标表达。

**P0 · 课表工作区**
4. `CoachOverview` 重构为深色 Highlight 卡：今日课时（Display 数字）、待确认、下一节、本周/本月、待处理。
5. `Calendar` 头部与工具栏重排；`CalendarTimeline` 课程卡片改为类型色边缘 + 状态徽标 + 当前时间珊瑚指示线。

**P0 · 排课闭环**
6. `/create`、`/booking/:id` 改为课表之上的右侧抽屉（`editor.css`），保留课表上下文；含 dirty 保护、保存中、冲突详情、可用时段建议。

**P1 · 学员**
7. `Students` Master–Detail 视觉重做；档案信息按「身份 → 下一节 → 已完成 → 目标偏好 → 排课 → 历史 → 备注」排序。
8. `StudentEditor` 增加「保存并排课」；表单校验反馈原位展示。

**P1 · 一致性与质量**
9. 时间设置、登录、训练回顾统一到新 token；登录页品牌面板。
10. 动效、focus、对比度、响应式（1440 / 1280 / 1024 / 768 / 390）回归；文档与日志更新。

## 5. 预计改动文件

- 样式：`styles/tokens.css`（新）、`main.css`、`calendar.css`、`students.css`、`workbench.css`、`availability.css`、`login.css`、`editor.css`（新）、`review.css`（新）
- 视图：`App.vue`、`Calendar.vue`、`CoachOverview.vue`、`CalendarTimeline.vue`、`Editor.vue`、`Students.vue`、`StudentEditor.vue`、`Availability.vue`、`Login.vue`、`TrainingReview.vue`、`TrainingStats.vue`
- 新组件：`components/ui/StatusBadge.vue`、`components/ui/PulseMark.vue`
- 业务：`services/booking.ts`（新增 `findConflict`，不改既有判定）、`app/main.ts`（嵌套路由）
- 文档：`docs/V2_AUDIT.md`、`docs/RECURRENCE_DESIGN.md`、`docs/DEVELOPMENT_LOG.md`、`README.md`

## 6. 风险与兼容

| 风险 | 处理 |
|---|---|
| 嵌套路由改变 `route.path`，课表的 query 同步判断会失效 | 课表监听改为「有 date query 即同步」，抽屉关闭时带回原 date/view |
| E2E 依赖文案与结构类名 | 保留全部 aria-label、类名与 data-testid，只改视觉与 DOM 语义层级 |
| 深色导航降低移动端可读性 | 移动端底部导航同样深石墨，选中态青柠，对比度按 AA 校验 |
| 课程类型颜色写入数据（含 Supabase） | 不改数据结构，只新增 `--type` 变量与 `color-mix` 派生浅底 |
| 大面积高饱和影响长时间阅读 | 高饱和只用于导航选中、主按钮描边、重点数字与图标，工作区保持中性 |
