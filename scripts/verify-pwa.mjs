import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {existsSync, statSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {extname, join, resolve} from 'node:path';
import {chromium} from '@playwright/test';

/**
 * 生产构建的 PWA 验收：静态服务 dist → 注册 Service Worker → 断网刷新 → 应用仍可用。
 * 只读不改，可以反复跑。用法：npm run verify:pwa
 */
const DIST = resolve('dist');
const PORT = Number(process.env.TEMPO_PWA_PORT || 4183);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  let path = join(DIST, decodeURIComponent(url.pathname));
  const missing = !existsSync(path) || statSync(path).isDirectory();
  // 有扩展名的请求缺失就是 404，其余按 SPA 回落到 index.html。
  if (missing && !extname(url.pathname)) path = join(DIST, 'index.html');
  try {
    const body = await readFile(path);
    res.writeHead(200, {'Content-Type': MIME[extname(path)] || 'application/octet-stream'});
    res.end(body);
  } catch {
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('not found');
  }
});

await new Promise(ok => server.listen(PORT, '127.0.0.1', ok));
const base = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({channel: 'msedge'});
const context = await browser.newContext({
  viewport: {width: 390, height: 844},
  deviceScaleFactor: 2,
  timezoneId: 'Asia/Shanghai',
  locale: 'zh-CN'
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));
const results = [];
const check = (label, ok) => { results.push({label, ok}); assert.ok(ok, label); };

try {
  await page.goto(base, {waitUntil: 'load'});

  // 1. 清单可读且字段完整
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    const res = await fetch(link?.getAttribute('href') || '/manifest.webmanifest');
    const json = await res.json();
    return {status: res.status, name: json.name, display: json.display, icons: json.icons?.length ?? 0, theme: json.theme_color, background: json.background_color};
  });
  check('manifest 200 且含名称/图标/standalone', manifest.status === 200 && manifest.icons >= 3 && manifest.display === 'standalone');
  // V2 视觉：主色改为石墨深导航，主题色与 index.html 的 theme-color 保持一致。
  check('主题色与深色导航一致', manifest.theme === '#20252c');
  check('启动背景为浅色画布', manifest.background === '#f3f5f8');

  const icon = await page.request.get(`${base}/icons/icon-512.png`);
  check('512 图标可访问', icon.status() === 200);
  const maskable = await page.request.get(`${base}/icons/icon-maskable-512.png`);
  check('maskable 图标可访问', maskable.status() === 200);

  // 2. Service Worker 激活并接管当前页面
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, {timeout: 20000});
  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const keys = await caches.keys();
    const cached = [];
    for (const key of keys) {
      const cache = await caches.open(key);
      for (const request of await cache.keys()) cached.push(new URL(request.url).pathname);
    }
    return {scope: reg.scope, keys, cached};
  });
  check('SW 作用域为根', sw.scope.endsWith('/'));
  check('外壳缓存含构建产物', sw.cached.some(p => p.startsWith('/assets/') && p.endsWith('.js')));

  // 3. 断网后刷新，应用外壳与本地数据仍可用
  await context.setOffline(true);
  await page.reload({waitUntil: 'load'});
  await page.waitForSelector('h1', {timeout: 15000});
  const offlineBanner = await page.locator('.banner-offline').textContent();
  check('断网刷新后仍渲染界面', (await page.locator('h1').count()) === 1);
  check('显示离线提示', !!offlineBanner && offlineBanner.includes('已离线'));

  // 4. 断网下可切换到学员页并读到本机数据
  await page.locator('nav a', {hasText: '学员'}).click();
  await page.waitForSelector('.student-row', {timeout: 10000});
  const names = await page.locator('.student-row').allTextContents();
  check('离线可浏览学员', names.length >= 5 && names.join('').includes('林晓'));

  await page.screenshot({path: 'test-results/pwa-offline-mobile.png', fullPage: true});
  check('截图已保存', existsSync('test-results/pwa-offline-mobile.png'));

  console.log('\n离线验收：');
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.label}`);
  console.log(`\n全部 ${results.length} 项通过（390×844，离线模式）`);
} catch (error) {
  console.error('\n控制台错误：', consoleErrors.length ? consoleErrors : '（无）');
  console.error('页面文本：', (await page.locator('body').innerText().catch(() => '')).slice(0, 600));
  throw error;
} finally {
  await browser.close();
  server.close();
}
