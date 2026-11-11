# Tempo 1.0.0 · Android 首版交付说明

## 产物

| 项目 | 值 |
| --- | --- |
| 安装包 | `release/Tempo-1.0.0.apk`（不入版本库） |
| 包名 | `com.tempo.coach` |
| 应用名 | Tempo |
| versionCode / versionName | `1` / `1.0.0` |
| 体积 | 3.3 MB |
| minSdk / targetSdk | 24（Android 7.0）/ 36（Android 16） |
| SHA-256 | `82c558e062bf1ee058e4369edad23b428979f7fe74b5c72a7c968df1f89057fe` |
| 签名 | 正式密钥 `android/tempo-release.keystore`，别名 `tempo`（不入库） |
| 证书 SHA-256 | `1a318c741c10279db82796e4be7561f8bbcc5bc9d8f84bfff6a5b98f9e6d6543` |

安装：把 APK 传到手机（微信文件传输助手 / 数据线均可）→ 点开 → 允许「安装未知来源应用」。

## 打包形态

首版不是「在线网页套壳」，也不是 PWA 快捷方式，而是 **Capacitor 原生壳 + 本地构建产物**：

- `webDir = dist`，构建时 `vite build` 产出带 hash 的静态资源，`cap copy android` 同步进 `android/app/src/main/assets/public/`。
- WebView 通过 `https://localhost` 加载本地资源，**断网也能完整使用**（数据在 localStorage）。
- PWA 的 Service Worker 原样保留：导航走网络优先（在壳里等同本地资源），带 hash 的产物走缓存优先，不会出现新旧资源混载。

## 原生适配

- **图标**：自适应图标（石墨底 `#20252C` + lime 波形前景），5 档密度；兼容 Android 8 以下的传统/圆形图标。
- **启动图**：浅色画布 `#F3F5F8` + 居中小图标，配合 `SplashScreen` 插件 400ms 淡出，不闪白。
- **状态栏**：`targetSdk 36` 强制边到边，Web 端补了 `env(safe-area-inset-top)`——移动端主区域顶部、全屏排课抽屉头部都让出了状态栏高度；底部导航原本就有 `safe-area-inset-bottom`。
- **主题**：`colorPrimary` 石墨、`colorAccent` lime，与 Design Token 同源。

## 重新出包

```bash
npm run build                                  # 产出 dist
npx cap copy android                           # 同步进原生工程
cd android
export JAVA_HOME="/d/新建文件夹 (2)/jbr"        # 需 JDK 21，Capacitor 7 要求
./gradlew assembleRelease
```

产物在 `android/app/build/outputs/apk/release/app-release.apk`。

`android/keystore.properties` 与 `android/*.keystore` 已写入 `.gitignore`，**换机器前请备份这两个文件**，否则无法覆盖安装升级。

## 验收

| 关卡 | 结果 |
| --- | --- |
| `vue-tsc --noEmit` | 0 错误 |
| 单元 / 集成测试 | 110 项通过 |
| 浏览器 E2E（375/390/430/1440） | 40 项通过 |
| PWA 离线验收 `npm run verify:pwa` | 11 项通过 |
| APK 签名与元信息 | `apksigner verify` 通过；包名/版本/标签正确 |
| 包内资源冒烟 | 从 APK 解出 `assets/public` 单独起服务，跑通课表 / 抽屉 / 学员 / 时间设置，无页面报错 |
| 调试残留扫描 | APK 内无 `_test`、`_driver`、`*.md`、`*.py`、sourcemap |

## 已知边界

- 单机版：数据在手机 localStorage，不跨设备同步；卸载即清空。设置页提供「重置演示数据」。
- 远端账号模式（Supabase）仍为空配置：需要 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 才出现登录页。
- 首版只有 Android，未做 iOS（需要 macOS + Xcode）。
- 循环课程（`docs/RECURRENCE_DESIGN.md`）只有设计稿，未实现。
