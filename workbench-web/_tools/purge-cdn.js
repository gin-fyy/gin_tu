/**
 * 刷新 jsDelivr CDN 缓存：node _tools/purge-cdn.js
 *
 * 为什么需要：jsDelivr 对分支引用（@main）会缓存文件，
 * 发新版本后如果手机还看到旧版本号，跑一下这个就会立刻刷新。
 * （用完整 commit hash 或 tag 做地址则没有这个问题，但地址要跟着变。）
 *
 * 用法：npm.cmd run purge
 */
const https = require('https');
const { spawnSync } = require('child_process');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const GIT = path.join(REPO_ROOT, '.git-toolchain', 'git', 'cmd', 'git.exe');

/* 从 origin 里推出 owner/repo，取不到就用默认值 */
let slug = 'gin-fyy/gin_tu';
try {
  const r = spawnSync(GIT, ['remote', 'get-url', 'origin'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const m = String(r.stdout || '').trim().match(/github\.com[/:]([^/]+)\/(.+?)(\.git)?$/);
  if (m) slug = m[1] + '/' + m[2];
} catch (e) { /* 用默认值 */ }

const REF = process.env.CDN_REF || 'main';
const PATHS = [
  'docs/index.html',
  'docs/update/version.json',
  'docs/update/workbench-debug.apk',
  'docs/ota/latest.json'
];

function purge(p) {
  const url = 'https://purge.jsdelivr.net/gh/' + slug + '@' + REF + '/' + p;
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'user-agent': 'workbench-purge' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ p, code: res.statusCode, body: body.slice(0, 200) }));
    });
    req.on('error', (e) => resolve({ p, code: 0, body: e.message }));
    req.setTimeout(20000, () => { req.destroy(); resolve({ p, code: 0, body: '超时' }); });
  });
}

(async function main() {
  console.log('刷新 jsDelivr 缓存：' + slug + '@' + REF);
  for (const p of PATHS) {
    const r = await purge(p);
    const ok = r.code >= 200 && r.code < 300;
    console.log((ok ? '✓ ' : '✗ ') + p + '  (HTTP ' + r.code + ')' + (ok ? '' : '  ' + r.body));
  }
  console.log('\n手机 App 的「更新地址」填：https://cdn.jsdelivr.net/gh/' + slug + '@' + REF + '/docs');
})().catch((e) => {
  console.error('✗ 刷新失败：' + (e && e.message));
  process.exit(1);
});
