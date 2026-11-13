/**
 * 页面行为测试：小程序没有 DOM 测试环境，用最小 Page/wx 桩把页面跑起来，
 * 直接调用 bindtap 对应的函数，检查 data 与本地数据是否真的变了。
 * 这样能挡住「按钮点了没反应」「筛选不生效」这类只有上手才会发现的问题。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { seed } from '../utils/seed.js';
import * as store from '../utils/store.js';
import * as rules from '../utils/rules.js';
import * as date from '../utils/date.js';
import * as auth from '../utils/auth.js';
import * as db from '../utils/db.js';
import * as id from '../utils/id.js';
import * as ui from '../utils/ui.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const storage = {};
const calls = [];

globalThis.wx = {
  getStorageSync: k => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => {
    storage[k] = v;
  },
  removeStorageSync: k => {
    delete storage[k];
  },
  showToast: o => calls.push(['toast', o.title]),
  showModal: o => {
    calls.push(['modal', o.title]);
    if (o.success) o.success({ confirm: true, content: '测试输入' });
  },
  login: o => o.success({ code: 'test-code' }),
  navigateTo: o => calls.push(['navigateTo', o.url]),
  navigateBack: () => calls.push(['back']),
  switchTab: o => calls.push(['switchTab', o.url]),
  getWindowInfo: () => ({ statusBarHeight: 44 }),
  getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 })
};

const MODS = {
  '../../utils/store': store,
  './utils/auth': auth,
  '../../utils/date': date,
  '../../utils/rules': rules,
  '../../utils/auth': auth,
  '../../utils/db': db,
  '../../utils/id': id,
  '../../utils/ui': ui
};

function setPath(target, key, value) {
  const parts = key.split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

/** 把页面 js 跑在沙箱里，拿到 Page 配置并触发 onLoad / onShow。 */
function open(file, query = {}) {
  let captured = null;
  const sandbox = {
    require: p => MODS[p] || {},
    Page: cfg => {
      captured = cfg;
    },
    App: () => {},
    Component: () => {},
    wx: globalThis.wx,
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    setTimeout: fn => fn(),
    getCurrentPages: () => [{}]
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  if (!captured) throw new Error(`${file} 没有调用 Page()`);
  const inst = { ...captured, data: JSON.parse(JSON.stringify(captured.data || {})) };
  inst.setData = (patch, cb) => {
    for (const [k, v] of Object.entries(patch || {})) setPath(inst.data, k, v);
    if (cb) cb();
  };
  if (inst.onLoad) inst.onLoad(query);
  if (inst.onShow) inst.onShow();
  return inst;
}

const tap = (dataset = {}) => ({ currentTarget: { dataset } });

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
  calls.length = 0;
  store.commit(JSON.parse(JSON.stringify(seed())));
});

describe('页面行为', () => {
  it('我的：默认只看最近三条，切范围与待补筛选都会重算', () => {
    const page = open('pages/my/index.js');
    expect(page.data.days).toBe(30);
    expect(page.data.rows).toHaveLength(3);
    const pending = page.data.pendingCount;
    expect(pending).toBeGreaterThan(0);

    page.togglePending();
    expect(page.data.pendingOnly).toBe(true);
    expect(page.data.rows).toHaveLength(pending);
    // 待补 = 未评分：不能出现「已评分」的行。
    expect(page.data.rows.every(r => r.status !== 'scored')).toBe(true);

    page.togglePending();
    page.setDays(tap({ days: 7 }));
    expect(page.data.days).toBe(7);
    expect(page.data.rows.length).toBeLessThanOrEqual(3);
  });

  it('我的：范围空与完全空是两种状态', () => {
    const empty = JSON.parse(JSON.stringify(seed()));
    empty.bookings = [];
    empty.reviews = [];
    store.commit(empty);
    const page = open('pages/my/index.js');
    expect(page.data.allCount).toBe(0);
    expect(page.data.scopeEmpty).toBe(false);
    expect(page.data.hasRows).toBe(false);
  });

  it('课表：日 / 周 / 月切换与翻页改的是同一份日期', () => {
    const page = open('pages/schedule/index.js');
    expect(page.data.mode).toBe('day');
    const day = page.data.day;

    page.setMode(tap({ mode: 'week' }));
    expect(page.data.mode).toBe('week');
    expect(page.data.caption).toContain('–');

    page.setMode(tap({ mode: 'month' }));
    expect(page.data.caption).toContain('年');
    expect(page.data.monthCells).toHaveLength(42);

    const monthTitle = page.data.caption;
    page.move(tap({ step: '-1' }));
    expect(page.data.day).not.toBe(day);
    expect(page.data.caption).not.toBe(monthTitle); // 月视图翻页要换月份
    expect(page.data.monthCells).toHaveLength(42);
  });

  it('学员：搜索只筛当前教练名下的人', () => {
    const page = open('pages/students/index.js');
    const all = page.data.rows.length;
    expect(all).toBeGreaterThan(1);

    page.onSearch({ detail: { value: '林' } });
    expect(page.data.search).toBe('林');
    expect(page.data.rows).toHaveLength(1);

    page.clearSearch();
    expect(page.data.rows).toHaveLength(all);
  });

  it('排课：新建落库后再进详情能看到同一节课', async () => {
    const before = store.get().bookings.length;
    const page = open('pages/editor/index.js');
    expect(page.data.start).not.toBe('09:00'); // 默认落在可用时段，不是被占用的 09:00
    await page.save();

    const after = store.get().bookings;
    expect(after.length).toBe(before + 1);
    expect(calls.some(c => c[0] === 'back')).toBe(true);

    const saved = after[after.length - 1];
    const detail = open('pages/editor/index.js', { id: saved.id });
    expect(detail.data.id).toBe(saved.id);
    expect(detail.data.status).toBe('confirmed');
  });

  it('排课：标记完成会扣套餐 1 节，撤销会补回', async () => {
    const state = JSON.parse(JSON.stringify(seed()));
    const pkg = state.packages[0].id;
    // 完成规则不允许把未来的课标记完成，用一节昨天的课来验证。
    const yesterday = date.shift(date.dateKey(), -1);
    const target = {
      ...state.bookings[0],
      id: 'past-1',
      status: 'confirmed',
      package_id: pkg,
      start_at: date.at(yesterday, 19),
      end_at: date.at(yesterday, 20)
    };
    state.bookings.push(target);
    store.commit(state);
    const before = rules.packageBalance(store.get(), pkg);

    const page = open('pages/editor/index.js', { id: target.id });
    await page.changeStatus(tap({ status: 'completed' }));

    expect(store.get().bookings.find(b => b.id === target.id).status).toBe('completed');
    expect(rules.packageBalance(store.get(), pkg)).toBe(before - 1);

    const done = open('pages/editor/index.js', { id: target.id });
    await done.revertLesson();
    expect(rules.packageBalance(store.get(), pkg)).toBe(before);
  });

  it('档案：套餐卡的已上 / 占用 / 可约与余额口径一致', () => {
    const page = open('pages/student/index.js', { id: 'st-1' });
    const card = page.data.packages[0];
    expect(card).toBeTruthy();
    expect(card.used).toBe(card.total - card.remaining);
    expect(card.available).toBe(card.remaining - card.occupied);
  });

  it('档案：登记套餐后余额、卡片与续购预填都跟着变', () => {
    const page = open('pages/student/index.js', { id: 'st-1' });
    const before = store.get().packages.length;

    page.openPackage();
    expect(page.data.packageOpen).toBe(true);
    const field = (key, value) => page.onField({ currentTarget: { dataset: { key } }, detail: { value } });
    field('name', '私教 10 节');
    field('total', '10');
    field('initial', '2');
    page.savePackage();

    const after = store.get().packages;
    expect(after.length).toBe(before + 1);
    const created = after[after.length - 1];
    // 剩余 = 总节数 − 期初已用
    expect(rules.packageBalance(store.get(), created.id)).toBe(8);
    expect(page.data.packageOpen).toBe(false);
    expect(page.data.packages.some(p => p.id === created.id)).toBe(true);

    // 续购：带着原套餐的总数与类型预填，但期初已用归零。
    page.renew(tap({ id: created.id }));
    expect(page.data.packageOpen).toBe(true);
    expect(page.data.form.total).toBe('10');
    expect(page.data.form.initial).toBe('0');
  });

  it('登录：首次启动弹窗引导，未登录时我的页显示登录入口', () => {
    let app = null;
    const sandbox = {
      require: p => MODS[p] || {},
      App: cfg => {
        app = cfg;
      },
      Page: () => {},
      wx: globalThis.wx,
      console,
      Date,
      Math,
      JSON,
      Object,
      Array,
      Number,
      String,
      setTimeout: fn => fn()
    };
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), sandbox, { filename: 'app.js' });
    app.onLaunch();
    expect(calls.some(c => c[0] === 'modal' && c[1] === '登录 Tempo')).toBe(true);

    const page = open('pages/my/index.js');
    expect(page.data.loggedIn).toBe(false);

    auth.signIn({ nickname: '阿力' });
    const signed = open('pages/my/index.js');
    expect(signed.data.loggedIn).toBe(true);
    expect(signed.data.nickname).toBe('阿力');
  });
});
