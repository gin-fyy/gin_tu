/**
 * APK 产物自检：node _tools/inspect-apk.js [apk路径]
 * 默认检查 dist/workbench-debug.apk
 * 校验：zip 结构完整、必备条目齐全、网页资源确实打进了包、图标存在、体积合理
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const apkPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'dist', 'workbench-debug.apk');

let fail = 0;
const err = (m) => { fail++; console.log('✗ ' + m); };
const ok = (m) => console.log('✓ ' + m);

if (!fs.existsSync(apkPath)) {
  console.error('✗ 找不到 APK：' + apkPath + '（先跑 npm.cmd run apk）');
  process.exit(1);
}

const buf = fs.readFileSync(apkPath);
const sizeMB = (buf.length / 1048576).toFixed(1);
ok('APK 存在：' + apkPath + '  (' + sizeMB + ' MB)');

/* ---------- 解析 zip 中央目录 ---------- */
function readEntries(b) {
  let eocd = -1;
  const minPos = Math.max(0, b.length - 66000);
  for (let i = b.length - 22; i >= minPos; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('找不到 EOCD，可能不是 zip/APK');
  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const list = [];
  for (let i = 0; i < count; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) throw new Error('中央目录损坏 @' + off);
    const method = b.readUInt16LE(off + 10);
    const compSize = b.readUInt32LE(off + 20);
    const rawSize = b.readUInt32LE(off + 24);
    const nameLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    const localOff = b.readUInt32LE(off + 42);
    const name = b.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;
    list.push({ name, method, compSize, rawSize, localOff });
  }
  return list;
}

function extract(b, entry) {
  const lNameLen = b.readUInt16LE(entry.localOff + 26);
  const lExtraLen = b.readUInt16LE(entry.localOff + 28);
  const start = entry.localOff + 30 + lNameLen + lExtraLen;
  const comp = b.subarray(start, start + entry.compSize);
  return entry.method === 0 ? comp : zlib.inflateRawSync(comp);
}

let entries;
try {
  entries = readEntries(buf);
  ok('zip 结构可解析，条目数 ' + entries.length);
} catch (e) {
  err('zip 解析失败 → ' + e.message);
  process.exit(1);
}

const byName = new Map(entries.map((e) => [e.name, e]));
const has = (name) => byName.has(name);
const some = (re) => entries.filter((e) => re.test(e.name));

/* ---------- 必备条目 ---------- */
const required = [
  ['AndroidManifest.xml', 'Android 清单'],
  ['classes.dex', 'dex 字节码'],
  ['resources.arsc', '资源表'],
  ['assets/public/index.html', '网页入口'],
  ['assets/public/js/core.js', '核心逻辑'],
  ['assets/public/js/app.js', '界面层'],
  ['assets/public/css/app.css', '样式'],
  ['assets/public/manifest.webmanifest', 'PWA 清单']
];
required.forEach(([name, label]) => {
  if (has(name)) ok('包含 ' + label + '：' + name);
  else err('缺少 ' + label + '：' + name);
});

/* ---------- 图标 ---------- */
const icons = some(/^res\/mipmap[^/]*\/ic_launcher.*\.png$/);
if (icons.length) ok('应用图标 ' + icons.length + ' 个：' + icons.slice(0, 3).map((e) => e.name).join(', '));
else err('未找到 res/mipmap*/ic_launcher*.png（应用图标缺失）');

/* ---------- 签名 ---------- */
const sig = some(/^META-INF\/.*\.(RSA|DSA|EC|SF)$/);
if (sig.length) ok('已签名（debug）：' + sig.map((e) => e.name).join(', '));
else err('没有签名文件（META-INF/*.RSA|SF），装不上：请用 gradlew assembleDebug 或配置 signingConfig');

/* ---------- 网页资源内容抽查 ---------- */
const html = byName.get('assets/public/index.html');
if (html) {
  const text = extract(buf, html).toString('utf8');
  if (text.includes('我的工作台')) ok('index.html 内容正确（含应用标题）');
  else err('index.html 内容异常（找不到应用标题）');

  const missingRefs = [];
  const refRe = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let m;
  while ((m = refRe.exec(text))) {
    const v = m[1];
    if (/^(https?:|data:|#|mailto:)/.test(v)) continue;
    const target = 'assets/public/' + v.split('?')[0];
    if (!has(target)) missingRefs.push(v);
  }
  if (missingRefs.length) err('index.html 引用的资源没打进包：' + missingRefs.join(', '));
  else ok('index.html 引用的相对资源都已打包');
}

/* ---------- 插件（本地通知 + 热更新 + 浏览器） ---------- */
/* ---------- APK 里带的「当前版本」必须与 package.json 一致 ----------
   否则 App 会显示成旧版本，并反复提示更新同一版（www/version.json 必须在 cap sync 之前写入） */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const localVj = byName.get('assets/public/version.json');
if (!localVj) {
  err('APK 里没有 assets/public/version.json（App 无法得知自己是什么版本）');
} else {
  let lv = null;
  try { lv = JSON.parse(extract(buf, localVj).toString('utf8')); } catch (e) { lv = null; }
  if (!lv || !lv.version) {
    err('APK 内 www/version.json 解析失败');
  } else if (lv.version !== pkg.version) {
    err('APK 内 www/version.json 是 ' + lv.version + '，但 package.json 是 ' + pkg.version +
        ' → App 会显示成旧版本并反复提示更新（www/version.json 必须在 cap sync 之前写入）');
  } else {
    ok('APK 内版本信息正确：' + lv.version + ' (' + lv.versionCode + ')');
  }
}

const plugins = byName.get('assets/capacitor.plugins.json');
if (plugins) {
  const list = JSON.parse(extract(buf, plugins).toString('utf8'));
  const names = (list || []).map((p) => p.classpath || p.package || JSON.stringify(p));
  const all = JSON.stringify(names).toLowerCase();
  if (all.includes('localnotification')) {
    ok('已注册 LocalNotifications 插件（关掉 App 也能收到定时通知）');
  } else {
    err('capacitor.plugins.json 里没有 LocalNotifications：' + names.join(', '));
  }
  if (all.includes('capacitorupdater')) {
    ok('已注册 CapacitorUpdater 插件（支持网页层热更新，不用重装 APK）');
  } else {
    err('capacitor.plugins.json 里没有 CapacitorUpdater：' + names.join(', '));
  }
  if (all.includes('browser')) {
    ok('已注册 Browser 插件（App 内可调起系统浏览器下载新版 APK）');
  } else {
    console.log('! 没找到 Browser 插件（会用 window.open 兜底打开下载页）');
  }
  console.log('  （插件清单：' + names.length + ' 个）');
} else {
  console.log('! 没找到 assets/capacitor.plugins.json（无原生插件时正常）');
}

/* ---------- dex 里是否真有插件类（光有清单不算，代码得在包里） ---------- */
const dexEntries = entries.filter((e) => /^classes\d*\.dex$/.test(e.name));
if (!dexEntries.length) {
  err('APK 里没有 classes*.dex');
} else {
  const dexBlob = Buffer.concat(dexEntries.map((e) => extract(buf, e)));
  const wanted = [
    ['LocalNotifications（定时通知）', 'com/capacitorjs/plugins/localnotifications/LocalNotificationsPlugin'],
    ['CapacitorUpdater（热更新）', 'ee/forgr/capacitor_updater/CapacitorUpdaterPlugin'],
    ['Browser（打开下载页）', 'com/capacitorjs/plugins/browser/BrowserPlugin'],
    ['ApkInstaller（应用内更新）', 'com/workbench/apkinstaller/ApkInstallerPlugin'],
    ['FocusLock（专注屏幕固定）', 'com/workbench/focuslock/FocusLockPlugin']
  ];
  wanted.forEach(([label, needle]) => {
    if (dexBlob.indexOf(needle) >= 0) ok('dex 里包含 ' + label + ' 的插件类');
    else err('dex 里找不到 ' + label + ' 的插件类（' + needle + '）');
  });
  console.log('  （dex：' + dexEntries.map((e) => e.name + ' ' + (e.rawSize / 1024).toFixed(0) + 'KB').join('，') + '）');
}

/* ---------- 自更新权限与 FileProvider（AndroidManifest 是二进制 XML，按两种编码找字符串） ---------- */
const manifestEntry = byName.get('AndroidManifest.xml');
if (manifestEntry) {
  const man = extract(buf, manifestEntry);
  const hasIn = (s) => man.indexOf(Buffer.from(s, 'utf8')) >= 0 || man.indexOf(Buffer.from(s, 'utf16le')) >= 0;
  if (hasIn('android.permission.REQUEST_INSTALL_PACKAGES')) {
    ok('清单里有 REQUEST_INSTALL_PACKAGES（允许 App 内发起安装）');
  } else {
    err('清单里缺少 REQUEST_INSTALL_PACKAGES，应用内更新无法拉起安装器');
  }
  if (hasIn('apkinstaller')) {
    ok('清单里注册了 FileProvider（authority 以 .apkinstaller 结尾）');
  } else {
    err('清单里找不到 apkinstaller 的 FileProvider');
  }
  if (hasIn('largeHeap')) {
    ok('清单里开了 largeHeap（大图/自定义壁纸更从容）');
  } else {
    err('清单里没有 largeHeap（大壁纸可能更容易卡）');
  }
}

console.log('\n' + (fail ? '共 ' + fail + ' 个问题' : 'APK 自检通过 ✓'));
process.exit(fail ? 1 : 0);
