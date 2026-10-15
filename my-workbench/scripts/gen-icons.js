/**
 * 生成 tabBar 图标（纯 Node 实现，零依赖）
 * 用法：node scripts/gen-icons.js
 * 输出：images/tab/*.png（81x81，灰/蓝两套）+ scripts/preview.png（目检用）
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ================= PNG 编码 ================= */
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

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // 位深 8
  ihdr[9] = 6;  // 颜色类型 6 = RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // 滤波器类型 0（None）
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ================= SDF 形状 ================= */
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) - r;

const rrect = (cx, cy, hw, hh, r) => (x, y) => {
  const dx = Math.abs(x - cx) - (hw - r);
  const dy = Math.abs(y - cy) - (hh - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ax, ay) - r;
};

const capsule = (ax, ay, bx, by, w) => (x, y) => {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - w;
};

const outline = (sdf, w) => (x, y) => Math.abs(sdf(x, y)) - w / 2;
const union = (...sdfs) => (x, y) => Math.min(...sdfs.map(f => f(x, y)));

/* ================= 渲染（4x4 超采样抗锯齿） ================= */
function renderRGBA(size, sdf, color) {
  const SS = 4;
  const rgba = Buffer.alloc(size * size * 4);
  const k = 81 / size; // SDF 定义在 81x81 坐标系
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (sdf((px + (sx + 0.5) / SS) * k, (py + (sy + 0.5) / SS) * k) < 0) hit++;
        }
      }
      const o = (py * size + px) * 4;
      rgba[o] = color[0];
      rgba[o + 1] = color[1];
      rgba[o + 2] = color[2];
      rgba[o + 3] = Math.round((hit / (SS * SS)) * 255);
    }
  }
  return rgba;
}

/* ================= 图标定义（81x81 坐标系） ================= */
const STROKE = 5.5;
const ICONS = {
  // 工作台：2x2 圆角方块，对角 填充/描边 交替
  dashboard: union(
    rrect(26, 26, 11, 11, 4),
    outline(rrect(55, 26, 11, 11, 4), STROKE),
    outline(rrect(26, 55, 11, 11, 4), STROKE),
    rrect(55, 55, 11, 11, 4)
  ),
  // 任务：圆环 + 对勾
  tasks: union(
    outline(circle(40.5, 40.5, 27), STROKE),
    capsule(28.5, 41, 37.5, 50, 3.4),
    capsule(37.5, 50, 54, 31, 3.4)
  ),
  // 统计：三根高度递增的柱
  stats: union(
    rrect(25, 53, 5.5, 11, 2.75),
    rrect(40.5, 46, 5.5, 18, 2.75),
    rrect(56, 39, 5.5, 25, 2.75)
  ),
  // 我的：圆头 + 拱肩
  mine: union(
    circle(40.5, 27.5, 11.5),
    rrect(40.5, 58.5, 19, 11.5, 11.5)
  )
};

const GRAY = [154, 163, 178]; // #9AA3B2
const BLUE = [76, 110, 245];  // #4C6EF5
const OUT_DIR = path.join(__dirname, '..', 'images', 'tab');

fs.mkdirSync(OUT_DIR, { recursive: true });
Object.keys(ICONS).forEach(name => {
  fs.writeFileSync(path.join(OUT_DIR, name + '.png'), encodePNG(81, 81, renderRGBA(81, ICONS[name], GRAY)));
  fs.writeFileSync(path.join(OUT_DIR, name + '-active.png'), encodePNG(81, 81, renderRGBA(81, ICONS[name], BLUE)));
});

/* ================= 预览图（左灰右蓝，每行一个图标） ================= */
const CELL = 120, GAP = 24, PAD = 20;
const names = Object.keys(ICONS);
const pw = PAD * 2 + (CELL + GAP) * 2 - GAP;
const ph = PAD * 2 + (CELL + GAP) * names.length - GAP;
const preview = Buffer.alloc(pw * ph * 4);
for (let i = 0; i < pw * ph; i++) {
  preview[i * 4] = 255;
  preview[i * 4 + 1] = 255;
  preview[i * 4 + 2] = 255;
  preview[i * 4 + 3] = 255;
}
function blit(buf, size, dx, dy) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const di = ((dy + y) * pw + dx + x) * 4;
      const a = buf[si + 3] / 255;
      preview[di] = Math.round(buf[si] * a + preview[di] * (1 - a));
      preview[di + 1] = Math.round(buf[si + 1] * a + preview[di + 1] * (1 - a));
      preview[di + 2] = Math.round(buf[si + 2] * a + preview[di + 2] * (1 - a));
      preview[di + 3] = 255;
    }
  }
}
names.forEach((name, i) => {
  const y = PAD + i * (CELL + GAP);
  blit(renderRGBA(CELL, ICONS[name], GRAY), CELL, PAD, y);
  blit(renderRGBA(CELL, ICONS[name], BLUE), CELL, PAD + CELL + GAP, y);
});
fs.writeFileSync(path.join(__dirname, 'preview.png'), encodePNG(pw, ph, preview));

console.log('已生成 8 个图标 → ' + OUT_DIR);
console.log('预览图 → ' + path.join(__dirname, 'preview.png'));
