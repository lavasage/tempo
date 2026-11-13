import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';

const target = process.argv[2] || 'schedule';
const b = await chromium.launch({ channel: 'msedge' });
const p = await b.newPage({ viewport: { width: 375, height: 812 } });
await p.goto(pathToFileURL(`D:/GYMeco/weapp/tools/.preview/${target}.html`).href);
const info = await p.evaluate(() => {
  const rect = sel => {
    const n = document.querySelector(sel);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) };
  };
  return {
    barTitle: document.querySelector('.bar-title')?.textContent,
    headTitle: document.querySelector('.head .title-xl')?.textContent,
    hours: [...document.querySelectorAll('.hour')].slice(0, 4).map(n => Math.round(n.getBoundingClientRect().top)),
    events: [...document.querySelectorAll('.event')].slice(0, 3).map(n => {
      const r = n.getBoundingClientRect();
      return { top: Math.round(r.top), height: Math.round(r.height) };
    }),
    fab: rect('.fab'),
    fabPlus: rect('.fab-plus'),
    smalls: [...document.querySelectorAll('.btn, .chip, .seg-item, .rec, .row')]
      .map(n => ({ cls: n.className, h: Math.round(n.getBoundingClientRect().height) }))
      .filter(x => x.h > 0 && x.h < 44)
  };
});
console.log(JSON.stringify(info, null, 1));
await b.close();
