/** 用无头浏览器给预览 HTML 截图，并检查横向溢出与触控尺寸。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PREVIEW = path.join(HERE, '.preview');
const OUT = path.resolve(ROOT, '..', 'test-results', 'weapp');

const WIDTHS = [360, 375, 390, 430];

fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(PREVIEW).filter(f => f.endsWith('.html')).sort();
const browser = await chromium.launch({ channel: 'msedge' });
const report = [];

for (const file of files) {
  const id = file.replace('.html', '');
  for (const width of WIDTHS) {
    const page = await browser.newPage({ viewport: { width, height: 812 }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(path.join(PREVIEW, file)).href);
    await page.waitForTimeout(120);
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const targets = Array.from(document.querySelectorAll('.btn, .rec, .course, .student, .chip, .row, .fab, .seg-item, .task-row'));
      const heights = targets.map(n => Math.round(n.getBoundingClientRect().height)).filter(h => h > 0);
      return {
        scrollWidth: doc.scrollWidth,
        innerWidth: window.innerWidth,
        minTarget: heights.length ? Math.min(...heights) : null,
        height: doc.scrollHeight
      };
    });
    report.push({ page: id, width, overflow: metrics.scrollWidth > metrics.innerWidth + 1, scrollWidth: metrics.scrollWidth, minTarget: metrics.minTarget, height: metrics.height });
    {
      await page.screenshot({ path: path.join(OUT, `${id}-${width}.png`), fullPage: true });
    }
    await page.close();
  }
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const bad = report.filter(r => r.overflow);
console.log('页面 × 宽度：', report.length);
console.log('横向溢出：', bad.length ? JSON.stringify(bad) : '无');
console.log('最小触控高度：', Math.min(...report.map(r => r.minTarget).filter(Boolean)));
console.log('截图目录：', OUT);
