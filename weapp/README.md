# Tempo 教练端 · 微信小程序

原生小程序实现（不引 Taro / uni-app 等框架），与仓库里的 Web 版共用同一套业务规则：
`weapp/utils/rules.js` 逐条移植自 `src/services/*`，并用对照测试证明两边结果一致。

## 打开方式

1. 安装[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 「导入项目」→ 目录选本仓库的 `weapp/`。
3. AppID 填自己的，或直接点「测试号 / 游客模式」——`project.config.json` 里的 `appid` 是 `touristappid`，游客模式可以直接编译预览。
4. 编译后从「课表」进入；首次启动会弹一次登录引导。

> 本机没有安装微信开发者工具，所以**没有在开发者工具里编译过**，只做了下面「验证」一节列出的检查。
> 首次导入若提示补充 AppID，按提示换掉 `project.config.json` 的 `appid` 即可，代码不需要改。

## 页面

| 页面 | 路径 | 说明 |
| --- | --- | --- |
| 课表 | `pages/schedule` | 日 / 周 / 月三视图、时间轴、今日概览、待处理清单、冲突与异常提示 |
| 排课 | `pages/editor` | 新建与编辑、状态流转、套餐课时扣减与撤销、课后记录 |
| 学员 | `pages/students` | 搜索、名下学员与待上节数 |
| 档案 | `pages/student` | 概览、课时套餐（登记 / 续购）、训练表现、最近课程、备注 |
| 学员表单 | `pages/student-form` | 新建与编辑学员 |
| 我的 | `pages/my` | 本周安排 / 本月完成 / 学员数、授课记录（7 / 30 / 90 / 全部、待补反馈）、登录入口、恢复演示数据 |
| 登录 | `pages/login` | 头像昵称选择、微信登录、游客模式、权限说明 |

## 数据与登录

- 数据只存在本机：`wx.setStorageSync('tempo.weapp.v1', db)`，键名与 Web 版分开，互不影响。
- 登录是**本地身份**：保存昵称与头像，用于界面显示和区分账号，不上传任何数据。
- `wx.login()` 拿到的 `code` 需要服务端换 `openid`，本轮没有服务端，所以没有假装拿到了真实身份。
- 首次启动弹一次登录引导（`app.js`），「先看看」之后不再重复打扰；「我的」页始终保留登录入口。

## 业务口径（与 Web 版一致）

- 套餐余额：剩余 = Σ 流水；已上 = 总节数 − 剩余；占用 = 已确认未完成课程数；可约 = 剩余 − 占用。
- 完成课程扣 1 节；撤销走「冲正流水」，不改历史。
- 完成 / 有训练记录 / 有评分是三种状态：未评分显示「未评分」，不按 0 分算。
- 排课时长 = 已完成课程起止时间之和；已记录训练时长 = 课后记录里的实际分钟数，两者文案分开。
- 冲突顺序与 Web 相同：引用 → 时段重叠 → 套餐 → 可预约时间。

## 验证

```bash
npm run test:weapp      # 32 项：规则对照 13 / 结构 10 / 页面行为 9
npm run preview:weapp   # 渲染 10 个状态 × 4 档宽度（360/375/390/430），输出截图并检查溢出与触控高度
```

- **规则对照**（`tests/parity.test.mjs`）：同一份数据分别喂给 `weapp/utils/rules.js` 和 `src/services/*`，比对余额、占用、可约、记录筛选、状态流转、冲突文案、扣课与冲正。
- **结构检查**（`tests/structure.test.mjs`）：页面四件套齐全、JSON 可解析、标签闭合、只用小程序内置组件（挡住 `<p>` 这类 HTML 标签）、`wx:for` 带 `wx:key`、事件处理函数真实存在、无 Vue 语法与 `localStorage`。
- **页面行为**（`tests/pages.test.mjs`）：用 Page / wx 桩把页面跑起来，直接调 `bindtap` 对应的函数，验证范围切换、待补筛选、视图切换、新建落库、完成扣课与冲正、套餐卡口径、登录弹窗。
- **渲染预览**（`tools/preview.mjs` + `tools/shot.mjs`）：把 WXML 转成 HTML 在 Edge 里截图，逐张检查横向溢出与 44px 触控高度，产物在 `test-results/weapp/`。

### 尚未验证

- 没有在微信开发者工具里编译，也没有真机（iOS / Android）运行。
- 渲染预览是自建的 WXML→HTML 渲染器，能验证布局、文案与数据，但覆盖不到原生 `picker`、`tabBar`、授权弹窗、`wx.login` 的真实表现。
- 未接入真实 AppID、服务端 openid 与云端同步；没有做小程序审核 / 发布流程。

## 目录

```
weapp/
  app.js app.json app.wxss        启动、路由与 tabBar、设计令牌
  components/topbar/              自定义导航（状态栏高度 + 胶囊对齐）
  pages/                          七个页面
  utils/                          date / seed / db / store / rules / auth / ui / id
  tests/                          parity / structure / pages
  tools/                          preview.mjs（WXML→HTML）、shot.mjs（截图与体检）、probe/zoom（测量）
```
