# M5 PWA 交付说明

移动端优先的排课工作台现在可以安装到桌面/主屏，并在断网时继续查看已有数据。本文说明实现口径、离线边界、部署要求与验收方式。

## 交付物

| 文件 | 作用 |
|---|---|
| `public/manifest.webmanifest` | 应用名称、图标、standalone 启动、主题色、三个快捷方式（新建课程 / 学员 / 可约时间） |
| `public/icons/*` | 192/512 常规图标、512 maskable 图标、180 Apple Touch 图标、矢量图标；由 `npm run icons` 用浏览器渲染生成 |
| `public/sw.js` | Service Worker：外壳与产物预缓存、导航网络优先、静态资源缓存优先 |
| `vite.config.ts` | 构建时把带 hash 的产物清单注入 `dist/sw.js`（`tempo-sw-precache` 插件），首次访问后即可离线 |
| `src/services/pwa.ts` | 网络状态、安装能力、iOS 指引、更新提示与 `SKIP_WAITING` 流程 |
| `src/services/offline.ts` | 按账号保存最近一次快照，离线启动时回放；结构不完整或换账号一律不命中 |
| `src/app/boot.ts` | 先拉远端快照并写缓存；失败时用本账号缓存启动并标记时间 |
| `scripts/verify-pwa.mjs` | 生产构建的真实离线验收（起静态服务 → 注册 SW → 断网刷新 → 断言） |

## 缓存策略

| 请求 | 策略 | 说明 |
|---|---|---|
| 导航（HTML） | 网络优先 → 缓存 `index.html` | 断网时仍能打开应用外壳 |
| `/assets/*`、`/icons/*` | 缓存优先 | 带 hash 的产物不会变，命中直接返回 |
| 其他同源 GET | 不拦截 | 交给浏览器默认行为 |
| 跨域（Supabase `/auth`、`/rest`） | 不拦截 | 绝不缓存鉴权响应 |

- 缓存分区：`tempo-v1-shell`（HTML/manifest/图标）与 `tempo-v1-assets`（构建产物）。
- 安装时逐个 `cache.add`，单个文件缺失不会让整次安装失败；激活时清理非当前版本的缓存。
- 新版本默认等待，界面出现「新版本就绪 → 立即更新」，确认后 `SKIP_WAITING` + 刷新，避免训练中途被强制重载。

## 离线边界

| 模式 | 离线行为 |
|---|---|
| 本地演示（未配置 Supabase） | 完全可用，数据在 `localStorage` 的 `tempo.v1` |
| 远端账号（已配置 Supabase） | 可浏览课表/学员/档案与缓存数据；**写入被拒绝**，提示「当前离线，修改需要联网后再试」 |

远端只读是刻意的取舍：同步队列在内存中，刷新即丢，宁可拦住也不制造「以为存上了」的假象。缓存按 `userId` 隔离，换账号读不到上一个人的数据；退出登录同时清缓存。

## 安装与无障碍

- Chromium/Edge/Android：捕获 `beforeinstallprompt`，页首出现安装卡片，点「安装」调用系统弹窗；用户拒绝后写入 `tempo.install.dismissed`，不再打扰。
- iOS Safari：不触发安装事件，改为文字指引「分享 → 添加到主屏幕」；iPadOS 桌面 UA 通过 `maxTouchPoints > 1` 识别。
- 已安装（`display-mode: standalone` 或 `navigator.standalone`）不再显示引导。
- 键盘：第一个 Tab 是「跳到主要内容」，回车把焦点交给 `main#main`（阻止 `#main` 污染 hash 路由）；焦点环 3px `#96b8a0`。
- 语义：`nav[aria-label=主导航]`、`main#main`、状态区 `aria-live=polite`、图标按钮均有 `aria-label`。

## 验收

```
npm run test        # 单元/集成（含 PWA 9 项、离线缓存 5 项）
npm run test:e2e    # 浏览器用例（含清单、键盘跳转、离线提示、安装卡片）
npm run verify:pwa  # 构建后用真实浏览器断网刷新，10 项断言
```

`verify:pwa` 会起 4183 端口静态服务并断言：清单字段与主题色、图标可访问、SW 作用域、缓存里确有构建产物、断网刷新仍渲染、离线提示文案、离线可进学员页读到本机数据。可在 `TEMPO_PWA_PORT` 覆盖端口。

## 部署要求

1. **HTTPS**：Service Worker 与安装能力只在安全上下文生效（`localhost` 例外）。
2. **`sw.js` 不缓存**：响应头 `Cache-Control: no-cache`（或 `max-age=0, must-revalidate`），否则新版本永远发不出去。
3. **manifest 类型**：`.webmanifest` 用 `application/manifest+json`；部分静态服务器默认返回 `octet-stream`，会导致安装被拒。
4. **SPA 回落**：路由用 hash（`/#/students`），只需 `/` 命中 `index.html`；如后续改 history 路由，必须把所有路径回落到 `index.html`，否则离线打开子路径会 404。
5. 部署产物是 `dist/`，可直接放 Nginx、Vercel、Netlify 或对象存储；无需 Node 运行时。

Nginx 片段：

```nginx
location = /sw.js { add_header Cache-Control "no-cache"; }
location = /manifest.webmanifest { types { } default_type application/manifest+json; }
location / { try_files $uri $uri/ /index.html; }
```

## 尚未完成 / 风险

- **未做 iOS/Android 实机验证**：安装卡片、安全区、Safari 的 SW 行为只在桌面 Chromium 与 Playwright 中验证过，真机需按 `docs/USER_TEST_PLAN.md` 走一遍。
- 远端离线只读，不支持离线排课后再补发；要实现需把同步队列持久化并处理冲突。
- 未做后台同步（Background Sync / Periodic Sync）与推送通知。
- 多标签页同时操作同一账号未加协调，仍沿用本地写入的陈旧检测（仅本地模式）。
- 图标由脚本生成，若要换成设计稿资产，替换 `public/icons/*` 后重跑 `npm run build` 即可，manifest 无需改动。
