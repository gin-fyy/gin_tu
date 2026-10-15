/**
 * 生成「热更新」bundle（Web 资源 OTA）：node _tools/build-ota.js
 *
 *   dist/ota/www-<version>.zip   根目录直接是 index.html（Capacitor Updater 的要求）
 *   dist/ota/latest.json         { version, url, checksum, size, builtAt }
 *
 * 手机 App（已装好带 updater 插件的 APK）里：我的 → 检查热更新 → 下载并应用，不用重装 APK。
 * 注意：bundle 里不能有隐藏文件、不能加密；本脚本会跳过 . 开头的文件和 version.json。
 *
 * 可选：--base http://192.168.1.5:5173   写进 latest.json 的下载地址前缀
 *      （默认 http://localhost:5173；App 端会把 localhost 换成它自己配置的更新地址）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');
const OUT_DIR = path.join(ROOT, 'dist', 'ota');

const baseArg = process.argv.indexOf('--base');
const BASE = (baseArg > -1 ? process.argv[baseArg + 1] : '') || 'http://localhost:5173';

/* 不放进 bundle 的文件：version.json 是「原生 App 版本」，热更新后仍应读 APK 里那份 */
const SKIP = new Set(['version.json']);

/* ---------------- CRC32 ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ---------------- 收集文件 ---------------- */
function collect(dir, prefix, out) {
  fs.readdirSync(dir).forEach((name) => {
    if (name.startsWith('.')) return;              // 隐藏文件会让插件解包失败
    const full = path.join(dir, name);
    const rel = prefix ? prefix + '/' + name : name;
    const st = fs.statSync(full);
    if (st.isDirectory()) collect(full, rel, out);
    else if (!SKIP.has(rel)) out.push({ name: rel, data: fs.readFileSync(full) });
  });
  return out;
}

/* ---------------- 写 zip（store/deflate 自实现，零依赖） ---------------- */
function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((f) => {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(f.data, { level: 9 });
    const crc = crc32(f.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // version needed
    local.writeUInt16LE(0x0800, 6);    // flag: UTF-8 文件名
    local.writeUInt16LE(8, 8);         // deflate
    local.writeUInt16LE(0, 10);        // time
    local.writeUInt16LE(0x2821, 12);   // date（固定值，产物可复现）
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, comp);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x2821, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(f.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(offset, 42);
    centralParts.push(cen, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  });

  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([Buffer.concat(localParts), central, eocd]);
}

/* ---------------- 读回校验 ---------------- */
function verifyZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('找不到 EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('中央目录损坏');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const rawSize = buf.readUInt32LE(off + 24);
    const crc = buf.readUInt32LE(off + 16);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;

    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(start, start + compSize);
    const data = method === 0 ? comp : zlib.inflateRawSync(comp);
    if (data.length !== rawSize) throw new Error(name + ' 解压长度不符');
    if (crc32(data) !== crc) throw new Error(name + ' CRC 校验失败');
    names.push(name);
  }
  return names;
}

/* ---------------- 主流程 ---------------- */
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
const version = pkg.version + '-' + stamp;   // 每次构建都是新版本号，插件才会升级
const zipName = 'www-' + version + '.zip';

const files = collect(WWW, '', []);
if (!files.some((f) => f.name === 'index.html')) {
  console.error('✗ www/index.html 不存在，无法打包');
  process.exit(1);
}

const zip = makeZip(files);
const names = verifyZip(zip);
if (!names.includes('index.html')) {
  console.error('✗ 校验失败：zip 根目录缺少 index.html');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, zipName), zip);

const sha256 = require('crypto').createHash('sha256').update(zip).digest('hex');
const latest = {
  version: version,
  url: BASE.replace(/\/+$/, '') + '/ota/' + zipName,
  checksum: sha256,
  size: zip.length,
  files: names.length,
  builtAt: new Date().toISOString()
};
fs.writeFileSync(path.join(OUT_DIR, 'latest.json'), JSON.stringify(latest, null, 2), 'utf8');

console.log('✓ 热更新 bundle 已生成');
console.log('  文件：' + path.join('dist', 'ota', zipName) + '  (' + (zip.length / 1024).toFixed(1) + ' KB，' + names.length + ' 个文件)');
console.log('  版本：' + version);
console.log('  地址：' + latest.url);
console.log('  （校验：zip 结构 + CRC + index.html 均在读回时验证通过）');
console.log('\n手机 App 里：我的 → 填更新地址（serve.js 打印的局域网地址）→ 检查热更新');
