# 本地测试记录 · 2026-11-13

按用户要求测试当前工作区。业务源码未修改；测试使用隔离浏览器上下文和演示数据，未连接真实Supabase、未安装手机包或部署。

| 检查 | 结果 |
|---|---|
| npm test | 14文件，128/128通过 |
| npm run test:db | 2文件，36/36通过，PGlite |
| npm run build | TypeScript严格检查与Vite构建通过 |
| 全量E2E | 85/85通过，2.2分钟，Edge，2 workers，总用例超时60秒 |
| PWA构建产物 | 11项检查通过，含manifest、图标、SW缓存、断网刷新、离线提示和学员浏览；其中1项为截图文件存在检查 |

E2E尺寸：360、375、390、430×844及1440×1000。覆盖日周月视图、可预约规则、冲突、改期取消、学员增改查、套餐登记/余额/关联/完成扣课/撤销冲正、不计套餐、课后评分、清空日期、未来完成拒绝、未保存反馈保护、待办弹层关闭/返回/焦点、离线提示和导航。

另检查360px周视图截图，七天同屏，无页面横向溢出。测试截图在test-results；非完整视觉或无障碍审计。

复现命令（本机无npm命令时以 node package/bin/npm-cli.js 替代npm）：

```powershell
node package/bin/npm-cli.js test
node package/bin/npm-cli.js run test:db
node package/bin/npm-cli.js run build
# 先在另一终端启动Vite 5174
$env:TEMPO_TEST_URL='http://127.0.0.1:5174'
node package/bin/npm-cli.js run test:e2e -- --workers=2 --timeout=60000
node scripts/verify-pwa.mjs
```

开发服务器本轮重新启动并保留：http://127.0.0.1:5174/ 。未发现现有自动化覆盖范围内失败。真实远端并发、iOS/Android实机键盘及原生返回、TalkBack、性能对照和备份恢复不在此次通过结论内。
