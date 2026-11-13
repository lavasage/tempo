/**
 * 结构检查：小程序没有类型检查，靠这组断言挡住「点了没反应」「文件缺失」这类低级错误。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = p => JSON.parse(read(p));

const app = json('app.json');

function pageFiles() {
  return app.pages.flatMap(p => ['.js', '.json', '.wxml', '.wxss'].map(ext => `${p}${ext}`));
}

function componentsOf(file) {
  const cfg = JSON.parse(read(file));
  return Object.values(cfg.usingComponents || {});
}

/** 粗略的标签配对检查：忽略自闭合标签与注释。 */
function unbalanced(xml) {
  const text = xml.replace(/<!--[\s\S]*?-->/g, '');
  const voidTags = new Set(['input', 'image', 'textarea', 'icon']);
  const stack = [];
  const re = /<\/?([\w:-]+)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(text))) {
    const whole = m[0];
    const name = m[1];
    if (whole.startsWith('</')) {
      if (voidTags.has(name)) continue;
      const open = stack.pop();
      if (open !== name) return `${open} 与 ${name} 未正确闭合`;
    } else if (!whole.endsWith('/>') && !voidTags.has(name)) {
      stack.push(name);
    }
  }
  return stack.length ? `未闭合：${stack.join(', ')}` : '';
}

describe('小程序结构', () => {
  it('app.json 声明的页面四件套齐全', () => {
    for (const file of pageFiles()) expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
  });

  it('所有 json 可解析', () => {
    const files = fs.readdirSync(ROOT, { recursive: true }).filter(f => String(f).endsWith('.json') && !String(f).includes('node_modules'));
    for (const f of files) expect(() => JSON.parse(fs.readFileSync(path.join(ROOT, String(f)), 'utf8')), String(f)).not.toThrow();
  });

  it('usingComponents 指向的文件存在', () => {
    for (const page of app.pages) {
      for (const comp of componentsOf(`${page}.json`)) {
        const base = path.join(ROOT, comp.replace(/^\//, ''));
        for (const ext of ['.js', '.json', '.wxml', '.wxss']) expect(fs.existsSync(base + ext), comp + ext).toBe(true);
      }
    }
  });

  it('WXML 标签闭合', () => {
    const files = [path.join('components/topbar/index.wxml'), ...app.pages.map(p => `${p}.wxml`)];
    for (const f of files) expect(unbalanced(read(f)), f).toBe('');
  });

  it('WXSS 花括号配平', () => {
    const files = ['app.wxss', 'components/topbar/index.wxss', ...app.pages.map(p => `${p}.wxss`)];
    for (const f of files) {
      const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
      const open = (css.match(/\{/g) || []).length;
      const close = (css.match(/\}/g) || []).length;
      expect(open, f).toBe(close);
    }
  });

  it('WXML 里绑定的事件处理函数都真实存在', () => {
    for (const page of app.pages) {
      const wxml = read(`${page}.wxml`);
      const js = read(`${page}.js`);
      const handlers = [...wxml.matchAll(/(?:bind|catch)[\w:]*="([A-Za-z_$][\w$]*)"/g)].map(m => m[1]);
      for (const h of new Set(handlers)) {
        expect(new RegExp(`\\b${h}\\s*\\(`).test(js), `${page} 缺少 ${h}`).toBe(true);
      }
    }
  });

  it('没有残留 Vue 语法或浏览器专有 API', () => {
    const pages = app.pages.flatMap(p => [`${p}.js`, `${p}.wxml`]);
    for (const f of pages) {
      const src = read(f);
      expect(/v-if=|v-for=|@click=|:class=/.test(src), f).toBe(false);
      expect(/\bdocument\.|\bwindow\.|localStorage/.test(src), f).toBe(false);
      expect(/crypto\.randomUUID/.test(src), f).toBe(false);
    }
  });

  it('页面 data 字段与 WXML 顶层引用一致（防止改成 undefined）', () => {
    // 只查页面标题这类关键字段，避免过度约束。
    for (const page of app.pages) {
      const wxml = read(`${page}.wxml`);
      const js = read(`${page}.js`);
      for (const field of ['title', 'mode', 'data']) {
        if (new RegExp(`\\{\\{\\s*${field}\\s*\\}\\}`).test(wxml)) {
          expect(new RegExp(`\\b${field}\\b`).test(js), `${page} 使用了 ${field}`).toBe(true);
        }
      }
    }
  });

  it('WXML 只用小程序内置组件或已声明组件', () => {
    // 微信不认 HTML 标签：写 <p> 会在真机上直接报「组件未找到」。
    const builtin = new Set([
      'view', 'text', 'image', 'input', 'textarea', 'button', 'picker', 'picker-view', 'picker-view-column',
      'scroll-view', 'swiper', 'swiper-item', 'navigator', 'icon', 'progress', 'slider', 'switch', 'radio',
      'radio-group', 'checkbox', 'checkbox-group', 'form', 'label', 'block', 'slot', 'template', 'import',
      'include', 'rich-text', 'video', 'audio', 'canvas', 'map', 'cover-view', 'cover-image', 'movable-area',
      'movable-view', 'open-data', 'web-view', 'editor', 'page-meta', 'navigation-bar'
    ]);
    const files = [path.join('components/topbar/index.wxml'), ...app.pages.map(p => `${p}.wxml`)];
    for (const f of files) {
      const declared = new Set(
        Object.keys(JSON.parse(read(f.replace(/\.wxml$/, '.json'))).usingComponents || {}).concat(['topbar'])
      );
      const src = read(f).replace(/<!--[\s\S]*?-->/g, '');
      for (const m of src.matchAll(/<([a-z][\w-]*)/g)) {
        const tag = m[1];
        expect(builtin.has(tag) || declared.has(tag), `${f} 使用了非小程序标签 <${tag}>`).toBe(true);
      }
    }
  });

  it('每个 wx:for 都带 wx:key', () => {
    // 缺 key 会在真机上项目重复或闪烁，编译器只给警告，容易被忽略。
    const files = [path.join('components/topbar/index.wxml'), ...app.pages.map(p => `${p}.wxml`)];
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/<([a-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)>/g)) {
        const attrs = m[2];
        if (!/wx:for=/.test(attrs)) continue;
        expect(/wx:key=/.test(attrs), `${f} 的 <${m[1]}> 缺少 wx:key`).toBe(true);
      }
    }
  });
});
