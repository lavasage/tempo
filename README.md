# Tempo
移动端优先的健身教练个人排课工作台。默认本地演示，无需 Supabase；配置 Supabase 环境变量后启用邮箱登录与按账号隔离的远端同步。
## 启动
安装 Node.js 22.12+，执行 `npm install`、`npm run dev`。
当前机器未配置 npm，可使用 `node package/bin/npm-cli.js run dev`。
构建：`npm run build`。测试：`npm test`。
## 结构
src/app 应用与路由装配；views 课表、学员、学员编辑、排课、时间设置；stores Pinia 状态；services 冲突、创建、状态、可用性、学员与工作台规则、PWA 与离线缓存；repositories 存储接口；mock 演示种子；types 数据实体；composables 日期与当前时间；styles 响应式样式；scripts 图标生成与 PWA 验收。
## 数据
时间以 UTC ISO 字符串存储，按浏览器时区显示。UUID 标识。取消保留历史；完成必须手动操作。数据保存在 localStorage 的 tempo.v1，不跨设备同步。侧栏或移动端页尾可重置。请勿在演示模式保存真实敏感信息。
周视图为周一起的自然周；空档由营业时间与个人工作时间交集生成，每 30 分钟一个起点、默认 60 分钟，表单可预约任意时间。已完成和取消课程只读。演示学员电话为虚构数据。
## 下一阶段
真实 Supabase 项目联调（迁移上线、双账号隔离与并发复测）＋ iOS/Android 实机验收。课时账户仍为设计，需单独批准。当前不含 Apple Calendar、微信通知或课时余额。

## 课后评分与统计
已完成课程可填写/修改教练表现分（1–5）、可选学员用力反馈（1–10）、实际训练分钟和备注。完成后留在详情页，可跳过，稍后从训练回顾补评。课表与学员详情包含近 7/30/90 天和全部统计。未评分不按零分统计。旧版存储自动补 reviews 空数组，已有课程保持不变。

Ischys 的 MIT 趋势函数已局部移植，详见 [开源迁移记录](docs/open-source-research.md) 与 [许可证](public/licenses/ischys.txt)。无新增运行依赖。

端到端测试：先运行开发服务器（5173），再执行 npm run test:e2e。当前测试使用系统 Microsoft Edge，覆盖 375/390/430px 手机与 1440px 桌面。其他系统可将 playwright.config.ts 的 channel 改为已安装浏览器或安装 Playwright Chromium。

## 第二阶段 Milestone 1
审计、实施计划、架构、开发日志与试用方案位于 docs/。本轮修复状态机、终态保护、关联校验、跨日显示、存储异常与变更追溯。新版本会兼容旧课程数据，无需重置。E2E 当前覆盖 375/390/430px 和桌面；先启动 5173 开发服务器再运行 npm run test:e2e。仅测试环境，无原生打包和生产部署。

## M2交付
已完成日时间轴、自然周、月历和时间设置。课表右上角设置按钮可编辑工作时间、休息、营业时间、缓冲和临时不可约。旧数据自动补默认规则。测试：64单元/集成、12浏览器用例。
若开发端口不同，可用环境变量TEMPO_TEST_URL覆盖Playwright地址。例如PowerShell：`$env:TEMPO_TEST_URL='http://127.0.0.1:5174'; npm run test:e2e`。

## M3交付
学员档案与首页工作台。学员可新增/编辑（电话选填，7–15 位数字）、按姓名或电话搜索；档案显示已完成节数、有效预约与最近训练，课程记录按状态、类型、起止日期筛选，可直接从档案为学员排课，编辑保留原有课程关联。首页显示今日、本周、本月完成、下一节与待处理，可原地确认或完成。统计均从课程派生，不另存计数。

数据仍在 localStorage 的 tempo.v1；学员修改暂不写审计事件。测试：79 项单元/集成，20 项浏览器用例（375/390/430px 与 1440px 桌面）。M3 阶段尚无 Supabase、PWA 与原生打包。

## M4 数据底座与账号
Supabase 迁移已就位：`supabase/migrations` 四份脚本（11 张表结构、全表 RLS、时段校验与事务化写入、快照与可用性存储过程），可重复执行。前端已接入邮箱登录与异步远端仓库：未配置环境变量时保持本地演示；配置后启动进登录页，未登录只能留在登录页，登录后按账号拉取自己的数据。

启用远端：在构建环境中提供 `VITE_SUPABASE_URL` 与 `VITE_SUPABASE_ANON_KEY`（例如 `.env.local`）。`service_role` 只允许放服务端。部署顺序、字段映射、同步语义与已知风险见 [M4 数据底座](docs/M4_MIGRATION.md)。

测试：`npm run test:db` 跑 24 项数据库用例（双教练隔离、重叠与缓冲、跨夜、状态白名单、幂等、快照与可用性）；前端 96 项单测；20 条 E2E 走本地演示路径。新增开发依赖 `@electric-sql/pglite` 仅用于数据库测试，不进产物。

## M5 PWA 与离线
应用可安装到桌面/主屏：`public/manifest.webmanifest` 声明名称、图标与三个快捷方式，`public/sw.js` 预缓存应用外壳与构建产物，断网刷新仍可打开。构建时由 `vite.config.ts` 的 `tempo-sw-precache` 插件把带 hash 的产物清单注入 Service Worker，因此首次访问后即可离线。

离线口径：本地演示完全可用；远端账号离线只读（同步队列在内存里，刷新会丢，故拦住写入并提示联网）。远端登录后的快照按账号缓存在 `tempo.cache.v1`，离线启动回放并标注缓存时间，换账号或退出登录即清除。Chromium/Edge/Android 捕获安装事件显示安装卡片，用户拒绝后不再打扰；iOS Safari 改为「分享 → 添加到主屏幕」文字指引。新版本等待确认后接管，不强制中断操作。

无障碍：首个 Tab 是「跳到主要内容」，`main#main` 可获得焦点，导航有 aria-label，状态区 aria-live，图标按钮均有可读名称。

验证：`npm run test`（110 项单元/集成）、`npm run test:e2e`（40 项浏览器用例，含清单、键盘跳转、离线提示、安装卡片）、`npm run verify:pwa`（生产构建断网刷新 10 项断言）、`npm run icons` 重新生成图标。部署要求（HTTPS、`sw.js` 不缓存、manifest 类型、SPA 回落）与已知限制见 [M5 PWA 交付说明](docs/M5_PWA.md)。

## Android 首版（1.0.0）
Capacitor 原生壳 + 本地构建产物，包名 `com.tempo.coach`，minSdk 24 / targetSdk 36，断网可用。
出包：`npm run build` → `npx cap copy android` → `cd android && ./gradlew assembleRelease`（需 JDK 21）。
签名密钥、`keystore.properties` 与 `local.properties` 不入库；版本、校验和与验收记录见 [Android 首版交付说明](docs/ANDROID_RELEASE.md)。
