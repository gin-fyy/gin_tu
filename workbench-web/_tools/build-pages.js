/**
 * 生成 GitHub Pages 发布目录：node _tools/build-pages.js
 *
 *   docs/index.html           落地页（下载 App / 打开网页版）
 *   docs/app/**               网页版（www/ 的副本，可当在线版直接用）
 *   docs/update/version.json  更新信息（App 的「检查更新」读它）
 *   docs/update/<apk>         APK 本体
 *   docs/ota/latest.json      热更新信息（App 的「检查热更新」读它）
 *   docs/ota/www-*.zip        热更新 bundle
 *
 * 用法：npm.cmd run pages                       → 输出到 workbench-web/docs
 *      npm.cmd run pages -- --out ..\docs       → 输出到仓库根 docs（GitHub Pages 只认根目录的 /docs）
 * 然后 git push → 仓库 Settings → Pages → 选 main 分支 /docs 目录
 * 之后 App 的「更新地址」填：https://<用户名>.github.io/<仓库名>
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const DIST = path.join(ROOT, 'dist');
const outArg = process.argv.indexOf('--out');
const DOCS = outArg > -1 && process.argv[outArg + 1]
  ? path.resolve(process.argv[outArg + 1])
  : path.join(ROOT, 'docs');

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// Windows 上如果目标文件带「只读」属性（例如从只读目录拷过来的图片），
// copyFileSync 覆盖时会报 EPERM。这里统一先清只读位，必要时删掉再拷。
function forceCopy(s, d) {
  try {
    if (fs.existsSync(d)) fs.chmodSync(d, 0o666);
    fs.copyFileSync(s, d);
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') {
      fs.rmSync(d, { force: true, recursive: true });
      fs.copyFileSync(s, d);
      return;
    }
    throw e;
  }
}

// 顺手清掉源目录里的只读位，避免下次又踩同一个坑
function clearReadonly(dir) {
  try {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) clearReadonly(p);
      else { try { fs.chmodSync(p, 0o666); } catch (err) { /* ignore */ } }
    });
  } catch (err) { /* ignore */ }
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  fs.readdirSync(src, { withFileTypes: true }).forEach((e) => {
    if (e.name.startsWith('.')) return; // 隐藏文件不进 Pages
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else forceCopy(s, d);
  });
}
function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  forceCopy(src, dst);
}

clearReadonly(WWW);

/* 网页版 */
copyDir(WWW, path.join(DOCS, 'app'));

/* 更新信息 + APK */
let meta = null;
let apkName = 'workbench-debug.apk';
const updateDir = path.join(DOCS, 'update');
if (fs.existsSync(path.join(DIST, 'version.json'))) {
  meta = JSON.parse(fs.readFileSync(path.join(DIST, 'version.json'), 'utf8'));
  apkName = meta.apk || apkName;
  copyFile(path.join(DIST, 'version.json'), path.join(updateDir, 'version.json'));
  const apk = path.join(DIST, apkName);
  if (fs.existsSync(apk)) copyFile(apk, path.join(updateDir, apkName));
  else console.log('! 还没打 APK（npm.cmd run apk），docs/update 里暂时没有安装包');
  // 兼容旧链接：也放一份固定名（人手动下载用；App 只用带版本号的那个）
  const legacy = path.join(DIST, 'workbench-debug.apk');
  if (fs.existsSync(legacy)) copyFile(legacy, path.join(updateDir, 'workbench-debug.apk'));

  // 清理旧版本安装包：只留最近 3 个（每个 5~6MB，别让仓库无限变大）
  try {
    const keep = [apkName, 'workbench-debug.apk'];
    const olds = fs.readdirSync(updateDir)
      .filter((f) => /^workbench-\d/.test(f) && f.endsWith('.apk') && keep.indexOf(f) < 0)
      .map((f) => ({ f: f, t: fs.statSync(path.join(updateDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(2);
    olds.forEach((o) => { try { fs.rmSync(path.join(updateDir, o.f), { force: true }); console.log('  清理旧安装包：' + o.f); } catch (e) { /* ignore */ } });
  } catch (e) { /* ignore */ }
} else {
  console.log('! 找不到 dist/version.json，先跑 npm.cmd run apk');
}

/* 热更新 bundle */
const otaDir = path.join(DIST, 'ota');
let otaCount = 0;
if (fs.existsSync(otaDir)) {
  fs.readdirSync(otaDir).forEach((f) => {
    copyFile(path.join(otaDir, f), path.join(DOCS, 'ota', f));
    if (f.endsWith('.zip')) otaCount++;
  });
} else {
  console.log('! 还没生成热更新 bundle（npm.cmd run ota）');
}

/* 让 Pages 不要用 Jekyll 处理这些文件 */
fs.writeFileSync(path.join(DOCS, '.nojekyll'), '', 'utf8');

/* 落地页 */
const version = meta ? meta.version + ' (' + meta.versionCode + ')' : '未知';
const size = meta && meta.size ? (meta.size / 1048576).toFixed(2) + ' MB' : '—';
const builtAt = meta && meta.builtAt ? String(meta.builtAt).replace('T', ' ').slice(0, 19) : '—';
const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>我的工作台</title>
<style>
  body{margin:0;padding:28px 18px 60px;font:16px/1.65 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:#F5F6FA;color:#23272F}
  .wrap{max-width:520px;margin:0 auto}
  h1{font-size:22px;margin:6px 0 2px}
  .sub{color:#8A93A6;font-size:13px;margin-bottom:20px}
  .card{background:#fff;border-radius:14px;padding:18px;box-shadow:0 2px 12px rgba(31,41,55,.06);margin-bottom:14px}
  .row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #F2F3F7;font-size:14px}
  .row:last-child{border-bottom:none}
  .k{color:#8A93A6}
  .btn{display:block;text-align:center;background:#4C6EF5;color:#fff;text-decoration:none;border-radius:12px;padding:15px 0;font-weight:600;margin-top:14px}
  .btn.ghost{background:#F0F2F7;color:#5B6472;font-weight:500;padding:12px 0;font-size:15px}
  .tip{font-size:13px;color:#8A93A6;line-height:1.7}
  ol{padding-left:20px;font-size:14px;color:#5B6472;margin:8px 0 0}
  code{background:#F2F3F7;border-radius:5px;padding:1px 6px;font-size:12px;word-break:break-all}
</style></head><body><div class="wrap">
  <h1>我的工作台</h1>
  <div class="sub">任务管理 + 到期提醒 + 完成统计，数据存在你手机/浏览器本机</div>

  <div class="card">
    <div class="row"><span class="k">安卓版</span><span>${version}</span></div>
    <div class="row"><span class="k">构建时间</span><span>${builtAt}</span></div>
    <div class="row"><span class="k">安装包大小</span><span>${size}</span></div>
    <a class="btn" href="update/${apkName}">下载 Android 安装包（APK）</a>
    <a class="btn ghost" href="app/index.html">直接打开网页版</a>
  </div>

  <div class="card">
    <div class="tip"><b>安装步骤</b></div>
    <ol>
      <li>点上面的「下载 Android 安装包」</li>
      <li>下载完点通知栏的文件，或到「文件管理 → Download」点它</li>
      <li>系统问是否允许安装未知应用 → 允许 → 安装</li>
      <li>覆盖安装会保留数据（<b>不要先卸载</b>）</li>
    </ol>
  </div>

  <div class="card">
    <div class="tip"><b>App 里的「更新地址」填</b><br><code id="base"></code></div>
    <div class="tip" style="margin-top:8px">填好之后：点「检查更新」下载新 APK；点「检查热更新」只换网页层，不用重装。</div>
    <div class="row" style="margin-top:10px"><span class="k">热更新包数量</span><span>${otaCount}</span></div>
  </div>

  <script>
    // 更新地址就是这个站点的根目录
    document.getElementById('base').textContent = location.origin + location.pathname.replace(/\\/?$/, '');
  </script>
</div></body></html>`;
fs.writeFileSync(path.join(DOCS, 'index.html'), html, 'utf8');

const apkPath = path.join(DOCS, 'update', apkName);
console.log('✓ Pages 目录已生成：' + DOCS);
console.log('  落地页        docs/index.html');
console.log('  网页版        docs/app/index.html');
console.log('  更新信息      docs/update/version.json' + (fs.existsSync(apkPath) ? ' + ' + apkName + ' (' + (fs.statSync(apkPath).size / 1048576).toFixed(2) + ' MB)' : ''));
console.log('  热更新        docs/ota/latest.json' + (otaCount ? ' + ' + otaCount + ' 个 zip' : ''));
console.log('\n下一步：git push 后到仓库 Settings → Pages → Source 选「Deploy from a branch」→ 分支 main / 目录 /docs');
