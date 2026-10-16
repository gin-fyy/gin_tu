/**
 * 验证「App 内更新」链路：node _tools/verify-update-flow.js [--base https://…]
 *
 * 它用真实的 www/js/core.js 逻辑，模拟一个「旧版客户端」去读线上 version.json：
 *   1) 线上版本信息与更新日志能不能读到
 *   2) 旧版客户端会不会判定为「有更新」
 *   3) 安装包能不能下载（range 请求）
 *   4) 线上声明的 sha256 与本地 docs/update 里的包是否一致
 *
 * 手机上真正走一遍（弹窗 → 立即更新 → 系统安装）还是需要你点一下。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const WB = require(path.join(__dirname, '..', 'www', 'js', 'core.js'));

const baseArg = process.argv.indexOf('--base');
const BASES = (baseArg > -1 && process.argv[baseArg + 1])
  ? WB.update.parseBases(process.argv[baseArg + 1])
  : WB.update.parseBases(WB.DEFAULT_UPDATE_BASE);
const CLIENT = { version: '1.1.3', versionCode: 3 };   // 模拟「已经装好 1.1.3 的手机」

let fail = 0;
const ok = (m) => console.log('✓ ' + m);
const bad = (m) => { fail++; console.log('✗ ' + m); };

function get(url, opts, depth) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, Object.assign({ headers: { 'user-agent': 'workbench-verify' } }, opts || {}), (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if ((depth || 0) >= 5) return reject(new Error('重定向过多'));
        return get(new URL(res.headers.location, url).toString(), opts, (depth || 0) + 1).then(resolve, reject);
      }
      let bytes = 0;
      const chunks = [];
      res.on('data', (c) => { bytes += c.length; chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, bytes: bytes, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(new Error('超时')); });
  });
}

(async function main() {
  console.log('模拟客户端：' + CLIENT.version + ' (' + CLIENT.versionCode + ')');
  console.log('要核对的更新源 ' + BASES.length + ' 个\n');

  /* 1) 逐个源读 version.json，然后按 App 的规则取「版本最新的那个」 */
  const alive = [];
  for (const b of BASES) {
    const name = b.replace(/^https?:\/\//, '').slice(0, 46);
    try {
      const vr = await get(b.replace(/\/+$/, '') + '/update/version.json', { headers: { 'cache-control': 'no-cache' } });
      if (vr.status !== 200) { bad(name + ' → HTTP ' + vr.status); continue; }
      const remote = JSON.parse(vr.body.toString('utf8'));
      alive.push({ base: b, remote: remote });
      console.log('  ' + String(remote.version).padEnd(8) + ' ← ' + name);
    } catch (e) {
      console.log('  (连不上) ← ' + name + '  ' + (e.message || e));
    }
  }
  if (!alive.length) {
    bad('所有源都读不到 version.json');
    process.exit(1);
  }
  const best = WB.update.pickNewest(alive);
  const remote = best.remote;
  ok('可用源 ' + alive.length + ' 个；App 会取最新的：' + remote.version + ' (' + remote.versionCode + ') ← ' + best.base.replace(/^https?:\/\//, '').slice(0, 40));

  /* 1b) 这个「最新版本」必须等于我刚发布的（本地 docs/update/version.json） */
  const localPublished = path.join(__dirname, '..', '..', 'docs', 'update', 'version.json');
  if (fs.existsSync(localPublished)) {
    const local = JSON.parse(fs.readFileSync(localPublished, 'utf8'));
    if (local.version === remote.version) ok('线上最新版本 == 刚发布的版本（' + local.version + '）');
    else bad('线上最新是 ' + remote.version + '，但本地发布目录是 ' + local.version + ' → docs/ 没同步上去（发布步骤失败过）');
  }

  /* 2) 更新日志 */
  const notes = WB.update.notesOf(remote);
  if (notes.length) {
    ok('更新日志 ' + notes.length + ' 条：');
    notes.forEach((n) => console.log('    · ' + n));
  } else {
    bad('线上 version.json 里没有更新日志（notes 为空），手机上的弹窗会是空的');
  }

  /* 3) 旧版客户端会不会看到更新 */
  const res = WB.update.evaluate(CLIENT, remote, best.base);
  if (res.hasUpdate) ok('客户端判定：有更新 → ' + res.latestVersion + '（' + CLIENT.version + ' → ' + res.latestVersion + '）');
  else bad('客户端判定：没有更新（弹窗不会出现）→ 检查 versionCode 是否真的变大了');
  if (res.apkUrl && res.apkUrl.indexOf('http') === 0) ok('安装包地址：' + res.apkUrl);
  else bad('安装包地址拼接不对：' + res.apkUrl);

  /* 4) 安装包可下载 */
  try {
    const ar = await get(res.apkUrl, { headers: { range: 'bytes=0-1023' } });
    if (ar.status === 206 || ar.status === 200) ok('安装包可下载（HTTP ' + ar.status + '，探测到 ' + ar.bytes + ' 字节）');
    else bad('安装包下载失败：HTTP ' + ar.status);
  } catch (e) {
    bad('安装包下载出错：' + e.message);
  }

  /* 5) 线上声明的 sha256 与本地发布目录里的包一致（发布目录可能在 workbench-web/docs，也可能在仓库根 docs） */
  const apkName = remote.apk || 'workbench-debug.apk';
  const candidates = [
    path.join(__dirname, '..', 'docs', 'update', apkName),
    path.join(__dirname, '..', '..', 'docs', 'update', apkName)
  ];
  const local = candidates.find((p) => fs.existsSync(p));
  if (local) {
    const h = crypto.createHash('sha256').update(fs.readFileSync(local)).digest('hex');
    if (h === remote.sha256) ok('线上声明的 sha256 与本地发布包一致（' + h.slice(0, 16) + '…）');
    else bad('sha256 不一致：本地 ' + h.slice(0, 16) + '… ≠ 线上 ' + String(remote.sha256).slice(0, 16) + '…');
  } else {
    console.log('! 本地没找到发布用的 ' + apkName + '，跳过哈希比对（先跑 npm.cmd run pages -- --out ..\\docs）');
  }

  console.log('\n' + (fail ? '共 ' + fail + ' 个问题' : '链路自检通过 ✓ —— 手机端弹窗与更新所需的数据都就绪'));
  console.log('（手机上实际点一次「立即更新」还是要靠你：App 内下载 → 系统安装界面 → 点安装）');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('✗ 验证失败：' + (e && e.message));
  process.exit(1);
});
