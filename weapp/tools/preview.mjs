/**
 * 小程序页面预览器（开发工具，不参与小程序打包）
 *
 * 作用：不需要微信开发者工具，也能用真实页面逻辑（onLoad + setData 后的 data）
 * 把 WXML/WXSS 渲染成 HTML，用来检查排版、溢出与触控尺寸。
 *
 * 用法：node weapp/tools/preview.mjs
 * 产物：weapp/tools/.preview/*.html
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(HERE, '.preview');

/* ----------------------------- wx 运行时垫片 ----------------------------- */

const storage = {};
globalThis.wx = {
  getStorageSync: key => (key in storage ? storage[key] : ''),
  setStorageSync: (key, value) => {
    storage[key] = value;
  },
  removeStorageSync: key => {
    delete storage[key];
  },
  getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 375, windowHeight: 812 }),
  getSystemInfoSync: () => ({ statusBarHeight: 44 }),
  getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32, left: 278, width: 87 }),
  showToast: () => {},
  showModal: () => {},
  navigateTo: () => {},
  navigateBack: () => {},
  switchTab: () => {},
  login: o => o && o.success && o.success({ code: 'preview' })
};

const { seed } = await import(pathToFileURL(path.join(ROOT, 'utils/seed.js')).href);
const utils = {
  '../../utils/store': await import(pathToFileURL(path.join(ROOT, 'utils/store.js')).href),
  '../../utils/date': await import(pathToFileURL(path.join(ROOT, 'utils/date.js')).href),
  '../../utils/rules': await import(pathToFileURL(path.join(ROOT, 'utils/rules.js')).href),
  '../../utils/auth': await import(pathToFileURL(path.join(ROOT, 'utils/auth.js')).href),
  '../../utils/ui': await import(pathToFileURL(path.join(ROOT, 'utils/ui.js')).href),
  '../../utils/db': await import(pathToFileURL(path.join(ROOT, 'utils/db.js')).href),
  '../../utils/id': await import(pathToFileURL(path.join(ROOT, 'utils/id.js')).href)
};

function freshStore(db) {
  for (const key of Object.keys(storage)) delete storage[key];
  const data = db || seed();
  storage['tempo.weapp.v1'] = data;
  // store 里有模块级缓存，换页面必须显式提交一次，否则一直沿用第一页的数据。
  utils['../../utils/store'].commit(data);
}

/* --------------------------------- 解析 WXML --------------------------------- */

const TAG_MAP = {
  view: 'div',
  text: 'span',
  image: 'img',
  button: 'div',
  input: 'div',
  textarea: 'div',
  picker: 'div',
  'scroll-view': 'div',
  navigator: 'div'
};

/** 属性值里可能出现 `>`（例如 review.rating >= item），必须跳过引号内内容。 */
function findTagEnd(source, from) {
  let quote = null;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '>') return i;
  }
  return -1;
}

function parseWxml(source) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  let i = 0;
  const push = node => stack[stack.length - 1].children.push(node);
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) {
      const text = source.slice(i);
      if (text.trim()) push({ type: 'text', text });
      break;
    }
    if (lt > i) {
      const text = source.slice(i, lt);
      if (text.trim()) push({ type: 'text', text });
    }
    if (source.startsWith('<!--', lt)) {
      i = source.indexOf('-->', lt) + 3;
      continue;
    }
    const gt = findTagEnd(source, lt + 1);
    if (gt === -1) break;
    const raw = source.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1).trim() : raw;
    const nameMatch = body.match(/^([\w:-]+)/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const attrs = {};
    const attrText = body.slice(name.length);
    const attrRe = /([\w:.-]+)(?:\s*=\s*"([^"]*)")?/g;
    let m;
    while ((m = attrRe.exec(attrText))) attrs[m[1]] = m[2] === undefined ? '' : m[2];
    const node = { type: 'element', name, attrs, children: [] };
    push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

/* --------------------------------- 表达式求值 --------------------------------- */

function evalExpr(expr, scope) {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('scope', `with (scope) { return (${expr}); }`);
    return fn(scope);
  } catch (e) {
    return '';
  }
}

function value(raw, scope) {
  if (raw === undefined) return '';
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('{{') && trimmed.endsWith('}}') && trimmed.indexOf('{{', 2) === -1) {
    return evalExpr(trimmed.slice(2, -2), scope);
  }
  return String(raw).replace(/\{\{([^}]*)\}\}/g, (_, e) => {
    const v = evalExpr(e, scope);
    return v === undefined || v === null ? '' : String(v);
  });
}

function textOf(raw, scope) {
  return String(raw).replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => {
    const v = evalExpr(e, scope);
    return v === undefined || v === null ? '' : String(v);
  });
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* --------------------------------- 渲染 --------------------------------- */

function renderChildren(children, scope, ctx, out) {
  let chainOpen = false;
  let chainMatched = false;
  for (const child of children) {
    if (child.type === 'text') {
      out.push(esc(textOf(child.text, scope)));
      continue;
    }
    const attrs = child.attrs || {};
    if ('wx:if' in attrs) {
      chainOpen = true;
      chainMatched = !!value(attrs['wx:if'], scope);
      if (!chainMatched) continue;
    } else if ('wx:elif' in attrs) {
      if (!chainOpen || chainMatched) continue;
      chainMatched = !!value(attrs['wx:elif'], scope);
      if (!chainMatched) continue;
    } else if ('wx:else' in attrs) {
      if (!chainOpen || chainMatched) continue;
      chainOpen = false;
      chainMatched = true;
    } else {
      chainOpen = false;
      chainMatched = false;
    }

    if ('wx:for' in attrs) {
      const list = value(attrs['wx:for'], scope) || [];
      const itemName = attrs['wx:for-item'] || 'item';
      const indexName = attrs['wx:for-index'] || 'index';
      const arr = Array.isArray(list) ? list : Object.values(list);
      arr.forEach((item, index) => {
        const inner = Object.create(scope);
        inner[itemName] = item;
        inner[indexName] = index;
        renderElement({ ...child, attrs: { ...attrs, 'wx:for': undefined, 'wx:if': undefined } }, inner, ctx, out, index);
      });
      continue;
    }

    renderElement(child, scope, ctx, out);
  }
}

function renderElement(node, scope, ctx, out) {
  const attrs = node.attrs || {};
  if (node.name === 'block' || node.name === 'slot') {
    renderChildren(node.children, scope, ctx, out);
    return;
  }

  if (node.name === 'topbar') {
    renderComponent('topbar', node, scope, ctx, out);
    return;
  }

  const cls = value(attrs.class, scope);
  const style = convertRpx(String(value(attrs.style, scope) || ''));
  const clsAttr = cls ? ` class="${esc(cls)}"` : '';
  const styleAttr = style ? ` style="${esc(style)}"` : '';

  if (node.name === 'input') {
    const v = value(attrs.value, scope);
    const ph = value(attrs.placeholder, scope);
    out.push(`<div${clsAttr}${styleAttr}>${esc(v || ph)}</div>`);
    return;
  }
  if (node.name === 'textarea') {
    const v = value(attrs.value, scope);
    const ph = value(attrs.placeholder, scope);
    out.push(`<div${clsAttr}${styleAttr}>${esc(v || ph)}</div>`);
    return;
  }
  if (node.name === 'image') {
    const src = value(attrs.src, scope);
    const style2 = src ? `${style};background:url('${esc(src)}') center/cover no-repeat` : style;
    out.push(`<div${clsAttr} style="${esc(style2)}"></div>`);
    return;
  }

  const tag = TAG_MAP[node.name] || 'div';
  out.push(`<${tag}${clsAttr}${styleAttr}>`);
  renderChildren(node.children, scope, ctx, out);
  out.push(`</${tag}>`);
}

function renderComponent(name, node, scope, ctx, out) {
  const def = ctx.components[name];
  if (!def) return;
  const props = { ...def.data };
  for (const [key, raw] of Object.entries(node.attrs || {})) {
    if (key.startsWith('wx:') || key.startsWith('bind') || key === 'class' || key === 'style') continue;
    const v = value(raw, scope);
    props[key] = v === '' && raw === '' ? true : v;
  }
  const inner = Object.assign(Object.create(null), props);
  const buffer = [];
  renderChildren(def.nodes, inner, ctx, buffer);
  const cls = value(node.attrs.class, scope);
  out.push(`<div class="component ${name} ${esc(cls || '')}">${buffer.join('')}</div>`);
}

/* --------------------------------- 样式 --------------------------------- */

function convertRpx(text) {
  return text.replace(/(\d*\.?\d+)rpx/g, (_, n) => `calc(100vw * ${(Number(n) / 750).toFixed(6)})`);
}

function loadCss(file) {
  if (!fs.existsSync(file)) return '';
  return convertRpx(fs.readFileSync(file, 'utf8')).replace(/(^|\n)\s*page\s*\{/g, '$1 .wx-page {');
}

/* --------------------------------- 页面实例 --------------------------------- */

function setPath(target, key, val) {
  if (!key.includes('.')) {
    target[key] = val;
    return;
  }
  const parts = key.split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}

function instantiate(source, query) {
  let captured = null;
  const sandbox = {
    require: p => utils[p] || {},
    Page: cfg => {
      captured = cfg;
    },
    Component: () => {},
    App: () => {},
    wx: globalThis.wx,
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    setTimeout: fn => fn(),
    getCurrentPages: () => [{}]
  };
  vm.runInNewContext(source, sandbox, { filename: 'page.js' });
  if (!captured) throw new Error('Page() 未调用');
  const data = JSON.parse(JSON.stringify(captured.data || {}));
  const inst = { ...captured, data };
  inst.setData = (patch, cb) => {
    for (const [k, v] of Object.entries(patch || {})) setPath(inst.data, k, v);
    if (cb) cb();
  };
  if (inst.onLoad) inst.onLoad.call(inst, query || {});
  if (inst.onShow) inst.onShow.call(inst);
  return inst;
}

/* --------------------------------- 主流程 --------------------------------- */

const PAGES = [
  { id: 'schedule', file: 'pages/schedule/index', query: {} },
  { id: 'schedule-month', file: 'pages/schedule/index', query: {}, after: d => (d.mode = 'month') },
  { id: 'editor-create', file: 'pages/editor/index', query: {} },
  { id: 'editor-done', file: 'pages/editor/index', query: { id: 'bk-5' } },
  { id: 'students', file: 'pages/students/index', query: {} },
  { id: 'student', file: 'pages/student/index', query: { id: 'st-1' } },
  { id: 'my', file: 'pages/my/index', query: {} },
  { id: 'login', file: 'pages/login/index', query: {} },
  {
    id: 'students-empty',
    file: 'pages/students/index',
    query: {},
    prep: db => {
      db.students = [];
    }
  },
  {
    id: 'my-empty',
    file: 'pages/my/index',
    query: {},
    prep: db => {
      db.bookings = [];
      db.reviews = [];
      db.packages = [];
      db.lesson_tx = [];
    }
  }
];

const topbarNodes = parseWxml(fs.readFileSync(path.join(ROOT, 'components/topbar/index.wxml'), 'utf8')).children;
const components = {
  topbar: { nodes: topbarNodes, data: { statusBar: 44, navH: 44, title: '', sub: '', back: false, compact: false } }
};

fs.mkdirSync(OUT, { recursive: true });
const appCss = loadCss(path.join(ROOT, 'app.wxss'));
const compCss = loadCss(path.join(ROOT, 'components/topbar/index.wxss'));

for (const page of PAGES) {
  const db = JSON.parse(JSON.stringify(seed()));
  if (page.prep) page.prep(db);
  freshStore(db);
  const dir = path.join(ROOT, page.file);
  const inst = instantiate(fs.readFileSync(`${dir}.js`, 'utf8'), page.query);
  if (page.after) {
    page.after(inst.data);
    if (inst.render) inst.render();
  }
  const nodes = parseWxml(fs.readFileSync(`${dir}.wxml`, 'utf8')).children;
  const out = [];
  renderChildren(nodes, inst.data, { components }, out);
  const css = [appCss, loadCss(`${dir}.wxss`), compCss].join('\n');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${page.id}</title>
<style>
  html,body{margin:0;padding:0;background:#f3f5f8}
  *{box-sizing:border-box}
  .wx-page{position:relative;min-height:100vh}
${css}
</style></head>
<body><div class="wx-page">${out.join('')}</div></body></html>`;
  fs.writeFileSync(path.join(OUT, `${page.id}.html`), html);
  console.log('rendered', page.id);
}

console.log('\n预览文件目录：', OUT);
