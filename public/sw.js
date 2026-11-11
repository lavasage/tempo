/* Tempo 的 Service Worker：预缓存应用外壳，导航走网络优先，静态资源走缓存优先。
   只接管同源 GET；Supabase 的 /auth、/rest 请求一律直连，避免缓存鉴权数据。 */
const VERSION = 'tempo-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png'
];
/** 构建时由 vite 插件注入带 hash 的产物清单；开发环境为空数组。 */
const PRECACHE = self.__PRECACHE__ || [];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // 外壳与产物分两个缓存存放，读取策略各自匹配。逐个缓存，单个文件缺失不影响整次安装。
    const shell = await caches.open(SHELL_CACHE);
    const assets = await caches.open(ASSET_CACHE);
    await Promise.all([
      ...SHELL_FILES.map(url => shell.add(url).catch(() => undefined)),
      ...PRECACHE.map(url => assets.add(url).catch(() => undefined))
    ]);
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

/** 网络优先：拿得到就用新的，拿不到回落到缓存的 app shell。 */
async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put('/index.html', response.clone());
    return response;
  } catch {
    return (await cache.match('/index.html')) || (await cache.match('/')) ||
      new Response('<h1>离线</h1><p>Tempo 未缓存到本机，请联网后重试。</p>', {
        headers: {'Content-Type': 'text/html; charset=utf-8'}, status: 200
      });
  }
}

/** 缓存优先 + 后台更新：带 hash 的产物不会变，命中即返回。 */
async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;            // 第三方（Supabase）不接管

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request));
  }
});
