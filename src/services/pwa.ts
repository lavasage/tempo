import {reactive} from 'vue';

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

/** Chrome/Edge 的安装事件不在标准 DOM 类型里，这里补最小定义。 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
}

export const INSTALL_DISMISSED_KEY = 'tempo.install.dismissed';

/** 全局 PWA 状态：网络、可安装、已安装、有新版本待应用。 */
export const pwa = reactive({
  online: true,
  canInstall: false,
  installed: false,
  updateReady: false,
  dismissed: false,
  swActive: false,
  /** iOS Safari 无法弹出安装框，改为显示文字指引。 */
  iosHint: false
});

let deferred: BeforeInstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let reloading = false;
/** initPwa 装配时记录的存储，供没有显式传入 storage 的动作复用。 */
let activeStorage: Storage | null = null;

export function readDismissed(storage: Storage): boolean {
  try { return storage.getItem(INSTALL_DISMISSED_KEY) === '1'; } catch { return false; }
}

export function dismissInstall(storage?: Storage) {
  pwa.dismissed = true;
  pwa.canInstall = false;
  // 隐私模式或非浏览器环境下 storage 可能不可用，写入失败不影响本次会话。
  try { (storage ?? activeStorage ?? (globalThis as {localStorage?: Storage}).localStorage)?.setItem(INSTALL_DISMISSED_KEY, '1'); }
  catch { /* 忽略 */ }
}

/** 独立窗口（已安装）判定：Android/桌面用 display-mode，iOS Safari 用 navigator.standalone。 */
export function detectStandalone(win: Window): boolean {
  try {
    if (win.matchMedia?.('(display-mode: standalone)').matches) return true;
  } catch { /* 老浏览器无 matchMedia */ }
  return (win.navigator as Navigator & {standalone?: boolean}).standalone === true;
}

/**
 * iOS Safari 不触发 beforeinstallprompt，只能给文字指引。
 * iPadOS 的默认 UA 与桌面 Safari 相同，用触点数区分。
 */
export function needsIosInstallHint(win: Window): boolean {
  if (detectStandalone(win)) return false;
  const ua = win.navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && (win.navigator.maxTouchPoints ?? 0) > 1);
  return ios;
}

export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  pwa.canInstall = false;
  try {
    await event.prompt();
    const {outcome} = await event.userChoice;
    if (outcome === 'accepted') { pwa.installed = true; return 'accepted'; }
    dismissInstall();
    return 'dismissed';
  } catch {
    return 'unavailable';
  }
}

/** 让等待中的新版本立即接管，接管后刷新一次拿到新资源。 */
export function applyUpdate() {
  if (reloading) return;
  reloading = true;
  if (registration?.waiting) registration.waiting.postMessage('SKIP_WAITING');
  else window.location.reload();
}

interface InitOptions {
  win?: Window;
  storage?: Storage;
  /** 是否注册 Service Worker（生产构建或显式 ?sw=1）。 */
  register?: boolean;
  swUrl?: string;
}

/**
 * 装配 PWA 行为，返回清理函数。测试可注入假的 win/storage。
 */
export function initPwa(options: InitOptions = {}): () => void {
  const win = options.win ?? window;
  const storage = options.storage ?? localStorage;
  activeStorage = storage;
  const nav = win.navigator;
  const cleanups: Array<() => void> = [];

  pwa.online = nav.onLine !== false;
  pwa.installed = detectStandalone(win);
  pwa.dismissed = readDismissed(storage);
  pwa.iosHint = !pwa.dismissed && needsIosInstallHint(win);

  const on = (target: EventTarget, type: string, handler: EventListener) => {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };

  on(win, 'online', () => { pwa.online = true; });
  on(win, 'offline', () => { pwa.online = false; });
  on(win, 'beforeinstallprompt', event => {
    event.preventDefault();
    if (pwa.dismissed || pwa.installed) return;   // 已拒绝或已安装，不再保留安装能力
    deferred = event as BeforeInstallPromptEvent;
    pwa.canInstall = true;
  });
  on(win, 'appinstalled', () => {
    pwa.installed = true;
    pwa.canInstall = false;
    deferred = null;
  });

  const container = nav.serviceWorker;
  if (options.register && container) {
    const url = options.swUrl ?? '/sw.js';
    void container.register(url, {scope: '/'}).then(reg => {
      registration = reg;
      pwa.swActive = true;
      if (reg.waiting && container.controller) pwa.updateReady = true;
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && container.controller) pwa.updateReady = true;
        });
      });
    }).catch(() => { pwa.swActive = false; });

    const onController = () => {
      if (!reloading) return;
      window.location.reload();
    };
    container.addEventListener('controllerchange', onController);
    cleanups.push(() => container.removeEventListener('controllerchange', onController));
  }

  return () => { for (const fn of cleanups) fn(); };
}
