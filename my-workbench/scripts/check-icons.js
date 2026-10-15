/**
 * 图标自检：解码 PNG 验证 tabBar 图标尺寸/颜色/覆盖率/居中度
 * 用法：node scripts/check-icons.js
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'images', 'tab');
const FILES = [
  ['dashboard.png', [154, 163, 178]],
  ['dashboard-active.png', [76, 110, 245]],
  ['tasks.png', [154, 163, 178]],
  ['tasks-active.png', [76, 110, 245]],
  ['stats.png', [154, 163, 178]],
  ['stats-active.png', [76, 110, 245]],
  ['mine.png', [154, 163, 178]],
  ['mine-active.png', [76, 110, 245]]
];

function decode(file) {
  const buf = fs.readFileSync(path.join(DIR, file));
  const sig = buf.subarray(0, 8).toString('hex');
  if (sig !== '89504e470d0a1a0a') throw new Error(file + ': PNG 签名错误');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 6) throw new Error(file + ': 应为 8bit RGBA');
  if (w !== 81 || h !== 81) throw new Error(file + ': 尺寸应为 81x81，实际 ' + w + 'x' + h);
  // 拼接所有 IDAT
  let idat = Buffer.alloc(0);
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (type === 'IDAT') idat = Buffer.concat([idat, buf.subarray(pos + 8, pos + 8 + len)]);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(idat);
  if (raw.length !== (81 * 4 + 1) * 81) throw new Error(file + ': IDAT 解压长度不符');
  const px = Buffer.alloc(81 * 81 * 4);
  for (let y = 0; y < 81; y++) {
    if (raw[y * (81 * 4 + 1)] !== 0) throw new Error(file + ': 滤波器类型应为 0');
    raw.copy(px, y * 81 * 4, y * (81 * 4 + 1) + 1, (y + 1) * (81 * 4 + 1));
  }
  return px;
}

let fail = 0;
FILES.forEach(([file, color]) => {
  if (!fs.existsSync(path.join(DIR, file))) {
    fail++;
    console.log('✗ ' + file + ' 缺失');
    return;
  }
  const px = decode(file);
  let opaque = 0, minX = 81, maxX = 0, minY = 81, maxY = 0, colorOk = true;
  for (let y = 0; y < 81; y++) {
    for (let x = 0; x < 81; x++) {
      const o = (y * 81 + x) * 4;
      if (px[o + 3] > 128) {
        opaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (px[o + 3] === 255 && (px[o] !== color[0] || px[o + 1] !== color[1] || px[o + 2] !== color[2])) {
          colorOk = false;
        }
      }
    }
  }
  const cov = opaque / (81 * 81) * 100;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const problems = [];
  if (cov < 5 || cov > 45) problems.push('覆盖率异常 ' + cov.toFixed(1) + '%');
  if (minX < 5 || minY < 5 || maxX > 76 || maxY > 76) problems.push('内容超出边距');
  if (Math.abs(cx - 40) > 8 || Math.abs(cy - 40) > 8) problems.push('未居中 cx=' + cx.toFixed(1) + ' cy=' + cy.toFixed(1));
  if (!colorOk) problems.push('颜色与预期不符');
  if (problems.length) {
    fail++;
    console.log('✗ ' + file + ' → ' + problems.join('; ') +
      ' (bbox ' + minX + ',' + minY + ' ~ ' + maxX + ',' + maxY + ')');
  } else {
    console.log('✓ ' + file + ' 覆盖 ' + cov.toFixed(1) + '%, bbox ' + minX + ',' + minY + ' ~ ' + maxX + ',' + maxY + ', 颜色正确');
  }
});

if (fs.existsSync(path.join(ROOT, 'scripts', 'preview.png'))) {
  console.log('✓ preview.png 存在');
} else {
  fail++;
  console.log('✗ preview.png 缺失');
}
console.log(fail ? '\n共 ' + fail + ' 个问题' : '\n图标全部通过 ✓');
process.exit(fail ? 1 : 0);
