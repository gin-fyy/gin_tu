/**
 * 网页版静态自检：node tests/check-web.js
 * 1) JS 语法（www / _tools / tests）
 * 2) manifest.webmanifest 可解析且图标声明与实际文件一致
 * 3) index.html 里的相对引用都存在
 * 4) app.js 里 $('id') 引用的元素都在 index.html 里存在
 * 5) CSS 花括号配平；HTML/JS 用到的 class 是否在 CSS 里定义（仅提示）
 * 6) sw.js 的缓存清单文件都存在
 * 7) 图标 PNG 有效（签名 / 尺寸 / 有内容）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

let fail = 0;
let warn = 0;
const err = (m) => { fail++; console.log('✗ ' + m); };
const warnf = (m) => { warn++; console.log('! ' + m); };
const oklog = (m) => console.log('✓ ' + m);
const rel = (p) => path.relative(ROOT, p);

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach((name) => {
    if (name === 'node_modules' || name === '.git' || name === '.toolchain' || name === 'android' || name === '.gradle') return;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  });
  return out;
}

/* ---------- 1. JS 语法 ---------- */
const jsFiles = walk(ROOT, []).filter((f) => f.endsWith('.js'));
jsFiles.forEach((f) => {
  try {
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f });
  } catch (e) {
    err('JS 语法 ' + rel(f) + ' → ' + e.message);
  }
});
oklog('JS 语法检查完成（' + jsFiles.length + ' 个文件）');

/* ---------- 1.5 版本号一致性：core.js 的 APP_VERSION 必须等于 package.json 的 version ---------- */
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const core = fs.readFileSync(path.join(WWW, 'js', 'core.js'), 'utf8');
  const vm2 = core.match(/var APP_VERSION = '([^']+)'/);
  if (!vm2) err('core.js 里找不到 APP_VERSION');
  else if (vm2[1] !== pkg.version) err('版本号不一致：core.js=' + vm2[1] + '，package.json=' + pkg.version);
  else oklog('版本号一致：' + pkg.version);
} catch (e) {
  err('版本号一致性检查失败 → ' + e.message);
}

/* ---------- 2. manifest ---------- */
const manifestPath = path.join(WWW, 'manifest.webmanifest');
let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  oklog('manifest 可解析：' + manifest.name);
} catch (e) {
  err('manifest 解析失败 → ' + e.message);
}
if (manifest) {
  ['name', 'short_name', 'start_url', 'display', 'icons'].forEach((k) => {
    if (!manifest[k]) err('manifest 缺少字段 ' + k);
  });
  (manifest.icons || []).forEach((ic) => {
    const p = path.join(WWW, ic.src);
    if (!fs.existsSync(p)) {
      err('manifest 图标缺失 ' + ic.src);
      return;
    }
    const size = Number(String(ic.sizes).split('x')[0]);
    try {
      const info = pngInfo(p);
      if (info.w !== size || info.h !== size) err('图标尺寸不符 ' + ic.src + ' 声明 ' + ic.sizes + ' 实际 ' + info.w + 'x' + info.h);
      else oklog('图标 OK ' + ic.src + ' ' + info.w + 'x' + info.h + '，不透明像素 ' + info.opaque);
    } catch (e) {
      err('图标无效 ' + ic.src + ' → ' + e.message);
    }
  });
}

/* ---------- 3. index.html 引用 ---------- */
const htmlPath = path.join(WWW, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const refs = [];
const refRe = /(?:src|href)\s*=\s*"([^"]+)"/g;
let m;
while ((m = refRe.exec(html))) {
  const v = m[1];
  if (/^(https?:|data:|#|mailto:)/.test(v)) continue;
  refs.push(v);
}
refs.forEach((r) => {
  const p = path.join(WWW, r.split('?')[0]);
  if (!fs.existsSync(p)) err('index.html 引用了不存在的文件: ' + r);
});
oklog('index.html 相对引用检查完成（' + refs.length + ' 个）');

/* ---------- 4. app.js 元素 id ---------- */
const appJs = fs.readFileSync(path.join(WWW, 'js', 'app.js'), 'utf8');
const htmlIds = new Set();
const idRe = /id\s*=\s*"([^"]+)"/g;
while ((m = idRe.exec(html))) htmlIds.add(m[1]);
const usedIds = new Set();
const useRe = /\$\('([^']+)'\)/g;
while ((m = useRe.exec(appJs))) usedIds.add(m[1]);
const missingIds = Array.from(usedIds).filter((id) => !htmlIds.has(id));
if (missingIds.length) err('app.js 引用了 index.html 中不存在的 id: ' + missingIds.join(', '));
else oklog('app.js 的 ' + usedIds.size + ' 个元素 id 全部存在');

/* ---------- 5. CSS ---------- */
const cssPath = path.join(WWW, 'css', 'app.css');
const css = fs.readFileSync(cssPath, 'utf8');
const open = (css.match(/\{/g) || []).length;
const close = (css.match(/\}/g) || []).length;
if (open !== close) err('app.css 花括号不配平 ' + open + '/' + close);
else oklog('app.css 花括号配平（' + open + ' 条规则）');

const cssClasses = new Set();
const clsRe = /\.(-?[_a-zA-Z][\w-]*)/g;
while ((m = clsRe.exec(css))) cssClasses.add(m[1]);
const usedClasses = new Set();
const htmlClsRe = /class\s*=\s*"([^"]*)"/g;
while ((m = htmlClsRe.exec(html))) m[1].split(/\s+/).filter(Boolean).forEach((c) => usedClasses.add(c));
const jsClsRe = /class="([^"$]*)"/g;
while ((m = jsClsRe.exec(appJs))) {
  if (/['+()?:]/.test(m[1])) continue; // 动态拼接的类名（tcard + ' is-done' 之类）跳过
  m[1].split(/\s+/).filter(Boolean).forEach((c) => usedClasses.add(c));
}
const missingCls = Array.from(usedClasses).filter((c) => !cssClasses.has(c));
if (missingCls.length) warnf('以下 class 在 HTML/JS 用到但 CSS 未定义（可能是有意的工具类）: ' + missingCls.join(', '));
else oklog('CSS class 覆盖完整（' + usedClasses.size + ' 个）');

/* ---------- 6. sw.js 缓存清单 ---------- */
const sw = fs.readFileSync(path.join(WWW, 'sw.js'), 'utf8');
const assetsBlock = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!assetsBlock) {
  err('sw.js 里找不到 ASSETS 清单');
} else {
  const assets = (assetsBlock[1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, ''));
  assets.forEach((a) => {
    if (!fs.existsSync(path.join(WWW, a))) err('sw.js 缓存清单文件不存在: ' + a);
  });
  oklog('sw.js 缓存清单检查完成（' + assets.length + ' 个）');
}

/* ---------- 7. 其他图标 ---------- */
['apple-touch-icon.png', 'favicon.png'].forEach((name) => {
  const p = path.join(WWW, 'icons', name);
  if (!fs.existsSync(p)) { warnf('缺少 ' + name + '（运行 node _tools/gen-app-icons.js 生成）'); return; }
  try {
    const info = pngInfo(p);
    oklog(name + ' OK ' + info.w + 'x' + info.h + '，不透明像素 ' + info.opaque);
  } catch (e) {
    err(name + ' 无效 → ' + e.message);
  }
});

/* ---------- PNG 解析 ---------- */
function pngInfo(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('PNG 签名错误');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 6) throw new Error('应为 8bit RGBA');
  let idat = Buffer.alloc(0);
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idat = Buffer.concat([idat, buf.subarray(pos + 8, pos + 8 + len)]);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(idat);
  if (raw.length !== (w * 4 + 1) * h) throw new Error('IDAT 解压长度不符');
  let opaque = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (raw[y * (w * 4 + 1) + 1 + x * 4 + 3] > 200) opaque++;
    }
  }
  if (!opaque) throw new Error('图标全透明');
  return { w, h, opaque };
}

console.log('\n' + (fail ? '共 ' + fail + ' 个问题' : '静态检查全部通过 ✓') + (warn ? '（' + warn + ' 条提示）' : ''));
process.exit(fail ? 1 : 0);
