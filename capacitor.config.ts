import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Tempo 的原生壳：只把构建产物包进 Android WebView，业务逻辑与 PWA 完全一致。
 * 本地演示数据仍走 localStorage，不依赖网络。
 */
const config: CapacitorConfig = {
  appId: 'com.tempo.coach',
  appName: 'Tempo',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    // WebView 背景与应用画布一致，避免启动瞬间白屏
    backgroundColor: '#f3f5f8'
  },
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 400,
      backgroundColor: '#f3f5f8',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP'
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#20252c'
    }
  }
};

export default config;
