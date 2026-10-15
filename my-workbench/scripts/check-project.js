/**
 * 小程序静态自检（零依赖）：node scripts/check-project.js
 * 1) JS 语法  2) JSON 可解析  3) WXML 标签配平  4) WXSS 花括号配平
 * 5) app.json 的页面/图标齐全  6) usingComponents 组件文件齐全
 * 7) require 目标存在（跳过 Node 内置模块）  8) tabBar 项数合法（2~5）
 * 退出码 0 = 全部通过。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { builtinModules } = require('module');

const ROOT = path.resolve(__dirname, '..');
const BUILTINS = new Set(
  builtinModules.concat(builtinModules.map(m => 'node:' + m))
);

function walk(dir, out) {
  fs.readdirSync(dir).forEach(name => {
    if (name === 'node_modules' || name === '.git') return;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  });
  return out;
}

const files = walk(ROOT, []);
let fail = 0;
const err = (msg) => { fail++; console.log('✗ ' + msg); };
const rel = (f) => path.relative(ROOT, f);

/* 1. JS 语法 */
files.filter(f => f.endsWith('.js')).forEach(f => {
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f });
    console.log('JS   OK  ' + rel(f));
  } catch (e) {
    err('JS   ' + rel(f) + ' → ' + e.message);
  }
});

/* 2. JSON 解析 */
files.filter(f => f.endsWith('.json')).forEach(f => {
  try {
    JSON.parse(fs.readFileSync(f, 'utf8'));
    console.log('JSON OK  ' + rel(f));
  } catch (e) {
    err('JSON ' + rel(f) + ' → ' + e.message);
  }
});

/* 3. WXML 标签配平 */
files.filter(f => f.endsWith('.wxml')).forEach(f => {
  const s = fs.readFileSync(f, 'utf8');
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\/?)>/g;
  const stack = [];
  let m, ok = true;
  while ((m = re.exec(s))) {
    const closing = m[1] === '/';
    const tag = m[2];
    const self = m[4] === '/';
    if (self) continue;
    if (closing) {
      const top = stack.pop();
      if (top !== tag) {
        err('WXML ' + rel(f) + ' → </' + tag + '> 与 <' + top + '> 不配对');
        ok = false;
        break;
      }
    } else {
      stack.push(tag);
    }
  }
  if (ok && stack.length) {
    err('WXML ' + rel(f) + ' → 未闭合: ' + stack.join(','));
    ok = false;
  }
  if (ok) console.log('WXML OK  ' + rel(f));
});

/* 4. WXSS 花括号配平 */
files.filter(f => f.endsWith('.wxss')).forEach(f => {
  const s = fs.readFileSync(f, 'utf8');
  const open = (s.match(/\{/g) || []).length;
  const close = (s.match(/\}/g) || []).length;
  if (open !== close) err('WXSS ' + rel(f) + ' → 花括号不配平 ' + open + '/' + close);
  else console.log('WXSS OK  ' + rel(f));
});

/* 5. app.json 引用的页面与图标存在 + tabBar 项数 */
const appJsonPath = path.join(ROOT, 'app.json');
const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
appJson.pages.forEach(p => {
  ['.js', '.wxml', '.wxss', '.json'].forEach(ext => {
    if (!fs.existsSync(path.join(ROOT, p + ext))) err('页面缺文件: ' + p + ext);
  });
});
appJson.pages.forEach(p => {
  if (!fs.existsSync(path.join(ROOT, p + '.js'))) return;
  console.log('PAGE OK  ' + p);
});
const tabs = (appJson.tabBar && appJson.tabBar.list) || [];
if (tabs.length < 2 || tabs.length > 5) err('tabBar 项数应为 2~5，实际 ' + tabs.length);
tabs.forEach(t => {
  [t.iconPath, t.selectedIconPath].forEach(p => {
    if (p && !fs.existsSync(path.join(ROOT, p))) err('tabBar 图标缺失: ' + p);
  });
  if (appJson.pages.indexOf(t.pagePath) < 0) err('tabBar 页面未在 pages 注册: ' + t.pagePath);
});

/* 6. 页面/组件 usingComponents 路径存在 */
files.filter(f => f.endsWith('.json')).forEach(f => {
  let conf;
  try { conf = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return; }
  const uc = conf.usingComponents || {};
  Object.keys(uc).forEach(k => {
    const target = uc[k].startsWith('/')
      ? path.join(ROOT, uc[k])
      : path.resolve(path.dirname(f), uc[k]);
    ['.js', '.wxml', '.wxss', '.json'].forEach(ext => {
      if (!fs.existsSync(target + ext)) err('组件缺文件: ' + uc[k] + ext + ' (于 ' + rel(f) + ')');
    });
  });
});

/* 7. require 路径存在（跳过 Node 内置模块） */
files.filter(f => f.endsWith('.js')).forEach(f => {
  const s = fs.readFileSync(f, 'utf8');
  const re = /require\((['"])([^'"]+)\1\)/g;
  let m;
  while ((m = re.exec(s))) {
    const spec = m[2];
    if (BUILTINS.has(spec)) continue;
    let target = spec.startsWith('.')
      ? path.resolve(path.dirname(f), spec)
      : spec;
    if (!target.endsWith('.js')) target += '.js';
    if (!fs.existsSync(target)) err('require 目标缺失: ' + spec + ' (于 ' + rel(f) + ')');
  }
});
console.log('REQUIRE OK  (已跳过 Node 内置模块)');

console.log(fail ? '\n共 ' + fail + ' 个问题' : '\n全部校验通过 ✓');
process.exit(fail ? 1 : 0);
