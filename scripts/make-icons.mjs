import {chromium} from '@playwright/test';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

/**
 * 品牌图形：石墨底 + 青柠节拍线（Neo Athletic）。
 * safe=true 时整体缩小到中心 62% 以内，满足 maskable 图标的安全区要求。
 */
const art = (safe, radius) => {
  const scale = safe ? 0.62 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a313a"/>
      <stop offset="1" stop-color="#14181d"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="M104 256H172L224 160L278 352L324 232H404" fill="none" stroke="#d5fa45"
      stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
};

const out = resolve('public/icons');
mkdirSync(out, {recursive: true});
writeFileSync(resolve(out, 'icon.svg'), art(false, 112));

const browser = await chromium.launch({channel: 'msedge'});
const jobs = [
  {file: 'icon-192.png', size: 192, safe: false},
  {file: 'icon-512.png', size: 512, safe: false},
  {file: 'icon-maskable-512.png', size: 512, safe: true},
  {file: 'apple-touch-icon.png', size: 180, safe: false} // iOS 自行裁圆角，满铺更稳
];
for (const job of jobs) {
  const page = await browser.newPage({viewport: {width: job.size, height: job.size}, deviceScaleFactor: 1});
  const svg = art(job.safe, 0);
  await page.setContent(`<style>html,body{margin:0;padding:0;width:${job.size}px;height:${job.size}px;overflow:hidden}svg{display:block;width:${job.size}px;height:${job.size}px}</style>${svg}`);
  await page.screenshot({path: resolve(out, job.file)});
  await page.close();
  console.log('✓', job.file);
}
await browser.close();
