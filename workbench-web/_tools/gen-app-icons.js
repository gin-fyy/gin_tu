/**
 * 生成 App 图标（纯 Node 实现，零依赖）
 * 用法: node _tools/gen-app-icons.js
 * 输出: www/icons/icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png / favicon.png
 * 图形：品牌蓝圆角方块 + 白色「圆环 + 对勾」
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'www', 'icons');

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
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* ================= SDF 形状（81x81 坐标系） ================= */
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

/* ================= 渲染（4x4 超采样 + alpha 合成） ================= */
const SS = 4;

function paint(rgba, size, sdf, color) {
  const k = 81 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (sdf((px + (sx + 0.5) / SS) * k, (py + (sy + 0.5) / SS) * k) < 0) hit++;
        }
      }
      if (!hit) continue;
      const a = hit / (SS * SS);
      const o = (py * size + px) * 4;
      const dstA = rgba[o + 3] / 255;
      const outA = a + dstA * (1 - a);
      if (outA <= 0) continue;
      rgba[o] = Math.round((color[0] * a + rgba[o] * dstA * (1 - a)) / outA);
      rgba[o + 1] = Math.round((color[1] * a + rgba[o + 1] * dstA * (1 - a)) / outA);
      rgba[o + 2] = Math.round((color[2] * a + rgba[o + 2] * dstA * (1 - a)) / outA);
      rgba[o + 3] = Math.round(outA * 255);
    }
  }
}

const BLUE = [76, 110, 245];  // #4C6EF5
const WHITE = [255, 255, 255];

function renderIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = maskable
    ? rrect(40.5, 40.5, 40.5, 40.5, 0)      // 满幅方形，交给启动器裁切
    : rrect(40.5, 40.5, 40.5, 40.5, 18);    // 圆角方块
  paint(rgba, size, bg, BLUE);

  const s = maskable ? 0.72 : 1;            // maskable 收进安全区
  const c = 40.5;
  const at = (px, py) => [c + (px - c) * s, c + (py - c) * s];
  const ring = outline(circle(...at(40.5, 40.5), 24 * s), 6 * s);
  const check1 = capsule(...at(28, 42.5), ...at(36.5, 51), 2.6 * s);
  const check2 = capsule(...at(36.5, 51), ...at(53, 32), 2.6 * s);
  paint(rgba, size, union(ring, check1, check2), WHITE);
  return rgba;
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
  ['favicon.png', 64, false]
];
targets.forEach(([name, size, maskable]) => {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, encodePNG(size, size, renderIcon(size, maskable)));
  console.log('✓ ' + name + '  ' + size + 'x' + size + (maskable ? ' (maskable)' : ''));
});
console.log('图标已生成 → ' + OUT_DIR);
