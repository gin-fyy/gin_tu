/**
 * 零依赖本地静态服务器：给手机/同局域网设备用
 * 用法: node _tools/serve.js  (可选环境变量 PORT，默认 5173)
 *
 * 提供的地址：
 *   /                网页版（www/）
 *   /update/         安卓 APK 下载页（版本号、大小、构建时间、下载按钮）
 *   /update/version.json   APK 版本信息（App 内「检查更新」读这个）
 *   /update/<apk>     APK 文件本身
 *   /ota/latest.json  热更新（Web 资源 OTA）版本信息
 *   /ota/<zip>        OTA bundle
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = path.join(__dirname, '..');
const WWW = path.join(BASE, 'www');
const DIST = path.join(BASE, 'dist');
const OTA = path.join(DIST, 'ota');
const PORT = Number(process.env.PORT || 5173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8'
};

function safeJoin(root, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const target = path.join(root, clean);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

function sendText(res, code, text, type) {
  res.writeHead(code, { 'content-type': type || 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  res.end(text);
}

function sendFile(res, file, type) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      sendText(res, 404, '404 ' + path.basename(file));
      return;
    }
    res.writeHead(200, {
      'content-type': type || MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'content-length': buf.length,
      'cache-control': 'no-cache'
    });
    res.end(buf);
  });
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

function fmtSize(n) {
  if (!n) return '未知';
  return (n / 1048576).toFixed(2) + ' MB';
}

/* ---------------- 下载页 ---------------- */
function downloadPage() {
  const meta = readJson(path.join(DIST, 'version.json')) || {};
  const ota = readJson(path.join(OTA, 'latest.json')) || {};
  const apkName = meta.apk || 'workbench-debug.apk';
  const apkExists = fs.existsSync(path.join(DIST, apkName));
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>我的工作台 · 下载更新</title>
<style>
  body{margin:0;padding:24px 18px 60px;font:16px/1.6 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;background:#F5F6FA;color:#23272F}
  .wrap{max-width:520px;margin:0 auto}
  h1{font-size:20px;margin:8px 0 4px}
  .sub{color:#8A93A6;font-size:13px;margin-bottom:18px}
  .card{background:#fff;border-radius:14px;padding:18px;box-shadow:0 2px 12px rgba(31,41,55,.06);margin-bottom:14px}
  .row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #F2F3F7;font-size:14px}
  .row:last-child{border-bottom:none}
  .k{color:#8A93A6}
  .btn{display:block;text-align:center;background:#4C6EF5;color:#fff;text-decoration:none;border-radius:12px;padding:15px 0;font-weight:600;font-size:16px;margin-top:12px}
  .btn.ghost{background:#F0F2F7;color:#5B6472;font-weight:500;padding:12px 0;font-size:14px}
  .tip{font-size:13px;color:#8A93A6;line-height:1.7}
  ol{padding-left:20px;font-size:14px;color:#5B6472}
  li{margin:4px 0}
  code{background:#F2F3F7;border-radius:5px;padding:1px 5px;font-size:12px}
</style></head><body><div class="wrap">
  <h1>我的工作台 · 安卓版</h1>
  <div class="sub">装一次，之后 App 内就能检查更新</div>

  <div class="card">
    <div class="row"><span class="k">当前版本</span><span>${meta.version || '未知'}${meta.versionCode ? ' (' + meta.versionCode + ')' : ''}</span></div>
    <div class="row"><span class="k">构建时间</span><span>${meta.builtAt ? String(meta.builtAt).replace('T', ' ').slice(0, 19) : '未知'}</span></div>
    <div class="row"><span class="k">安装包大小</span><span>${fmtSize(meta.size)}</span></div>
    ${apkExists
      ? `<a class="btn" href="/update/${apkName}">下载 APK</a>`
      : `<div class="tip">还没有 APK：先在电脑上跑 <code>npm.cmd run apk</code></div>`}
  </div>

  <div class="card">
    <div class="tip"><b>安装步骤</b></div>
    <ol>
      <li>点上面的「下载 APK」（用手机浏览器打开本页）</li>
      <li>下载完点通知栏里的文件，或到「文件管理 → Download」点它</li>
      <li>系统问「是否允许安装未知应用」→ 允许 → 安装</li>
      <li>这是覆盖安装，<b>任务数据会保留</b>（不要先卸载）</li>
    </ol>
  </div>

  <div class="card">
    <div class="row"><span class="k">热更新（网页层）</span><span>${ota.version || '未配置'}</span></div>
    <div class="tip">页面、样式、逻辑这类改动可以走热更新，不用重新装 APK；改图标/权限/插件等原生部分仍需装新 APK。</div>
    ${ota.version ? `<a class="btn ghost" href="/ota/latest.json">查看热更新信息</a>` : ''}
  </div>
</div></body></html>`;
}

/* ---------------- 路由 ---------------- */
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/update' || url === '/update/') {
    sendText(res, 200, downloadPage(), 'text/html; charset=utf-8');
    return;
  }

  if (url === '/update/version.json') {
    const meta = readJson(path.join(DIST, 'version.json'));
    if (!meta) {
      sendText(res, 404, JSON.stringify({ error: '还没有 dist/version.json，先跑 npm.cmd run apk' }), 'application/json; charset=utf-8');
      return;
    }
    sendText(res, 200, JSON.stringify(meta, null, 2), 'application/json; charset=utf-8');
    return;
  }

  if (url.startsWith('/update/')) {
    const file = safeJoin(DIST, url.slice('/update'.length));
    if (!file || !/\.(apk|json)$/i.test(file)) {
      sendText(res, 403, 'forbidden');
      return;
    }
    sendFile(res, file);
    return;
  }

  if (url.startsWith('/ota/')) {
    const file = safeJoin(OTA, url.slice('/ota'.length));
    if (!file || !/\.(zip|json)$/i.test(file)) {
      sendText(res, 403, 'forbidden');
      return;
    }
    sendFile(res, file);
    return;
  }

  /* 其余走网页版 */
  let file = safeJoin(WWW, url === '/' ? '/index.html' : url);
  if (!file) {
    sendText(res, 403, 'forbidden');
    return;
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    sendFile(res, file);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const urls = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((n) => {
      if (n.family === 'IPv4' && !n.internal) urls.push('http://' + n.address + ':' + PORT);
    });
  });
  const meta = readJson(path.join(DIST, 'version.json'));
  console.log('我的工作台 已启动：');
  console.log('  网页版      http://localhost:' + PORT + '/');
  console.log('  下载更新页  http://localhost:' + PORT + '/update/');
  if (meta) console.log('  APK 版本    ' + meta.version + ' (' + meta.versionCode + ')，' + fmtSize(meta.size));
  else console.log('  APK 版本    （还没有 dist/version.json，先跑 npm.cmd run apk）');
  urls.forEach((u) => {
    console.log('  ---- 手机用（同一个 Wi-Fi）----');
    console.log('    网页版      ' + u + '/');
    console.log('    下载更新页  ' + u + '/update/');
  });
  console.log('  （Ctrl+C 停止；手机 App 里「我的 → 更新地址」填上面那个局域网地址）');
});
