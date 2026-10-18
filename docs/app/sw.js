// 离线缓存（可选能力）：只在 https / localhost 下注册成功，file:// 打开时自动跳过
// 策略：联网时「网络优先」——改了代码刷新页面即生效，不会卡在旧版本；断网时回落到缓存，离线仍可用。
const CACHE = 'workbench-v7';
const ASSETS = [
  './index.html',
  './css/app.css',
  './js/core.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './img/wallpaper-sakura.webp',
  './img/pet-whale.webp'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let sameOrigin = false;
  try {
    sameOrigin = new URL(req.url).origin === self.location.origin;
  } catch (err) {
    sameOrigin = false;
  }
  if (!sameOrigin) return;

  // 网络优先，但**必须带超时**：网络卡住时要回落到缓存，否则请求会一直挂着（图片/脚本永远出不来）
  e.respondWith(new Promise((resolve) => {
    let settled = false;
    const done = (res) => {
      if (settled) return;
      settled = true;
      resolve(res || new Response('', { status: 504, statusText: 'offline' }));
    };
    const fromCache = (fallbackIndex) => {
      caches.match(req).then((hit) => {
        if (hit) return done(hit);
        if (fallbackIndex) return caches.match('./index.html').then((idx) => done(idx));
        done(null);
      }).catch(() => done(null));
    };
    const timer = setTimeout(() => fromCache(true), 3000);
    const hardStop = setTimeout(() => { clearTimeout(timer); fromCache(true); }, 8000);

    fetch(req).then((res) => {
      clearTimeout(timer);
      clearTimeout(hardStop);
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      done(res);
    }).catch(() => {
      clearTimeout(timer);
      clearTimeout(hardStop);
      fromCache(true);
    });
  }));
});
