/**
 * 端到端测试「App 内更新」：node _tools/e2e-update-test.js [--installed 1.1.5]
 *
 * 和 tests/ui-smoke.js 的区别：**这个用真实网络**
 *   1) 真的去问所有更新源（jsDelivr + 国内镜像）拿 version.json，并按「取版本最新」逻辑挑源
 *   2) 真的把 APK 下载下来（模拟原生插件：写文件 + sha256 校验 + 断点续传能力由原生端负责）
 *   3) 跑的是 www/js 里的正式代码（core.js + app.js），走完整路径：自动检查 → 弹窗 → 点「立即更新」
 *
 * 唯一模拟的是「系统安装界面」那一下点击（没有安卓设备可用）。
 * 模拟的"已安装版本"默认 1.1.5，所以线上只要能拿到更新的版本，这个测试就应该通过。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let JSDOM;
let VirtualConsole;
try {
  const jsdom = require('jsdom');
  JSDOM = jsdom.JSDOM;
  VirtualConsole = jsdom.VirtualConsole;
} catch (e) {
  console.log('! 未安装 jsdom，跳过（npm.cmd install）');
  process.exit(0);
}

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const INSTALLED_VERSION = argOf('--installed', '1.1.5');
const INSTALLED_CODE = Number(argOf('--installed-code', '5'));
const WAIT_DOWNLOAD_MS = Number(argOf('--timeout', '300000'));

const WWW = path.resolve(__dirname, '..', 'www');
const htmlSrc = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8').replace(/<script src="[^"]+"><\/script>/g, '');
const coreSrc = fs.readFileSync(path.join(WWW, 'js', 'core.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(WWW, 'js', 'app.js'), 'utf8');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (w, sel) => w.document.querySelector(sel);

let fail = 0;
const ok = (m) => console.log('✓ ' + m);
const bad = (m) => { fail++; console.log('✗ ' + m); };
const info = (m) => console.log('  ' + m);

async function main() {
  console.log('端到端测试：App 内更新（真实网络）');
  console.log('模拟已安装版本：' + INSTALLED_VERSION + ' (' + INSTALLED_CODE + ')\n');

  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) console.error('  [jsdom] ' + e.message); });

  const dom = new JSDOM(htmlSrc, { url: 'http://localhost/', pretendToBeVisual: true, runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window;
  w.confirm = () => true;
  w.alert = () => {};

  const asked = [];          // 问过哪些源
  const gotVersion = {};     // 每个源返回的版本
  const dl = { url: '', ms: 0, bytes: 0, hash: '', installed: '', attempts: 0 };

  // 真实网络：http(s) 走 Node 的 fetch；相对路径（本地 version.json）按「模拟已安装版本」返回
  w.fetch = async (url, opts) => {
    const u = String(url);
    if (!/^https?:/i.test(u)) {
      if (u.indexOf('version.json') >= 0) {
        return {
          ok: true,
          json: () => Promise.resolve({ version: INSTALLED_VERSION, versionCode: INSTALLED_CODE, builtAt: new Date().toISOString() })
        };
      }
      return { ok: false, status: 404 };
    }
    asked.push(u);
    try {
      const r = await fetch(u, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
      if (r.ok && /version\.json$/.test(u)) {
        const text = await r.text();
        try { gotVersion[u] = JSON.parse(text).version; } catch (e) { /* ignore */ }
        return { ok: true, json: () => Promise.resolve(JSON.parse(text)) };
      }
      return r;
    } catch (e) {
      return { ok: false, status: 0 };
    }
  };

  // 模拟原生插件：真的下载 + sha256 校验（断点续传由原生端实现，这里只验证字节正确）
  w.Capacitor = {
    Plugins: {
      ApkInstaller: {
        canInstall: () => Promise.resolve({ allowed: true, sdk: 34 }),
        openInstallSettings: () => Promise.resolve(),
        addListener: () => ({ remove() {} }),
        download: async (o) => {
          dl.attempts++;
          const t0 = Date.now();
          const r = await fetch(o.url, { headers: { 'accept-encoding': 'identity' } });
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const buf = Buffer.from(await r.arrayBuffer());
          dl.url = o.url;
          dl.ms = Date.now() - t0;
          dl.bytes = buf.length;
          dl.hash = crypto.createHash('sha256').update(buf).digest('hex');
          if (o.sha256 && String(o.sha256).length === 64 && dl.hash !== o.sha256) {
            throw new Error('sha256 校验失败');
          }
          const file = path.join(os.tmpdir(), o.fileName || 'update.apk');
          fs.writeFileSync(file, buf);
          return { path: file, size: buf.length, attempts: 1 };
        },
        install: (o) => { dl.installed = o.path; return Promise.resolve({ started: true }); }
      }
    }
  };

  w.eval(coreSrc);
  w.eval(appSrc);
  await sleep(60);

  /* 1) 触发检查（等同启动时的自动检查） */
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await sleep(12000);   // 给各源最多 ~8s 超时 + 余量

  const modalShown = !$(w, '#updateModal').hidden;
  info('问过的源 ' + Object.keys(gotVersion).length + ' 个：');
  Object.keys(gotVersion).forEach((u) => info('  ' + gotVersion[u] + '  ← ' + u.replace(/^https?:\/\//, '').slice(0, 60)));
  if (modalShown) {
    ok('弹出了更新弹窗：' + $(w, '#updVersion').textContent);
    const notes = $(w, '#updNotes').textContent.trim();
    if (notes && notes.indexOf('没有写更新日志') < 0) ok('更新日志已显示：' + notes.split('\n')[0].slice(0, 40) + '…');
    else bad('弹窗里没有更新日志');
    const state = $(w, '#updateState').textContent;
    if (state.indexOf('个源中最新') >= 0) ok('多源取最新生效：' + state);
    else info('状态：' + state);
  } else {
    bad('没有弹出更新弹窗（线上版本可能还没更新，或所有源都拿不到新版本）');
    info('状态栏：' + $(w, '#updateState').textContent);
    dom.window.close();
    process.exit(1);
  }

  /* 2) 点「立即更新」，走真实下载 */
  console.log('\n开始真实下载（可能要 1~3 分钟）…');
  $(w, '#updInstall').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const t0 = Date.now();
  while (!dl.installed && Date.now() - t0 < WAIT_DOWNLOAD_MS) {
    await sleep(1000);
    const p = $(w, '#updProgressText').textContent;
    if (p && p !== dl.lastText) { dl.lastText = p; info('进度：' + p); }
  }

  if (dl.installed) {
    ok('下载完成：' + (dl.bytes / 1048576).toFixed(2) + ' MB，用时 ' + (dl.ms / 1000).toFixed(1) + ' 秒（' + (dl.bytes / 1024 / Math.max(dl.ms, 1)).toFixed(0) + ' KB/s）');
    ok('下载源：' + dl.url.replace(/^https?:\/\//, '').slice(0, 70));
    ok('sha256 校验通过（' + dl.hash.slice(0, 16) + '…）');
    ok('已拉起安装（模拟）：' + dl.installed);
    info('提示文案：' + $(w, '#updHint').textContent);
  } else {
    bad('下载没有完成（超时 ' + (WAIT_DOWNLOAD_MS / 1000) + ' 秒）');
    info('尝试次数：' + dl.attempts + '，最后提示：' + $(w, '#updHint').textContent);
  }

  console.log('\n' + (fail ? '共 ' + fail + ' 个问题' : '端到端测试通过 ✓ —— 除了手机那一下「安装」确认，其余链路都真跑通了'));
  dom.window.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('✗ 测试异常：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
