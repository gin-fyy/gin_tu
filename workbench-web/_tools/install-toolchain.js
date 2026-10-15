/**
 * 安装安卓构建工具链（纯 Node，零依赖）
 *   node _tools/install-toolchain.js
 *
 * 1) 下载并解压 JDK 21 (Temurin)            → .toolchain/jdk
 * 2) 下载并解压 Android cmdline-tools       → .toolchain/android-sdk/cmdline-tools/latest
 * 3) 接受许可并装 platform-tools / android-35 / build-tools 35.0.0
 *
 * 幂等：已经装好的步骤会自动跳过。全部装在项目内 .toolchain/，不污染系统。
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TC = path.join(ROOT, '.toolchain');
const JDK_DIR = path.join(TC, 'jdk');
const SDK_DIR = path.join(TC, 'android-sdk');

// 多个下载源按顺序尝试（实测 Adoptium 官方 API 在国内可能只有几十 KB/s）
const JDK_URLS = [
  ['Microsoft OpenJDK 21', 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip'],
  ['华为云 OpenJDK 21', 'https://mirrors.huaweicloud.com/openjdk/21.0.2/openjdk-21.0.2_windows-x64_bin.zip'],
  ['Adoptium Temurin 21', 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse']
];
const CMDLINE_URLS = [
  'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip',
  'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip'
];

function log(msg) { console.log(msg); }

/* ---------------- 下载 ---------------- */
function download(url, dest, redirects) {
  const depth = redirects || 0;
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'workbench-toolchain-installer' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (depth >= 5) return reject(new Error('重定向次数过多: ' + url));
        return download(res.headers.location, dest, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode + ' (' + url + ')'));
      }
      const total = Number(res.headers['content-length'] || 0);
      let got = 0;
      let lastPct = -10;
      const file = fs.createWriteStream(dest);
      res.on('data', (chunk) => {
        got += chunk.length;
        if (total) {
          const pct = Math.floor((got / total) * 100);
          if (pct >= lastPct + 20) {
            lastPct = pct;
            log('    ' + pct + '%  ' + (got / 1048576).toFixed(1) + '/' + (total / 1048576).toFixed(1) + ' MB');
          }
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('下载超时')));
  });
}

/* ---------------- 解压（纯 Node 解析 zip） ---------------- */
function unzip(zipPath, destDir, stripTopLevel) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  const minPos = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到 EOCD）');

  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  let written = 0;

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('中央目录损坏 @' + off);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;
    let relName = name;
    if (stripTopLevel) {
      const slash = name.indexOf('/');
      if (slash < 0) continue;
      relName = name.slice(slash + 1);
    }
    if (!relName) continue;

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);
    const out = method === 0 ? comp : zlib.inflateRawSync(comp);

    const target = path.join(destDir, relName);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, out);
    written++;
  }
  return written;
}

/* ---------------- 进程 ---------------- */
function makeEnv() {
  const env = Object.assign({}, process.env);
  delete env.Path;
  env.JAVA_HOME = JDK_DIR;
  env.ANDROID_HOME = SDK_DIR;
  env.ANDROID_SDK_ROOT = SDK_DIR;
  env.PATH = [
    path.join(JDK_DIR, 'bin'),
    path.join(SDK_DIR, 'platform-tools'),
    process.env.PATH || ''
  ].join(path.delimiter);
  return env;
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', shell: true }, opts || {}));
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(cmd + ' ' + args.join(' ') + ' 退出码 ' + r.status);
}

/* ---------------- 主流程 ---------------- */
(async function main() {
  fs.mkdirSync(TC, { recursive: true });

  /* 1. JDK */
  if (fs.existsSync(path.join(JDK_DIR, 'bin', 'java.exe'))) {
    log('[1/3] JDK 已存在，跳过');
  } else {
    log('[1/3] 下载 JDK 21 …');
    const zip = path.join(TC, 'jdk21.zip');
    let got = false;
    let lastErr = null;
    for (const [name, url] of JDK_URLS) {
      try {
        log('    源：' + name);
        await download(url, zip);
        got = true;
        break;
      } catch (e) {
        lastErr = e;
        log('    失败（' + e.message + '），换下一个源');
        try { fs.rmSync(zip, { force: true }); } catch (e2) { /* ignore */ }
      }
    }
    if (!got) throw lastErr || new Error('JDK 下载失败');
    log('    解压中 …');
    const tmp = path.join(TC, 'jdk-tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const n = unzip(zip, tmp, true);
    fs.rmSync(JDK_DIR, { recursive: true, force: true });
    const inner = fs.readdirSync(tmp);
    if (inner.length === 1 && fs.statSync(path.join(tmp, inner[0])).isDirectory()) {
      fs.renameSync(path.join(tmp, inner[0]), JDK_DIR);
    } else {
      fs.renameSync(tmp, JDK_DIR);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
    log('    JDK 就绪（' + n + ' 个文件）');
  }
  const env = makeEnv();
  log('    java 版本：');
  run('"' + path.join(JDK_DIR, 'bin', 'java.exe') + '"', ['-version'], { env: env });

  /* 2. cmdline-tools */
  const sdkmanager = path.join(SDK_DIR, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat');
  if (fs.existsSync(sdkmanager)) {
    log('[2/3] Android cmdline-tools 已存在，跳过');
  } else {
    log('[2/3] 下载 Android cmdline-tools …');
    let zip = null;
    let lastErr = null;
    for (const url of CMDLINE_URLS) {
      const target = path.join(TC, 'cmdline-tools.zip');
      try {
        await download(url, target);
        zip = target;
        break;
      } catch (e) {
        lastErr = e;
        log('    下载失败（' + e.message + '），换下一个地址');
      }
    }
    if (!zip) throw lastErr || new Error('cmdline-tools 下载失败');
    log('    解压中 …');
    const tmp = path.join(TC, 'cmdline-tmp');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    unzip(zip, tmp, false);
    const latest = path.join(SDK_DIR, 'cmdline-tools', 'latest');
    fs.rmSync(latest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(latest), { recursive: true });
    fs.renameSync(path.join(tmp, 'cmdline-tools'), latest);
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(zip, { force: true });
    log('    cmdline-tools 就绪');
  }

  /* 3. 许可 + 包 */
  if (fs.existsSync(path.join(SDK_DIR, 'platforms', 'android-35'))) {
    log('[3/3] Android SDK 包已存在，跳过');
  } else {
    log('[3/3] 接受许可并安装 platform-tools / android-35 / build-tools 35.0.0 …');
    const yes = 'y\r\n'.repeat(80);
    const lic = spawnSync(sdkmanager, ['--sdk_root=' + SDK_DIR, '--licenses'], {
      input: yes, env: env, shell: true, stdio: ['pipe', 'inherit', 'inherit']
    });
    if (lic.error) throw lic.error;
    run(sdkmanager, ['--sdk_root=' + SDK_DIR, 'platform-tools', 'platforms;android-35', 'build-tools;35.0.0'], { env: env });
  }

  log('\n✅ 工具链就绪');
  log('   JAVA_HOME   = ' + JDK_DIR);
  log('   ANDROID_HOME= ' + SDK_DIR);
  const platforms = fs.existsSync(path.join(SDK_DIR, 'platforms')) ? fs.readdirSync(path.join(SDK_DIR, 'platforms')) : [];
  const builds = fs.existsSync(path.join(SDK_DIR, 'build-tools')) ? fs.readdirSync(path.join(SDK_DIR, 'build-tools')) : [];
  log('   platforms   = ' + (platforms.join(', ') || '(无)'));
  log('   build-tools = ' + (builds.join(', ') || '(无)'));
  log('\n下一步：npm.cmd install  →  npm.cmd run apk');
})().catch((e) => {
  console.error('\n✗ 安装失败：' + (e && e.message));
  process.exit(1);
});
