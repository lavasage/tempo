import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';

const page = process.argv[2] || 'schedule';
const sel = process.argv[3] || '.event';
const out = process.argv[4] || 'D:/GYMeco/test-results/weapp/zoom.png';

const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 3 });
await p.goto(pathToFileURL(`D:/GYMeco/weapp/tools/.preview/${page}.html`).href);
const el = await p.locator(sel).first();
await el.screenshot({ path: out });
const box = await el.boundingBox();
console.log(JSON.stringify(box));
await b.close();
