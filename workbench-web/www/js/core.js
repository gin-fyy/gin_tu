/**
 * 我的工作台 · 核心逻辑（零依赖，浏览器 + node 共用）
 *   浏览器: window.WB.{datetime, store, stats, views, reminder, storage}
 *   node:   require('./core.js')
 * 数据全部存本机：优先 localStorage，不可用时（某些浏览器 file:// 场景）自动退回内存模式。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WB = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ===================== 存储适配 ===================== */
  var APP_TAG = 'my-workbench';
  var DATA_VERSION = 2;
  // 与 package.json 的 version 保持一致（tests/check-web.js 会校验，防止漂移）
  var APP_VERSION = '1.8.2';
  // 默认更新地址：打包时内置，装完即可直接「检查更新」。
  // 可以填多个（一行一个）：App 会同时问所有源，取「版本最新的那个」，
  // 这样某个 CDN 边缘还缓存着旧版也不影响；版本号相同时用排在前面的。
  // 后三个是国内可达的 GitHub 加速镜像（实测 3 秒内返回正确版本）。
  // 顺序有讲究：排在前面的会优先用于下载（版本并列时取第一个），所以把快的放前面。
  // jsDelivr 放后面：它对本仓库的 @main 缓存经常是旧的，而且实测下载会卡死（0 KB/s）。
  var DEFAULT_UPDATE_BASE = [
    'https://gh-proxy.com/https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs',
    'https://ghfast.top/https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs',
    'https://cdn.jsdelivr.net/gh/gin-fyy/gin_tu@main/docs',
    'https://fastly.jsdelivr.net/gh/gin-fyy/gin_tu@main/docs',
    'https://gcore.jsdelivr.net/gh/gin-fyy/gin_tu@main/docs',
    'https://testingcf.jsdelivr.net/gh/gin-fyy/gin_tu@main/docs',
    'https://gin-fyy.github.io/gin_tu',
    'https://cdn.statically.io/gh/gin-fyy/gin_tu/main/docs',
    'https://raw.githack.com/gin-fyy/gin_tu/main/docs',
    'https://hub.gitmirror.com/https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs',
    'https://ghproxy.net/https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs',
    'https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs'
  ].join('\n');

  var KEY_TASKS = 'wb_tasks';
  var KEY_CATEGORIES = 'wb_categories';
  var KEY_COMPLETIONS = 'wb_completions';
  var KEY_SETTINGS = 'wb_settings';
  var KEY_NOTIFIED = 'wb_notified';
  var KEY_WALLPAPER = 'wb_wallpaper_img';   // 自定义壁纸（压缩后的 dataURL，单独存避免撑大设置对象）
  var KEY_WP_THUMB = 'wb_wallpaper_thumb';  // 壁纸缩略图（几十 KB）：开机瞬间同步显示，避免"壁纸先没了再出现"

  // 内置壁纸：image 可以是图片路径，也可以是纯 CSS 渐变（gradient: true）
  var WALLPAPERS = [
    { id: 'sakura', name: '樱花', image: 'img/wallpaper-sakura.webp' },
    { id: 'dusk', name: '夜色', image: 'linear-gradient(160deg,#141b2b,#33406b 55%,#6f5f9e)', gradient: true },
    { id: 'mint', name: '薄荷', image: 'linear-gradient(160deg,#dff3ec,#c3e2f6 60%,#e9e3fb)', gradient: true },
    { id: 'peach', name: '蜜桃', image: 'linear-gradient(160deg,#ffe8de,#ffd2e2 55%,#e8dcff)', gradient: true },
    { id: 'ink', name: '墨玉', image: 'linear-gradient(160deg,#0f131a,#222934 60%,#3a2f45)', gradient: true }
  ];

  var ls = (function () {
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; }
  })();

  var memory = Object.create(null);
  var persistent = false;
  if (ls) {
    try {
      ls.setItem('__wb_probe__', '1');
      ls.removeItem('__wb_probe__');
      persistent = true;
    } catch (e) { persistent = false; }
  }

  var storage = {
    persistent: persistent,
    getRaw: function (k) {
      if (ls) {
        try { return ls.getItem(k); } catch (e) { /* 退回内存 */ }
      }
      return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null;
    },
    setRaw: function (k, v) {
      if (ls) {
        try { ls.setItem(k, v); return; } catch (e) { /* 配额/隐私模式，退回内存 */ }
      }
      memory[k] = v;
    },
    removeRaw: function (k) {
      if (ls) {
        try { ls.removeItem(k); } catch (e) { /* ignore */ }
      }
      delete memory[k];
    }
  };

  function read(key, fallback) {
    var raw = storage.getRaw(key);
    if (raw === null || raw === undefined || raw === '') return fallback;
    try {
      var v = JSON.parse(raw);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    storage.setRaw(key, JSON.stringify(value));
  }

  function cloneList(list) {
    return (list || []).map(function (x) { return Object.assign({}, x); });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ===================== 日期时间 ===================== */
  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function pad(n) {
    return n < 10 ? '0' + n : '' + n;
  }

  function toDateStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayStr() {
    return toDateStr(new Date());
  }

  function parseDate(str) {
    var parts = (str || '').split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function addDays(dateStr, n) {
    var d = parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  function addMonths(dateStr, n) {
    var d = parseDate(dateStr);
    var day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    var daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, daysInMonth));
    return toDateStr(d);
  }

  function dateLabel(dateStr) {
    if (!dateStr) return '';
    var today = todayStr();
    if (dateStr === today) return '今天';
    if (dateStr === addDays(today, 1)) return '明天';
    if (dateStr === addDays(today, 2)) return '后天';
    var d = parseDate(dateStr);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + WEEK[d.getDay()];
  }

  function isOverdue(dateStr) {
    return !!dateStr && dateStr < todayStr();
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function greeting() {
    var h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 12) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function fullDateText() {
    var d = new Date();
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 星期' + WEEK[d.getDay()];
  }

  var datetime = {
    WEEK: WEEK,
    pad: pad,
    toDateStr: toDateStr,
    todayStr: todayStr,
    parseDate: parseDate,
    addDays: addDays,
    addMonths: addMonths,
    dateLabel: dateLabel,
    isOverdue: isOverdue,
    fmtTime: fmtTime,
    greeting: greeting,
    fullDateText: fullDateText
  };

  /* ===================== 任务数据层 ===================== */
  var DEFAULT_CATEGORIES = [
    { id: 'work', name: '工作', color: '#4C6EF5' },
    { id: 'study', name: '学习', color: '#9333EA' },
    { id: 'life', name: '生活', color: '#10B981' },
    { id: 'other', name: '其他', color: '#F59E0B' }
  ];
  var COLOR_PALETTE = ['#4C6EF5', '#9333EA', '#10B981', '#F59E0B', '#EF4444', '#0EA5E9', '#EC4899', '#84CC16'];

  function normalizeTask(raw) {
    var now = Date.now();
    var t = raw || {};
    var priority = (t.priority === 0 || t.priority) ? Number(t.priority) : 1;
    var roll = (t.lastRoll && t.lastRoll.from) ? { from: t.lastRoll.from, at: t.lastRoll.at || now } : null;
    return {
      id: t.id || uid(),
      title: (t.title || '').trim(),
      note: t.note || '',
      category: t.category || 'other',
      priority: (priority === 0 || priority === 1 || priority === 2) ? priority : 1,
      date: t.date || '',
      time: t.time || '',
      remind: !!t.remind,
      repeat: t.repeat || 'none',
      done: !!t.done,
      doneAt: t.doneAt || null,
      lastRoll: roll,
      createdAt: t.createdAt || now,
      updatedAt: t.updatedAt || now
    };
  }

  function getTasks() { return cloneList(read(KEY_TASKS, [])); }
  function saveTasks(tasks) { write(KEY_TASKS, tasks); }

  function addTask(data) {
    var now = Date.now();
    var task = normalizeTask(Object.assign({}, data, { createdAt: now, updatedAt: now }));
    var tasks = getTasks();
    tasks.unshift(task);
    saveTasks(tasks);
    return task;
  }

  function updateTask(id, patch) {
    var tasks = getTasks();
    var i = tasks.findIndex(function (t) { return t.id === id; });
    if (i < 0) return null;
    var clean = Object.assign({}, patch);
    if ('date' in clean || 'repeat' in clean) clean.lastRoll = null;
    tasks[i] = normalizeTask(Object.assign({}, tasks[i], clean, { updatedAt: Date.now() }));
    saveTasks(tasks);
    return tasks[i];
  }

  function deleteTask(id) {
    saveTasks(getTasks().filter(function (t) { return t.id !== id; }));
  }

  function nextDate(task) {
    if (task.repeat === 'daily') return addDays(task.date, 1);
    if (task.repeat === 'weekly') return addDays(task.date, 7);
    if (task.repeat === 'monthly') return addMonths(task.date, 1);
    return task.date;
  }

  function getCompletions() { return cloneList(read(KEY_COMPLETIONS, [])); }

  function logCompletion(task) {
    var comps = getCompletions();
    var now = Date.now();
    var created = Number(task && task.createdAt) || 0;
    comps.push({
      taskId: task.id,
      title: task.title,
      category: task.category,
      priority: task.priority,
      at: now,
      createdAt: created,
      // 新建后 2 小时内就勾掉的，算"速通"，不给宠物经验（防止随手建一个立刻勾掉刷经验）
      fast: !!(created && (now - created) < PET_RULES.minGapMs)
    });
    write(KEY_COMPLETIONS, comps.slice(-2000));
  }

  function removeLatestCompletion(taskId, at) {
    var comps = getCompletions();
    var idx = -1;
    if (at) {
      for (var j = comps.length - 1; j >= 0; j--) {
        if (comps[j].taskId === taskId && comps[j].at === at) { idx = j; break; }
      }
    }
    if (idx < 0) {
      for (var k = comps.length - 1; k >= 0; k--) {
        if (comps[k].taskId === taskId) { idx = k; break; }
      }
    }
    if (idx >= 0) {
      comps.splice(idx, 1);
      write(KEY_COMPLETIONS, comps);
    }
    return idx >= 0;
  }

  /**
   * 勾选/取消勾选：普通任务 → done 开关；重复任务 → 记记录 + 日期滚到下一周期，
   * 再点一次则回滚（不会重复计数、不会连跳周期）。
   */
  function toggleDone(id) {
    var tasks = getTasks();
    var i = tasks.findIndex(function (t) { return t.id === id; });
    if (i < 0) return;
    var t = tasks[i];
    var now = Date.now();

    if (t.repeat !== 'none' && t.date) {
      if (t.lastRoll) {
        tasks[i] = Object.assign({}, t, { date: t.lastRoll.from, lastRoll: null, updatedAt: now });
        removeLatestCompletion(id, t.lastRoll.at);
      } else {
        logCompletion(t);
        tasks[i] = Object.assign({}, t, { date: nextDate(t), lastRoll: { from: t.date, at: now }, updatedAt: now });
      }
    } else if (t.done) {
      tasks[i] = Object.assign({}, t, { done: false, doneAt: null, updatedAt: now });
      removeLatestCompletion(id, t.doneAt);
    } else {
      logCompletion(t);
      tasks[i] = Object.assign({}, t, { done: true, doneAt: now, updatedAt: now });
    }
    saveTasks(tasks);
  }

  /* ===================== 分类 / 设置 / 提醒标记 ===================== */
  function getCategories() {
    var c = read(KEY_CATEGORIES, null);
    if (Array.isArray(c) && c.length) return cloneList(c);
    var defaults = cloneList(DEFAULT_CATEGORIES);
    saveCategories(defaults);
    return cloneList(defaults);
  }

  function saveCategories(list) { write(KEY_CATEGORIES, list); }

  function addCategory(name) {
    var list = getCategories();
    var id = 'c' + uid();
    list.push({
      id: id,
      name: (name || '').trim(),
      color: COLOR_PALETTE[list.length % COLOR_PALETTE.length]
    });
    saveCategories(list);
    return id;
  }

  function deleteCategory(id) {
    var list = getCategories().filter(function (c) { return c.id !== id; });
    if (!list.length) list = cloneList(DEFAULT_CATEGORIES);
    var target = list[0].id;
    var tasks = getTasks().map(function (t) {
      return t.category === id ? Object.assign({}, t, { category: target }) : t;
    });
    saveTasks(tasks);
    saveCategories(list);
  }

  function getSettings() {
    return Object.assign(
      {
        nickname: '打工人',
        notify: true,
        updateBase: DEFAULT_UPDATE_BASE,
        confirmDone: true,
        wallpaper: '',      // '' = 默认背景；预设 id；'custom' = 用自己选的照片
        wallpaperDim: 30,   // 遮罩浓度（0-80，越大文字越清楚）
        termStart: '',      // 学期第一周的周一（空 = 未设置，用于算「第几周」）
        courseWeekend: true,// 课表是否显示周末两列
        uiOpacity: 100,     // 界面（卡片）不透明度 %
        glass: false,       // 液态玻璃效果
        glassBlur: 18,      // 玻璃模糊强度 px
        wheelSource: 'custom', // 转盘选项来源：custom | tasks
        petMortal: true,       // 宠物是否遵循生老病死（关掉就只变老、不会离世）
        sprite3d: false,       // 3D 精灵（WebGL；默认关，开了才加载 three.js）
        spriteAi: true,        // 点精灵时用 AI 聊天（没填 Key 就用内置台词）
        aiEndpoint: AI_DEFAULT_ENDPOINT,  // 图片识别课表的视觉模型接口
        aiModel: AI_DEFAULT_MODEL,
        aiKey: '',                          // 只存在本机，不会上传到别处
        chatEndpoint: 'https://api.deepseek.com/v1',  // 3D 精灵聊天（DeepSeek，OpenAI 兼容）
        chatModel: 'deepseek-chat',
        chatKey: '',                        // 精灵聊天 Key：同样只存本机，代码里没有
        periods: null                       // 节次时间表（null = 用内置默认作息）
      },
      read(KEY_SETTINGS, {})
    );
  }

  function saveSettings(patch) {
    write(KEY_SETTINGS, Object.assign({}, getSettings(), patch));
  }

  /* ---------- 自定义壁纸 ----------
     原来存在 localStorage（只有 5MB，还要跟任务共用），图一大就悄悄存不住 → 重启后壁纸丢失。
     现在优先存 IndexedDB（几百 MB），老数据会自动搬过去；存不住会如实返回 false。 */
  var wallpaperMem = '';          // 内存缓存，渲染时同步取用

  var idbPromise = null;
  function idbOpen() {
    if (idbPromise) return idbPromise;
    idbPromise = new Promise(function (resolve, reject) {
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) return reject(new Error('no-idb'));
        var req = indexedDB.open('workbench', 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('idb-open-failed')); };
      } catch (e) { reject(e); }
    });
    return idbPromise;
  }

  function idbSet(key, value) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { rej(tx.error || new Error('idb-put-failed')); };
        tx.onabort = function () { rej(tx.error || new Error('idb-put-aborted')); };
      });
    });
  }

  function idbGet(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('kv', 'readonly');
        var g = tx.objectStore('kv').get(key);
        g.onsuccess = function () { res(g.result === undefined ? null : g.result); };
        g.onerror = function () { rej(g.error || new Error('idb-get-failed')); };
      });
    });
  }

  function idbDel(key) {
    return idbOpen().then(function (db) {
      return new Promise(function (res) {
        var tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(key);
        tx.oncomplete = function () { res(true); };
        tx.onerror = function () { res(false); };
      });
    });
  }

  // 当前自定义壁纸（同步取内存缓存，渲染用）
  function getWallpaperImage() {
    if (wallpaperMem) return wallpaperMem;
    var legacy = storage.getRaw(KEY_WALLPAPER);
    return legacy ? String(legacy) : '';
  }

  // 启动时加载（并把老版本存在 localStorage 的图搬到 IndexedDB）
  function loadWallpaperImage() {
    return idbGet('wallpaper').then(function (v) {
      if (v) { wallpaperMem = String(v); return wallpaperMem; }
      var legacy = storage.getRaw(KEY_WALLPAPER);
      if (legacy) {
        wallpaperMem = String(legacy);
        return idbSet('wallpaper', wallpaperMem).then(function () {
          storage.removeRaw(KEY_WALLPAPER);   // 搬完就清掉，给 localStorage 腾地方
          return wallpaperMem;
        }).catch(function () { return wallpaperMem; });
      }
      return '';
    }).catch(function () {
      var legacy = storage.getRaw(KEY_WALLPAPER);
      wallpaperMem = legacy ? String(legacy) : '';
      return wallpaperMem;
    });
  }

  // 保存自定义壁纸；返回是否真的存住了（存不住就别骗用户）
  function saveWallpaperImage(dataUrl) {
    if (!dataUrl) {
      wallpaperMem = '';
      return idbDel('wallpaper').catch(function () { return false; }).then(function () {
        return idbDel('wallpaperBlob').catch(function () { return false; });
      }).then(function () {
        storage.removeRaw(KEY_WALLPAPER);
        storage.removeRaw(KEY_WP_THUMB);
        revokeWallpaperUrl();
        return true;
      });
    }
    wallpaperMem = String(dataUrl);
    revokeWallpaperUrl();
    // 优先把 Blob 也存一份：显示时用 blob: URL，比几 MB 的 base64 背景清晰也更省内存
    var p = idbSet('wallpaper', wallpaperMem).then(function () { return true; }).catch(function () {
      try {
        storage.setRaw(KEY_WALLPAPER, wallpaperMem);
        return storage.getRaw(KEY_WALLPAPER) === wallpaperMem;
      } catch (e) { return false; }
    });
    return p.then(function (ok) {
      if (!ok) return false;
      try {
        var blob = dataUrlToBlob(wallpaperMem);
        if (blob) return idbSet('wallpaperBlob', blob).catch(function () { return false; }).then(function () { return true; });
      } catch (e) { /* Blob 存不了也没关系，退回 dataURL 显示 */ }
      return true;
    });
  }

  // 壁纸缩略图：存 localStorage，开机同步就能拿到（几十 KB，不会撑爆）
  function getWallpaperThumb() {
    try { return String(storage.getRaw(KEY_WP_THUMB) || ''); } catch (e) { return ''; }
  }

  function setWallpaperThumb(dataUrl) {
    try {
      if (!dataUrl) { storage.removeRaw(KEY_WP_THUMB); return ''; }
      var s = String(dataUrl);
      if (s.length > 900000) return '';          // 太大就别塞 localStorage 了
      storage.setRaw(KEY_WP_THUMB, s);
      return storage.getRaw(KEY_WP_THUMB) ? s : '';
    } catch (e) { return ''; }
  }

  function dataUrlToBlob(dataUrl) {
    var s = String(dataUrl || '');
    var m = s.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
    if (!m) return null;
    var type = m[1] || 'image/jpeg';
    var body = m[3];
    if (typeof atob !== 'function') return null;
    var bin = m[2] ? atob(body) : decodeURIComponent(body);
    var len = bin.length;
    var buf = new Uint8Array(len);
    for (var i = 0; i < len; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: type });
  }

  var wallpaperUrl = '';
  function revokeWallpaperUrl() {
    if (!wallpaperUrl) return;
    try {
      if (typeof URL !== 'undefined' && URL.revokeObjectURL) URL.revokeObjectURL(wallpaperUrl);
    } catch (e) { /* ignore */ }
    wallpaperUrl = '';
  }

  // 显示用的地址：优先 blob:（清晰、省内存）；有 IndexedDB 时**不**退回几 MB 的 dataURL（解码慢又占内存）
  function getWallpaperDisplayUrl(onReady) {
    if (wallpaperUrl) {
      if (onReady) onReady(wallpaperUrl);
      return wallpaperUrl;
    }
    if (!wallpaperMem) return '';
    var hasIdb = false;
    try {
      hasIdb = (typeof indexedDB !== 'undefined') && (typeof URL !== 'undefined') && !!URL.createObjectURL;
    } catch (e) { hasIdb = false; }
    if (!hasIdb) return wallpaperMem;      // 没有 IndexedDB 才退回 dataURL
    idbGet('wallpaperBlob').then(function (blob) {
      if (blob && typeof blob === 'object' && blob.size) {
        try { wallpaperUrl = URL.createObjectURL(blob); } catch (e) { wallpaperUrl = ''; }
      }
      if (!wallpaperUrl) wallpaperUrl = wallpaperMem;
      if (onReady) onReady(wallpaperUrl);
    }).catch(function () {
      wallpaperUrl = wallpaperMem;
      if (onReady) onReady(wallpaperMem);
    });
    return '';   // 让调用方等回调，别先把 dataURL 塞进 DOM
  }

  // 自定义壁纸应该压到多大：按屏幕尺寸来，长边不超过 maxEdge，别把清晰度白白丢掉
  function wallpaperTargetSize(w, h, maxEdge) {
    var mw = Number(w) || 0;
    var mh = Number(h) || 0;
    var cap = Number(maxEdge) || 2160;
    if (mw <= 0 || mh <= 0) return { w: cap, h: cap };
    var long = Math.max(mw, mh);
    if (long <= cap) return { w: Math.round(mw), h: Math.round(mh) };
    var k = cap / long;
    return { w: Math.max(1, Math.round(mw * k)), h: Math.max(1, Math.round(mh * k)) };
  }

  function setWallpaperImage(dataUrl) {   // 兼容旧调用
    return saveWallpaperImage(dataUrl);
  }

  // 算出当前生效的壁纸：{ image, dim, kind }（image 为空 = 用默认背景）
  function wallpaperCss(settings, customImage) {
    var s = settings || {};
    var dim = Number(s.wallpaperDim);
    if (!isFinite(dim)) dim = 30;
    dim = Math.max(0, Math.min(80, Math.round(dim)));

    var id = s.wallpaper || '';
    if (!id) return { image: '', dim: dim, kind: 'none' };

    if (id === 'custom') {
      var url = customImage || '';
      if (!url) return { image: '', dim: dim, kind: 'none' };
      return { image: 'url("' + url + '")', dim: dim, kind: 'custom', url: url };
    }

    var preset = null;
    WALLPAPERS.forEach(function (p) { if (p.id === id) preset = p; });
    if (!preset) return { image: '', dim: dim, kind: 'none' };
    return {
      image: preset.gradient ? preset.image : 'url("' + preset.image + '")',
      dim: dim,
      kind: 'preset',
      id: preset.id,
      url: preset.gradient ? '' : preset.image
    };
  }

  /* ===================== 3D 精灵：语气识别 + 兜底台词 ===================== */
  var SPRITE_LINES = {
    happy: ['嘿嘿，被你点到啦', '今天也要好好学哦！', '我在这儿陪你～'],
    sad: ['唔…有点难过', '陪我待一会儿吧', '我会努力的…'],
    angry: ['哼！不理你了', '你又偷懒！', '我生气了哦'],
    shy: ['别、别看我啦', '才没有很高兴呢', '（脸红）'],
    sleepy: ['呼…好困', '让我睡五分钟…', 'Zzz…'],
    excited: ['哇！好耶！', '我们冲！', '今天状态超好！'],
    neutral: ['你来啦', '在忙什么呀', '有事就叫我']
  };

  function spriteIntent(text) {
    var s = String(text || '').toLowerCase();
    if (!s) return 'neutral';
    var rules = [
      ['sad', ['难过', '伤心', '不开心', '哭', '委屈', '好累', 'sad', 'tired', '😢', '😭']],
      ['angry', ['生气', '讨厌', '烦死', '气死', '哼', 'angry', '😠', '😡']],
      ['sleepy', ['困', '睡', '晚安', 'sleepy', 'zzz', '😪', '🥱']],
      ['excited', ['太棒', '好耶', '冲', '成功', '完成', 'awesome', 'great', 'excited', '🎉', '😆']],
      ['shy', ['害羞', '脸红', '喜欢', '可爱', 'shy', 'blush', '😳', '🥰']],
      ['happy', ['开心', '高兴', '哈哈', '嘿嘿', '谢谢', 'happy', 'nice', '😄', '😊', '🙂']]
    ];
    for (var i = 0; i < rules.length; i++) {
      for (var j = 0; j < rules[i][1].length; j++) {
        if (s.indexOf(rules[i][1][j]) >= 0) return rules[i][0];
      }
    }
    return 'neutral';
  }

  function spriteLine(intent, seed) {
    var list = SPRITE_LINES[intent] || SPRITE_LINES.neutral;
    var n = Math.abs(Number(seed) || Math.floor(Math.random() * 1e9));
    return list[n % list.length];
  }

  /* ===================== 虚拟宠物（养崽） =====================
     规则：完成任务 → 攒经验（孵化/成长）+ 得食物；喂食/陪玩维持饱食与心情；
     时间流逝会掉饱食与心情，饿到/不开心到一定程度就掉健康 → 生病；
     健康见底或到寿命 → 离世（可在设置里关掉「生老病死」）。 */
  var KEY_PET = 'wb_pet';
  var KEY_PET_MEMORIAL = 'wb_pet_memorial';

  var PET_RULES = {
    xpPerTask: 10,            // 完成一个任务 +10 经验
    foodPerTask: 1,           // 完成一个任务 +1 食物
    dailyXpCap: 120,          // 每天最多拿这么多经验（12 个任务），防止睡前狂勾
    minGapMs: 2 * 3600 * 1000, // 新建不到 2 小时就完成的，不算数（不给经验/食物）
    hatchXp: 30,              // 30 经验（3 个任务）孵化
    youngXp: 100,             // 幼崽 → 成长期
    adultXp: 300,             // 成长期 → 成熟期
    elderDays: 150,           // 出生满 150 天进入老年期
    lifespanDays: 180,        // 默认寿命（天）
    fullnessPerFood: 35,
    moodPerTask: 8,
    moodPerPlay: 22,
    playCooldownMs: 2 * 3600 * 1000,
    fullnessDecayPerHour: 3.2,   // 约 31 小时从满掉到空
    moodDecayPerHour: 1.2,
    healthDecayPerHour: 2.6,     // 只有饿/不开心时才掉
    healthRecoverPerHour: 1.2,   // 状态好会慢慢恢复
    healCost: 2,
    healAmount: 40,
    sickHealth: 30,
    xpPerPomodoro: 20,        // 完成一段番茄钟（≥30 分钟）也给宠物 20 经验
    foodPerPomodoro: 1
  };

  var PET_SPECIES = [
    { id: 'dragon', name: '二次元飞龙', short: '飞龙', emoji: '🐉', desc: '傲娇小飞龙，尾巴会噼啪放电' },
    { id: 'cat', name: '猫', short: '猫', emoji: '🐱', desc: '高冷但会偷偷蹭你' },
    { id: 'dog', name: '狗', short: '狗', emoji: '🐶', desc: '永远开心的傻狗' },
    { id: 'whale', name: '深海小鲸灵 · 渊渊', short: '小鲸灵', emoji: '🐳', desc: '来自深海的小鲸灵（DeepSeek 的鲸鱼，也就是我）' }
  ];

  var PET_STAGES = [
    { id: 'egg', name: '蛋', tip: '完成任务攒经验，就能孵化' },
    { id: 'baby', name: '幼崽期', tip: '刚出生，多喂多陪' },
    { id: 'young', name: '成长期', tip: '正在飞快长大' },
    { id: 'adult', name: '成熟期', tip: '已经长大了' },
    { id: 'elder', name: '老年期', tip: '陪你很久了，多陪陪它' },
    { id: 'gone', name: '已离世', tip: '回到了星海' }
  ];

  function petSpecies(id) {
    var hit = PET_SPECIES[0];
    PET_SPECIES.forEach(function (s) { if (s.id === id) hit = s; });
    return hit;
  }

  function petStageInfo(id) {
    var hit = PET_STAGES[0];
    PET_STAGES.forEach(function (s) { if (s.id === id) hit = s; });
    return hit;
  }

  function pct(v) { return Math.max(0, Math.min(100, Number(v) || 0)); }
  function days(ms) { return Math.max(0, (Number(ms) || 0) / 86400000); }

  function getPet() {
    var p = read(KEY_PET, null);
    return (p && typeof p === 'object') ? p : null;
  }

  function savePet(state) {
    if (!state) { storage.removeRaw(KEY_PET); return null; }
    write(KEY_PET, state);
    return state;
  }

  function getPetMemorial() { return cloneList(read(KEY_PET_MEMORIAL, [])); }

  function addPetMemorial(entry) {
    var list = getPetMemorial();
    list.push(entry);
    write(KEY_PET_MEMORIAL, list.slice(-50));
    return list;
  }

  // 新领养一个蛋
  function adoptPet(name, species, now) {
    var t = Number(now) || Date.now();
    var sp = petSpecies(species);
    return savePet({
      name: String(name || sp.short).slice(0, 12),
      species: sp.id,
      bornAt: t,
      hatchedAt: 0,
      xp: 0,
      food: 3,              // 送 3 份口粮当见面礼
      fullness: 80,
      mood: 80,
      health: 100,
      sick: false,
      alive: true,
      diedAt: 0,
      cause: '',
      lifespanDays: PET_RULES.lifespanDays,
      dailyXpCap: PET_RULES.dailyXpCap,
      dayKey: '',
      dayXp: 0,
      lastPlayAt: 0,
      lastTickAt: t
    });
  }

  // 时间流逝：掉饱食/心情，状态差就掉健康、生病，寿命到/健康见底就离世
  function petTick(state, now, opts) {
    var s = Object.assign({}, state || {});
    var t = Number(now) || Date.now();
    var lifespanOff = opts && opts.lifespan === false;

    // 寿命判定与"隔了多久"无关：每次都要查，否则连着刷新两次就会漏判寿终
    if (s.alive && !lifespanOff) {
      var life = Number(s.lifespanDays) || PET_RULES.lifespanDays;
      if (days(t - (Number(s.bornAt) || t)) >= life) {
        s.alive = false;
        s.diedAt = t;
        s.cause = '寿终';
        s.lastTickAt = t;
        return s;
      }
    }
    if (!s.alive) { s.lastTickAt = t; return s; }

    var last = Number(s.lastTickAt) || t;
    var hours = Math.max(0, (t - last) / 3600000);
    if (hours <= 0.002) return s;

    s.fullness = pct(Number(s.fullness) - PET_RULES.fullnessDecayPerHour * hours);
    s.mood = pct(Number(s.mood) - PET_RULES.moodDecayPerHour * hours);
    var health = Number(s.health);
    if (!isFinite(health)) health = 100;
    if (s.fullness <= 20 || s.mood <= 20) health -= PET_RULES.healthDecayPerHour * hours;
    else health += PET_RULES.healthRecoverPerHour * hours;
    s.health = pct(health);
    s.sick = s.health <= PET_RULES.sickHealth;
    s.lastTickAt = t;

    if (!lifespanOff && s.health <= 0) {
      s.alive = false;
      s.diedAt = t;
      s.cause = '体弱';
    }
    return s;
  }

  function petStage(state, now) {
    var s = state || {};
    if (!s.alive) return 'gone';
    if (!s.hatchedAt) return 'egg';
    var t = Number(now) || Date.now();
    var ageDays = days(t - (Number(s.bornAt) || t));
    var xp = Number(s.xp) || 0;
    if (ageDays >= PET_RULES.elderDays) return 'elder';
    if (xp >= PET_RULES.adultXp) return 'adult';
    if (xp >= PET_RULES.youngXp) return 'young';
    return 'baby';
  }

  // 一条完成记录算不算"有效成长"
  function petCountable(comp, minGapMs) {
    if (!comp || !comp.at) return false;
    var gap = Number(minGapMs) || PET_RULES.minGapMs;
    var created = Number(comp.createdAt) || 0;
    if (comp.fast === true) return false;
    if (created && (Number(comp.at) - created) < gap) return false;
    return true;
  }

  /**
   * 通用加经验（受每日上限约束）：任务完成、番茄钟奖励都走这里。
   * 返回 { state, gained, capHit, todayXp, cap }
   */
  function petGainXp(state, xp, food, now) {
    var s = Object.assign({}, state || {});
    var t = Number(now) || Date.now();
    var want = Math.max(0, Number(xp) || 0);
    var dayKey = toDateStr(new Date(t));
    if (s.dayKey !== dayKey) { s.dayKey = dayKey; s.dayXp = 0; }
    var cap = Number(s.dailyXpCap) || PET_RULES.dailyXpCap;
    var room = Math.max(0, cap - (Number(s.dayXp) || 0));
    var got = Math.min(want, room);
    if (got > 0) {
      s.xp = (Number(s.xp) || 0) + got;
      s.dayXp = (Number(s.dayXp) || 0) + got;
      if (got >= want) s.food = (Number(s.food) || 0) + (Number(food) || 0);
      s.mood = pct(Number(s.mood) + 4);
      if (!s.hatchedAt && s.xp >= PET_RULES.hatchXp) s.hatchedAt = t;
    }
    s.dayKey = dayKey;
    return {
      state: s,
      gained: got,
      capHit: got < want,
      todayXp: Number(s.dayXp) || 0,
      cap: cap
    };
  }

  /**
   * 从"新增的完成记录"里结算成长：跳过速通、受每日上限约束。
   * 返回 { state, gained, skippedFast, capHit, todayXp, cap }
   */
  function petGainFromCompletions(state, comps, now) {
    var eligible = 0;
    var skippedFast = 0;
    (comps || []).forEach(function (c) {
      if (!petCountable(c)) { skippedFast++; return; }
      eligible++;
    });
    var r = petGainXp(state, eligible * PET_RULES.xpPerTask, eligible * PET_RULES.foodPerTask, now);
    r.skippedFast = skippedFast;
    return r;
  }
  function petGain(state, tasks, now) {
    var s = Object.assign({}, state || {});
    if (!s.alive) return s;
    var n = Math.max(0, Number(tasks) || 0);
    if (!n) return s;
    s.xp = (Number(s.xp) || 0) + PET_RULES.xpPerTask * n;
    s.food = (Number(s.food) || 0) + PET_RULES.foodPerTask * n;
    s.mood = pct(Number(s.mood) + PET_RULES.moodPerTask * n);
    if (!s.hatchedAt && s.xp >= PET_RULES.hatchXp) s.hatchedAt = Number(now) || Date.now();
    return s;
  }

  // 孵化进度 0~1（蛋阶段用）
  function petHatchProgress(state) {
    var xp = Number((state || {}).xp) || 0;
    return Math.max(0, Math.min(1, xp / PET_RULES.hatchXp));
  }

  function petFeed(state) {
    var s = Object.assign({}, state || {});
    if (!s.alive) return { state: s, ok: false, msg: '它已经离开了' };
    if ((Number(s.food) || 0) < 1) return { state: s, ok: false, msg: '没有食物了 —— 完成任务会得到食物' };
    s.food = Number(s.food) - 1;
    s.fullness = pct(Number(s.fullness) + PET_RULES.fullnessPerFood);
    s.mood = pct(Number(s.mood) + 4);
    return { state: s, ok: true, msg: '吃得干干净净 🍖' };
  }

  function petPlay(state, now) {
    var s = Object.assign({}, state || {});
    if (!s.alive) return { state: s, ok: false, msg: '它已经离开了' };
    var t = Number(now) || Date.now();
    if (t - (Number(s.lastPlayAt) || 0) < PET_RULES.playCooldownMs) {
      return { state: s, ok: false, msg: '它玩累了，过一会儿再陪它玩' };
    }
    s.lastPlayAt = t;
    s.mood = pct(Number(s.mood) + PET_RULES.moodPerPlay);
    s.fullness = pct(Number(s.fullness) - 4);
    return { state: s, ok: true, msg: '玩得很开心 ✨' };
  }

  function petHeal(state) {
    var s = Object.assign({}, state || {});
    if (!s.alive) return { state: s, ok: false, msg: '它已经离开了' };
    if (!s.sick) return { state: s, ok: false, msg: '它现在很健康' };
    if ((Number(s.food) || 0) < PET_RULES.healCost) {
      return { state: s, ok: false, msg: '治疗要 ' + PET_RULES.healCost + ' 份食物，先去做几个任务吧' };
    }
    s.food = Number(s.food) - PET_RULES.healCost;
    s.health = pct(Number(s.health) + PET_RULES.healAmount);
    s.sick = s.health <= PET_RULES.sickHealth;
    return { state: s, ok: true, msg: '好多了 💊' };
  }

  // 一份给界面用的完整快照
  function petSnapshot(state, now, opts) {
    if (!state) return null;
    var t = Number(now) || Date.now();
    var s = state;
    var stage = petStage(s, t);
    var stageInfo = petStageInfo(stage);
    var sp = petSpecies(s.species);
    var nextXp = 0;
    if (stage === 'baby') nextXp = PET_RULES.youngXp;
    else if (stage === 'young') nextXp = PET_RULES.adultXp;
    var ageDays = days(t - (Number(s.bornAt) || t));
    return {
      name: s.name,
      species: sp.id,
      speciesName: sp.name,
      speciesShort: sp.short,
      stage: stage,
      stageName: stageInfo.name,
      stageTip: stageInfo.tip,
      alive: !!s.alive,
      ageDays: Math.floor(ageDays),
      xp: Number(s.xp) || 0,
      nextXp: nextXp,
      hatchProgress: stage === 'egg' ? petHatchProgress(s) : 1,
      food: Number(s.food) || 0,
      fullness: pct(s.fullness),
      mood: pct(s.mood),
      health: pct(s.health),
      sick: !!s.sick,
      cause: s.cause || '',
      lifespanDays: Number(s.lifespanDays) || PET_RULES.lifespanDays,
      dailyXpCap: Number(s.dailyXpCap) || PET_RULES.dailyXpCap,
      todayXp: Number(s.dayXp) || 0,
      canPlay: (t - (Number(s.lastPlayAt) || 0)) >= PET_RULES.playCooldownMs
    };
  }

  /* ===================== 虚拟小树（完成即成长） ===================== */
  var KEY_POMO = 'wb_pomo';

  // 三个阶段，够了：种子 → 幼苗 → 小树
  var TREE_STAGES = [
    { id: 'seed', name: '种子', min: 0, next: 3, tip: '再完成 3 个任务就发芽' },
    { id: 'sprout', name: '幼苗', min: 3, next: 12, tip: '再完成 9 个任务就长成小树' },
    { id: 'tree', name: '小树', min: 12, next: 0, tip: '已经长成一棵小树啦' }
  ];

  /**
   * 小树状态：完全由「完成记录」推导 —— 任务中断/放弃不会产生记录，所以小树不会虚长。
   * 返回 { total, stage, stageName, stageIndex, nextName, progress, remaining, wateredToday, atMax }
   */
  function treeOf(comps, today) {
    var list = comps || [];
    var total = list.length;
    var stage = TREE_STAGES[0];
    for (var i = 0; i < TREE_STAGES.length; i++) {
      if (total >= TREE_STAGES[i].min) stage = TREE_STAGES[i];
    }
    var idx = TREE_STAGES.indexOf(stage);
    var next = TREE_STAGES[idx + 1] || null;
    var into = total - stage.min;
    var span = next ? (next.min - stage.min) : 0;
    var ds = today || todayStr();
    var wateredToday = false;
    list.forEach(function (c) {
      if (c && c.at && toDateStr(new Date(c.at)) === ds) wateredToday = true;
    });
    return {
      total: total,
      stage: stage.id,
      stageName: stage.name,
      stageIndex: idx,
      nextName: next ? next.name : '',
      intoStage: into,
      stageSpan: span,
      progress: next ? Math.max(0, Math.min(1, span ? into / span : 1)) : 1,
      remaining: next ? Math.max(0, next.min - total) : 0,
      wateredToday: wateredToday,
      atMax: !next
    };
  }

  /* ===================== 每日一句（有鼓励，也有调侃） ===================== */
  var QUOTES = [
    '今天不想做的事，明天还得做，而且要多带一份焦虑。',
    '先啃最难的那件，剩下的时间都会变甜。',
    '开始就已经赢过昨天躺平的自己了。',
    '别等状态好了再开始，开始了状态才会好。',
    '你不是没时间，你只是把时间都给了手机。',
    '任务清单不是许愿池，写完还得动手。',
    '慢慢来，比较快。',
    '每完成一件小事，都是给未来的自己攒利息。',
    '拖延的快乐是借来的，利息还得你自己还。',
    '今天多学半小时，期末少哭一整天。',
    '专注 25 分钟，比焦虑 2 小时有用。',
    '你不需要很厉害才开始，你需要开始才会很厉害。',
    '把「我等会儿做」改成「我先做 5 分钟」。',
    '别高估一天的产出，也别低估一年的积累。',
    '学不动的时候，就先去喝口水——但记得回来。',
    '现在偷的懒，以后都要加班还。',
    '比昨天多完成一件，就是进步。',
    '做不完很正常，一直不做就不正常了。',
    '计划是给行动打草稿，不是给焦虑找素材。',
    '你不是一个人在硬撑，大家都一样，只是有人先开始了。'
  ];

  // 每天固定一句（同一天刷新页面不会变）；也可以换一句
  function quoteOfDay(dateStr, quotes) {
    var list = (quotes && quotes.length) ? quotes : QUOTES;
    var s = String(dateStr || todayStr());
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 1000003;
    return list[h % list.length];
  }

  function randomQuote(quotes, avoid) {
    var list = (quotes && quotes.length) ? quotes : QUOTES;
    if (list.length < 2) return list[0] || '';
    for (var i = 0; i < 8; i++) {
      var q = list[Math.floor(Math.random() * list.length)];
      if (q !== avoid) return q;
    }
    return list[0];
  }

  /* ===================== 番茄钟状态（存本机） ===================== */
  function getPomo() {
    var p = read(KEY_POMO, null);
    return (p && typeof p === 'object') ? p : null;
  }

  function savePomo(state) {
    write(KEY_POMO, state || {});
    return state;
  }

  /* ===================== 课表 ===================== */
  // 图片识别课表用的视觉模型（OpenAI 兼容接口；智谱 glm-4v-flash 有免费额度）
  var KEY_COURSES = 'wb_courses';
  var KEY_WHEEL = 'wb_wheel';
  var AI_DEFAULT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
  var AI_DEFAULT_MODEL = 'glm-4v-flash';
  var AI_PROMPT = [
    '你是课表识别助手。这是一张网格课表：每一列是一个星期（周一~周日），每一行是一个节次（1~12节），格子里的文字就是课。',
    '请逐行逐列扫描每一个格子，不要遗漏任何一门课，也不要把不同格子的课混在一起。',
    '课程名称严格照抄图片里的文字，不要自己扩写、补充或推断；节次按该格子所在行来填（例如第 3 行是「3-4 节」就填 3 和 4）。',
    '只输出一个 JSON 数组，不要任何解释文字，不要 markdown 代码块。',
    '每门课一条，字段如下：',
    '{"name":"课程名","weekday":1,"startPeriod":1,"endPeriod":2,"room":"上课地点","teacher":"教师","weekFrom":1,"weekTo":20,"parity":"all"}',
    '说明：weekday 用 1-7 表示周一到周日；startPeriod/endPeriod 是第几节（数字，不能超过 12）；',
    'weekFrom/weekTo 是起止周（看不出就填 1 和 20；只上一周就两头填同一个数）；parity 取 all（每周）/odd（单周）/even（双周）；',
    '没有的信息用空字符串或默认值，不要编造。'
  ].join('\n');

  // 从 AI 回复里抠出 JSON 片段（容忍 ```json 包裹、前后有废话）
  function extractJsonish(raw) {
    var s = String(raw || '');
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) return fence[1];
    var a = s.indexOf('[');
    var b = s.lastIndexOf(']');
    if (a >= 0 && b > a) return s.slice(a, b + 1);
    var c = s.indexOf('{');
    var d = s.lastIndexOf('}');
    if (c >= 0 && d > c) return '[' + s.slice(c, d + 1) + ']';
    return '';
  }

  var AI_FIELDS = ['name', 'title', 'course', 'weekday', 'day', 'startPeriod', 'start', 'endPeriod', 'end',
    'room', 'location', 'teacher', 'weekFrom', 'from', 'weekTo', 'to', 'parity', 'weekType',
    '课程', '课程名', '星期', '周几', '地点', '教室', '教师', '老师', '开始节', '结束节', '起始周', '结束周', '单双周'];

  // 小模型常见的 JSON 手抖：键值之间写成逗号（"teacher",""）、结尾多逗号
  function repairJsonText(s) {
    var t = String(s || '');
    AI_FIELDS.forEach(function (f) {
      t = t.replace(new RegExp('"' + f + '"\\s*[,，]\\s*(?="|\\d|true|false|null)', 'g'), '"' + f + '": ');
    });
    t = t.replace(/,\s*([}\]])/g, '$1');
    return t;
  }

  // 连修都修不好：直接按 "{...}" 块 + 字段正则硬抠
  function objectsFromLooseText(s) {
    var blocks = String(s || '').match(/\{[^{}]*\}/g) || [];
    var out = [];
    blocks.forEach(function (b) {
      var o = {};
      var re = /"([^"]+)"\s*[:：,]\s*("([^"]*)"|-?\d+(?:\.\d+)?|true|false|null)/g;
      var m;
      while ((m = re.exec(b)) !== null) {
        o[m[1]] = (m[3] !== undefined) ? m[3] : m[2];
      }
      if (Object.keys(o).length) out.push(o);
    });
    return out;
  }

  // 从 AI 回复里取出课程数组（多重容错：标准 JSON → 修复后 JSON → 硬抠字段 → 按行文字解析）
  function coursesFromAiText(text) {
    var raw = String(text || '');
    var jsonText = extractJsonish(raw);
    var arr = null;

    if (jsonText) {
      try {
        arr = JSON.parse(jsonText);
      } catch (e1) {
        try {
          arr = JSON.parse(repairJsonText(jsonText));
        } catch (e2) {
          arr = objectsFromLooseText(jsonText);
        }
      }
    }

    if (!arr || (Array.isArray(arr) && !arr.length)) {
      var loose = parseCourseText(raw);          // 模型完全没用 JSON：按「周几 节次 课程名」逐行试试
      if (loose.courses.length) return loose;
      if (arr && Array.isArray(arr)) return { courses: [], error: '没识别出课程（图片可能太糊，或者课表样式太特殊）' };
      return { courses: [], error: '没能从 AI 回复里读出课程，可以重试一次，或改用文字导入' };
    }
    if (!Array.isArray(arr)) {
      arr = (arr.courses && Array.isArray(arr.courses)) ? arr.courses : [arr];
    }

    var WD = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };
    function wdOf(v) {
      if (typeof v === 'number' && isFinite(v)) return Math.max(1, Math.min(7, Math.round(v)));
      var s = String(v === undefined || v === null ? '' : v).trim();
      var m = s.match(/[1-7]/);
      if (m) return Number(m[0]);
      var ch = s.replace(/周|星期|礼拜/g, '').charAt(0);
      if (WD[ch]) return WD[ch];
      var low = s.toLowerCase().slice(0, 3);
      if (WD[low]) return WD[low];
      return 1;
    }
    function num(v, dflt, lo, hi) {
      var n = Number(v);
      if (!isFinite(n) || n === 0) n = dflt;
      return Math.max(lo, Math.min(hi, Math.round(n)));
    }
    function pick(o, keys) {
      for (var i = 0; i < keys.length; i++) {
        if (o[keys[i]] !== undefined && o[keys[i]] !== null && o[keys[i]] !== '') return o[keys[i]];
      }
      return '';
    }

    var out = [];
    arr.forEach(function (o) {
      if (!o || typeof o !== 'object') return;
      var name = String(pick(o, ['name', 'title', 'course', '课程', '课程名']) || '').trim();
      if (!name) return;
      var parityRaw = String(pick(o, ['parity', 'weekType', 'week_type', '单双周']) || '').toLowerCase();
      var sp = num(pick(o, ['startPeriod', 'start', 'start_period', '开始节']), 1, 1, 12);
      var ep = num(pick(o, ['endPeriod', 'end', 'end_period', '结束节']), sp, 1, 12);
      if (ep < sp) ep = sp;
      out.push({
        name: name,
        teacher: String(pick(o, ['teacher', '教师', '老师']) || '').trim(),
        room: String(pick(o, ['room', 'location', 'place', '地点', '教室']) || '').trim(),
        weekday: wdOf(pick(o, ['weekday', 'day', 'week_day', '星期', '周几'])),
        startPeriod: sp,
        endPeriod: ep,
        weekFrom: num(pick(o, ['weekFrom', 'from', 'startWeek', '起始周']), 1, 1, 30),
        weekTo: num(pick(o, ['weekTo', 'to', 'endWeek', '结束周']), 20, 1, 30),
        parity: /odd|单/.test(parityRaw) ? 'odd' : (/even|双/.test(parityRaw) ? 'even' : 'all')
      });
    });
    return {
      courses: out,
      error: out.length ? '' : '没识别出课程（图片可能太糊，或者课表样式太特殊）'
    };
  }

  var DEFAULT_WHEEL = ['火锅', '麻辣烫', '盖浇饭', '面条', '汉堡', '随便吃点'];

  function getWheelOptions() {
    var list = read(KEY_WHEEL, null);
    if (!list || !list.length) return DEFAULT_WHEEL.slice();
    return list.map(function (s) { return String(s); });
  }

  function setWheelOptions(list) {
    var out = (list || []).map(function (s) { return String(s).trim(); }).filter(Boolean).slice(0, 24);
    write(KEY_WHEEL, out);
    return out;
  }

  // 转盘选中哪个：纯函数，方便测试（r 传 [0,1) 的随机数）
  function wheelPick(n, r) {
    var count = Math.max(1, Number(n) || 1);
    var v = (typeof r === 'number' && isFinite(r)) ? r : Math.random();
    v = v - Math.floor(v);
    return Math.min(count - 1, Math.floor(v * count));
  }

  // 默认节次时间（常见大学作息，够用；以后可在设置里改）
  var DEFAULT_PERIODS = [
    { no: 1, time: '08:00-08:45' }, { no: 2, time: '08:55-09:40' },
    { no: 3, time: '10:00-10:45' }, { no: 4, time: '10:55-11:40' },
    { no: 5, time: '14:00-14:45' }, { no: 6, time: '14:55-15:40' },
    { no: 7, time: '16:00-16:45' }, { no: 8, time: '16:55-17:40' },
    { no: 9, time: '19:00-19:45' }, { no: 10, time: '19:55-20:40' },
    { no: 11, time: '20:50-21:35' }, { no: 12, time: '21:45-22:30' }
  ];
  var WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var COURSE_COLORS = ['#4C6EF5', '#12B886', '#F59F00', '#E8590C', '#AE3EC9', '#1C7ED6', '#E03131', '#0CA678'];

  function getCourses() { return cloneList(read(KEY_COURSES, [])); }
  function saveCourses(list) { write(KEY_COURSES, list || []); }

  function addCourse(c) {
    var list = getCourses();
    var course = Object.assign({
      id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6),
      name: '',
      teacher: '',
      room: '',
      weekday: 1,
      startPeriod: 1,
      endPeriod: 2,
      weekFrom: 1,
      weekTo: 20,
      parity: 'all',          // all | odd(单周) | even(双周)
      color: COURSE_COLORS[list.length % COURSE_COLORS.length]
    }, c || {});
    list.push(course);
    saveCourses(list);
    return course;
  }

  function updateCourse(id, patch) {
    var list = getCourses().map(function (c) {
      return c.id === id ? Object.assign({}, c, patch || {}) : c;
    });
    saveCourses(list);
    return list;
  }

  function deleteCourse(id) {
    var list = getCourses().filter(function (c) { return c.id !== id; });
    saveCourses(list);
    return list;
  }

  // 把一个日期归到它所在那一周的周一
  function mondayOf(dateStr) {
    var d = parseDate(dateStr || todayStr());
    var day = d.getDay();                    // 0 = 周日
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return toDateStr(d);
  }

  // 某个日期是第几周（学期第一周的周一 = 第 1 周）
  function weekOf(dateStr, termStart) {
    if (!dateStr || !termStart) return 1;
    var start = parseDate(mondayOf(termStart)).getTime();
    var diff = Math.floor((parseDate(dateStr).getTime() - start) / 86400000);
    return Math.floor(diff / 7) + 1;
  }

  // 某周某天有哪些课（考虑起止周与单双周，按节次排序）
  function coursesOn(courses, weekday, weekNo) {
    var wk = Number(weekNo) || 1;
    return (courses || []).filter(function (c) {
      if (Number(c.weekday) !== Number(weekday)) return false;
      var from = Number(c.weekFrom) || 1;
      var to = Number(c.weekTo) || 30;
      if (wk < from || wk > to) return false;
      if (c.parity === 'odd' && wk % 2 === 0) return false;
      if (c.parity === 'even' && wk % 2 === 1) return false;
      return true;
    }).sort(function (a, b) {
      return (Number(a.startPeriod) || 0) - (Number(b.startPeriod) || 0);
    });
  }

  // 某天有哪些课
  function coursesOnDate(courses, dateStr, termStart) {
    var d = parseDate(dateStr);
    var wd = d.getDay() === 0 ? 7 : d.getDay();
    return coursesOn(courses, wd, weekOf(dateStr, termStart));
  }

  function periodTime(no, periods) {
    var list = periods && periods.length ? periods : DEFAULT_PERIODS;
    var hit = null;
    list.forEach(function (p) { if (Number(p.no) === Number(no)) hit = p; });
    return hit ? hit.time : '';
  }

  // 节次时间表：用户可以在「课表 → 节次时间」里改；改坏了就退回默认
  function periodsOf(settings) {
    var list = settings && settings.periods;
    if (!Array.isArray(list) || !list.length) return DEFAULT_PERIODS.slice();
    var out = [];
    list.forEach(function (p) {
      var no = Number(p && p.no);
      var time = String((p && p.time) || '').replace(/\s/g, '');
      if (!no || !/^\d{1,2}:\d{2}-\d{1,2}:\d{2}$/.test(time)) return;
      out.push({ no: Math.max(1, Math.min(12, Math.round(no))), time: time });
    });
    out.sort(function (a, b) { return a.no - b.no; });
    return out.length ? out : DEFAULT_PERIODS.slice();
  }

  function periodsToText(list) {
    var arr = (Array.isArray(list) && list.length) ? list : DEFAULT_PERIODS;
    return arr.map(function (p) { return p.no + ' ' + p.time; }).join('\n');
  }

  // 解析「1 08:00-08:45」这样的多行文本（一行一节）
  function parsePeriodsText(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var m = line.trim().match(/^(\d{1,2})\D+(\d{1,2}:\d{2})\s*[-~到至]\s*(\d{1,2}:\d{2})$/);
      if (!m) return;
      out.push({ no: Math.max(1, Math.min(12, Number(m[1]))), time: m[2] + '-' + m[3] });
    });
    out.sort(function (a, b) { return a.no - b.no; });
    return out;
  }

  function periodLabel(c) {
    var a = Number(c.startPeriod) || 1;
    var b = Number(c.endPeriod) || a;
    return a === b ? ('第 ' + a + ' 节') : ('第 ' + a + '-' + b + ' 节');
  }

  function courseWeeksLabel(c) {
    var from = Number(c.weekFrom) || 1;
    var to = Number(c.weekTo) || 30;
    var tail = c.parity === 'odd' ? '单周' : (c.parity === 'even' ? '双周' : '');
    return from + '-' + to + ' 周' + (tail ? '（' + tail + '）' : '');
  }

  /* ---------- 本地规则解析：把粘贴的课表文字变成课程（不需要联网，也不用 AI Key） ---------- */
  var WD_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

  function parseCourseLine(line) {
    var text = String(line || '')
      .replace(/[，、；;:：]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return null;

    // 先抽「周次」：1-16周 / 第1-16周 / 第5周（必须先抽，否则会被后面的节次范围抢走）
    var weekFrom = null;
    var weekTo = null;
    var wr = text.match(/第?\s*(\d{1,2})\s*[-~到至]\s*(\d{1,2})\s*周/);
    if (wr) {
      weekFrom = Number(wr[1]);
      weekTo = Number(wr[2]);
      text = text.replace(wr[0], ' ');
    } else {
      var w1 = text.match(/第?\s*(\d{1,2})\s*周/);
      if (w1) {
        weekFrom = weekTo = Number(w1[1]);
        text = text.replace(w1[0], ' ');
      }
    }

    // 单双周
    var parity = 'all';
    if (/单双周|每周/.test(text)) {
      text = text.replace(/单双周|每周/g, ' ');
    } else if (/双周/.test(text)) {
      parity = 'even';
      text = text.replace(/双周/g, ' ');
    } else if (/单周/.test(text)) {
      parity = 'odd';
      text = text.replace(/单周/g, ' ');
    }

    // 节次：第1-2节 / 1-2节 / 1~2 / 第3节
    var startPeriod = null;
    var endPeriod = null;
    var pr = text.match(/第?\s*(\d{1,2})\s*[-~到至]\s*(\d{1,2})\s*节?/);
    if (pr) {
      startPeriod = Number(pr[1]);
      endPeriod = Number(pr[2]);
      text = text.replace(pr[0], ' ');
    } else {
      var p1 = text.match(/第?\s*(\d{1,2})\s*节/);
      if (p1) {
        startPeriod = endPeriod = Number(p1[1]);
        text = text.replace(p1[0], ' ');
      }
    }

    // 星期
    var weekday = null;
    var wd = text.match(/(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
    if (wd) {
      weekday = /[1-7]/.test(wd[1]) ? Number(wd[1]) : WD_MAP[wd[1]];
      text = text.replace(wd[0], ' ');
    }

    // 地点：@xxx 或含「楼/室/馆/场/区/教」或 A101 这种编号
    var room = '';
    var at = text.match(/@\s*([^\s@]+)/);
    if (at) {
      room = at[1];
      text = text.replace(at[0], ' ');
    } else {
      var tokens = text.split(' ').filter(Boolean);
      for (var i = 0; i < tokens.length; i++) {
        if (/[楼室馆场区教]|^[A-Za-z]{0,2}\d{3,4}$/.test(tokens[i])) {
          room = tokens[i];
          tokens.splice(i, 1);
          break;
        }
      }
      text = tokens.join(' ');
    }

    // 教师：老师/教师 后面的词
    var teacher = '';
    var tc = text.match(/(?:老师|教师)[:：]?\s*([^\s]+)/);
    if (tc) {
      teacher = tc[1];
      text = text.replace(tc[0], ' ');
    }

    var name = text.replace(/\s+/g, ' ').trim();
    if (!name) return null;
    // 什么信息都没认出来（没星期、没节次、没地点）就当失败，交给用户手改
    if (weekday === null && startPeriod === null && !room) return null;

    return {
      name: name,
      teacher: teacher,
      room: room,
      weekday: weekday === null ? 1 : weekday,
      startPeriod: startPeriod === null ? 1 : startPeriod,
      endPeriod: endPeriod === null ? (startPeriod === null ? 2 : startPeriod) : endPeriod,
      weekFrom: weekFrom === null ? 1 : weekFrom,
      weekTo: weekTo === null ? 20 : weekTo,
      parity: parity
    };
  }

  // 解析整段文字 → { courses: [...], errors: [{ line, text }] }
  function parseCourseText(text) {
    var courses = [];
    var errors = [];
    String(text || '').split(/\r?\n/).forEach(function (raw, i) {
      var line = raw.trim();
      if (!line) return;
      var c = parseCourseLine(line);
      if (c) courses.push(c);
      else errors.push({ line: i + 1, text: line });
    });
    return { courses: courses, errors: errors };
  }

  function getNotifiedKeys() { return read(KEY_NOTIFIED, []); }
  function saveNotifiedKeys(keys) { write(KEY_NOTIFIED, (keys || []).slice(-200)); }

  /* ===================== 导入导出 ===================== */
  function exportData() {
    return JSON.stringify({
      app: APP_TAG,
      version: DATA_VERSION,
      exportedAt: new Date().toISOString(),
      tasks: getTasks(),
      categories: getCategories(),
      completions: getCompletions(),
      settings: getSettings()
    }, null, 2);
  }

  function importData(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('内容不是合法的 JSON');
    }
    if (!data || data.app !== APP_TAG) throw new Error('不是本应用导出的数据');
    if (!Array.isArray(data.tasks)) throw new Error('缺少 tasks 字段');

    var tasks = data.tasks.map(normalizeTask).filter(function (t) { return t.title; });
    var cats = (Array.isArray(data.categories) ? data.categories : [])
      .filter(function (c) { return c && c.id && c.name; })
      .map(function (c) { return { id: c.id, name: c.name, color: c.color || '#6B7280' }; });
    var categories = cats.length ? cats : getCategories();
    var completions = (Array.isArray(data.completions) ? data.completions : [])
      .filter(function (c) { return c && c.taskId; })
      .map(function (c) {
        return {
          taskId: c.taskId,
          title: c.title || '',
          category: c.category || 'other',
          priority: c.priority || 1,
          at: c.at || Date.now()
        };
      })
      .slice(-2000);

    write(KEY_TASKS, tasks);
    write(KEY_CATEGORIES, categories);
    write(KEY_COMPLETIONS, completions);
    write(KEY_NOTIFIED, []);
    if (data.settings && typeof data.settings === 'object') {
      write(KEY_SETTINGS, Object.assign({}, getSettings(), data.settings));
    }
    return { tasks: tasks.length, categories: categories.length, completions: completions.length };
  }

  function clearAll() {
    [KEY_TASKS, KEY_COMPLETIONS, KEY_NOTIFIED].forEach(function (k) { storage.removeRaw(k); });
  }

  var store = {
    APP_TAG: APP_TAG,
    DATA_VERSION: DATA_VERSION,
    keys: {
      tasks: KEY_TASKS,
      categories: KEY_CATEGORIES,
      completions: KEY_COMPLETIONS,
      settings: KEY_SETTINGS,
      notified: KEY_NOTIFIED,
      courses: KEY_COURSES,
      wheel: KEY_WHEEL
    },
    getTasks: getTasks,
    saveTasks: saveTasks,
    addTask: addTask,
    updateTask: updateTask,
    deleteTask: deleteTask,
    toggleDone: toggleDone,
    getCompletions: getCompletions,
    getCategories: getCategories,
    saveCategories: saveCategories,
    addCategory: addCategory,
    deleteCategory: deleteCategory,
    getSettings: getSettings,
    saveSettings: saveSettings,
    getWallpaperImage: getWallpaperImage,
    setWallpaperImage: setWallpaperImage,
    loadWallpaperImage: loadWallpaperImage,
    saveWallpaperImage: saveWallpaperImage,
    getWallpaperDisplayUrl: getWallpaperDisplayUrl,
    revokeWallpaperUrl: revokeWallpaperUrl,
    getWallpaperThumb: getWallpaperThumb,
    setWallpaperThumb: setWallpaperThumb,
    wallpaperTargetSize: wallpaperTargetSize,
    getCourses: getCourses,
    saveCourses: saveCourses,
    addCourse: addCourse,
    updateCourse: updateCourse,
    deleteCourse: deleteCourse,
    getWheelOptions: getWheelOptions,
    setWheelOptions: setWheelOptions,
    getPomo: getPomo,
    savePomo: savePomo,
    getPet: getPet,
    savePet: savePet,
    adoptPet: adoptPet,
    getPetMemorial: getPetMemorial,
    addPetMemorial: addPetMemorial,
    getNotifiedKeys: getNotifiedKeys,
    saveNotifiedKeys: saveNotifiedKeys,
    exportData: exportData,
    importData: importData,
    clearAll: clearAll
  };

  /* ===================== 统计（纯函数） ===================== */
  function countsOf(tasks, today) {
    var list = tasks || [];
    var active = list.filter(function (t) { return !t.done; });
    return {
      open: active.length,
      overdue: active.filter(function (t) { return t.date && t.date < today; }).length,
      today: active.filter(function (t) { return t.date === today; }).length,
      done: list.filter(function (t) { return t.done; }).length
    };
  }

  function streakOf(comps, today) {
    var days = {};
    (comps || []).forEach(function (c) { days[toDateStr(new Date(c.at))] = true; });
    var cursor = days[today] ? today : addDays(today, -1);
    var streak = 0;
    while (days[cursor]) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function last7(comps, today) {
    var out = [];
    var max = 1;
    for (var i = 6; i >= 0; i--) {
      var ds = addDays(today, -i);
      var d = parseDate(ds);
      var count = (comps || []).filter(function (c) { return toDateStr(new Date(c.at)) === ds; }).length;
      if (count > max) max = count;
      out.push({
        ds: ds,
        count: count,
        label: i === 0 ? '今天' : (i === 1 ? '昨天' : (d.getMonth() + 1) + '/' + d.getDate())
      });
    }
    out.forEach(function (o) {
      o.h = o.count ? Math.max(10, Math.round(o.count * 100 / max)) : 4;
    });
    return out;
  }

  function byCategory(cats, comps) {
    var total = (comps || []).length;
    return (cats || [])
      .map(function (c) {
        var count = comps.filter(function (x) { return x.category === c.id; }).length;
        return {
          name: c.name,
          color: c.color,
          count: count,
          pct: total ? Math.round(count * 100 / total) : 0
        };
      })
      .filter(function (c) { return c.count > 0; })
      .sort(function (a, b) { return b.count - a.count; });
  }

  function rateOf(comps, openCount) {
    var total = (comps || []).length;
    var denom = total + openCount;
    return denom ? Math.round(total * 100 / denom) : 0;
  }

  function weekCountOf(comps, today) {
    var start7 = parseDate(addDays(today, -6)).getTime();
    return (comps || []).filter(function (c) { return c.at >= start7; }).length;
  }

  function overview(tasks, comps, cats, today) {
    var counts = countsOf(tasks, today);
    var weekCount = weekCountOf(comps, today);
    var streak = streakOf(comps, today);
    var rate = rateOf(comps, counts.open);
    return {
      counts: counts,
      weekCount: weekCount,
      streak: streak,
      rate: rate,
      cards: [
        { label: '累计完成', value: (comps || []).length },
        { label: '近7天完成', value: weekCount },
        { label: '连续打卡', value: streak + ' 天' },
        { label: '完成率', value: rate + '%' },
        { label: '进行中', value: counts.open },
        { label: '已逾期', value: counts.overdue }
      ],
      days: last7(comps, today),
      catStats: byCategory(cats, comps)
    };
  }

  var stats = {
    countsOf: countsOf,
    streakOf: streakOf,
    last7: last7,
    byCategory: byCategory,
    rateOf: rateOf,
    weekCountOf: weekCountOf,
    overview: overview
  };

  /* ===================== 列表视图（筛选/分组） ===================== */
  function byDatePriority(a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (b.priority || 0) - (a.priority || 0);
  }

  var views = {
    byDatePriority: byDatePriority,
    filterTasks: function (tasks, opt) {
      var o = opt || {};
      var kw = (o.keyword || '').trim().toLowerCase();
      return (tasks || []).filter(function (t) {
        if (o.category && o.category !== 'all' && t.category !== o.category) return false;
        if (o.status === 'active' && t.done) return false;
        if (o.status === 'done' && !t.done) return false;
        if (!kw) return true;
        return (t.title + ' ' + (t.note || '')).toLowerCase().indexOf(kw) >= 0;
      });
    },
    buckets: function (list, today) {
      var tomorrow = addDays(today, 1);
      var g = { overdue: [], today: [], tomorrow: [], future: [], nodate: [], done: [] };
      (list || []).forEach(function (t) {
        if (t.done) g.done.push(t);
        else if (!t.date) g.nodate.push(t);
        else if (t.date < today) g.overdue.push(t);
        else if (t.date === today) g.today.push(t);
        else if (t.date === tomorrow) g.tomorrow.push(t);
        else g.future.push(t);
      });
      g.overdue.sort(byDatePriority);
      g.today.sort(byDatePriority);
      g.tomorrow.sort(byDatePriority);
      g.future.sort(byDatePriority);
      g.done.sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
      return g;
    }
  };

  /* ===================== 到期提醒扫描 ===================== */
  var REMIND_WINDOW = 2 * 3600 * 1000;

  function dueReminders(tasks, notifiedKeys, now, windowMs) {
    var win = windowMs === undefined ? REMIND_WINDOW : windowMs;
    var keys = {};
    (notifiedKeys || []).forEach(function (k) { keys[k] = true; });
    var hits = [];
    (tasks || []).forEach(function (t) {
      if (t.done || !t.remind || !t.date || !t.time) return;
      var due = new Date(t.date + 'T' + t.time + ':00').getTime();
      if (isNaN(due)) return;
      var key = t.id + '@' + t.date + ' ' + t.time;
      if (now >= due && now - due < win && !keys[key]) {
        keys[key] = true;
        hits.push(t);
      }
    });
    return { hits: hits, keys: Object.keys(keys) };
  }

  var reminder = {
    WINDOW: REMIND_WINDOW,
    dueReminders: dueReminders
  };

  /* ===================== 更新（APK 自更新 + 热更新） ===================== */
  // 版本号比较：'1.10.0' > '1.9.9'；缺失段按 0 处理
  function compareVersions(a, b) {
    var pa = String(a || '0').split('.');
    var pb = String(b || '0').split('.');
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var va = parseInt(pa[i], 10) || 0;
      var vb = parseInt(pb[i], 10) || 0;
      if (va > vb) return 1;
      if (va < vb) return -1;
    }
    return 0;
  }

  /**
   * 对比本地与远端版本信息（纯函数，方便测试）
   * local  = { version, versionCode }
   * remote = { version, versionCode, apk, notes, builtAt, size }
   * base   = 更新地址，如 http://192.168.1.5:5173
   */
  function evaluateUpdate(local, remote, base) {
    var remoteCode = Number(remote && remote.versionCode) || 0;
    var localCode = Number(local && local.versionCode) || 0;
    var hasUpdate;
    if (remoteCode && localCode) hasUpdate = remoteCode > localCode;
    else hasUpdate = compareVersions((remote && remote.version) || '0', (local && local.version) || '0') > 0;

    var root = String(base || '').replace(/\/+$/, '');
    var apkName = (remote && remote.apk) || 'workbench-debug.apk';
    return {
      hasUpdate: hasUpdate,
      latestVersion: (remote && remote.version) || '',
      latestCode: remoteCode,
      notes: (remote && remote.notes) || '',
      builtAt: (remote && remote.builtAt) || '',
      size: (remote && remote.size) || 0,
      sha256: (remote && remote.sha256) || '',
      apkFileName: apkName,
      apkUrl: root ? root + '/update/' + apkName : '',
      pageUrl: root ? root + '/update/' : '',
      otaUrl: root ? root + '/ota/latest.json' : ''
    };
  }

  // 把「更新地址」文本框解析成地址列表：一行一个，忽略空行、去掉结尾斜杠、去重、保持顺序
  function parseBases(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var u = line.trim().replace(/\/+$/, '');
      if (u && out.indexOf(u) < 0) out.push(u);
    });
    return out;
  }

  // 规范化「更新日志」：支持数组，或字符串（按行拆、去掉 - / * 前缀）
  function notesOf(remote) {
    var raw = remote && remote.notes;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return raw.map(function (s) { return String(s).trim(); }).filter(Boolean);
    }
    return String(raw)
      .split(/\r?\n/)
      .map(function (s) { return s.replace(/^\s*[-*•]\s*/, '').trim(); })
      .filter(Boolean);
  }

  // 从多个来源里挑出「版本最新」的那个（entries: [{base, remote}]）
  // 版本号相同则按传入顺序取第一个 —— 调用方应把快的源排在前面
  function pickNewest(entries) {
    var best = null;
    (entries || []).forEach(function (e) {
      if (!e || !e.remote) return;
      if (!best) { best = e; return; }
      var c1 = Number(e.remote.versionCode) || 0;
      var c2 = Number(best.remote.versionCode) || 0;
      if (c1 > c2) best = e;
      else if (c1 === c2 && compareVersions(e.remote.version, best.remote.version) > 0) best = e;
    });
    return best;
  }

  return {
    APP_TAG: APP_TAG,
    APP_VERSION: APP_VERSION,
    DEFAULT_UPDATE_BASE: DEFAULT_UPDATE_BASE,
    DATA_VERSION: DATA_VERSION,
    WALLPAPERS: WALLPAPERS,
    wallpaperCss: wallpaperCss,
    wallpaperTargetSize: wallpaperTargetSize,
    getWallpaperDisplayUrl: getWallpaperDisplayUrl,
    revokeWallpaperUrl: revokeWallpaperUrl,
    getWallpaperThumb: getWallpaperThumb,
    setWallpaperThumb: setWallpaperThumb,
    DEFAULT_WHEEL: DEFAULT_WHEEL,
    wheelPick: wheelPick,
    TREE_STAGES: TREE_STAGES,
    treeOf: treeOf,
    PET_RULES: PET_RULES,
    PET_SPECIES: PET_SPECIES,
    PET_STAGES: PET_STAGES,
    petSpecies: petSpecies,
    petStageInfo: petStageInfo,
    petTick: petTick,
    petStage: petStage,
    petGain: petGain,
    petGainXp: petGainXp,
    petCountable: petCountable,
    petGainFromCompletions: petGainFromCompletions,
    petFeed: petFeed,
    petPlay: petPlay,
    petHeal: petHeal,
    petSnapshot: petSnapshot,
    petHatchProgress: petHatchProgress,
    spriteIntent: spriteIntent,
    spriteLine: spriteLine,
    SPRITE_LINES: SPRITE_LINES,
    QUOTES: QUOTES,
    quoteOfDay: quoteOfDay,
    randomQuote: randomQuote,
    AI_DEFAULT_ENDPOINT: AI_DEFAULT_ENDPOINT,
    AI_DEFAULT_MODEL: AI_DEFAULT_MODEL,
    AI_PROMPT: AI_PROMPT,
    coursesFromAiText: coursesFromAiText,
    course: {
      DEFAULT_PERIODS: DEFAULT_PERIODS,
      WEEKDAY_LABELS: WEEKDAY_LABELS,
      COURSE_COLORS: COURSE_COLORS,
      mondayOf: mondayOf,
      weekOf: weekOf,
      coursesOn: coursesOn,
      coursesOnDate: coursesOnDate,
      periodTime: periodTime,
      periodLabel: periodLabel,
      periodsOf: periodsOf,
      periodsToText: periodsToText,
      parsePeriodsText: parsePeriodsText,
      courseWeeksLabel: courseWeeksLabel,
      parseCourseLine: parseCourseLine,
      parseCourseText: parseCourseText
    },
    storage: storage,
    datetime: datetime,
    store: store,
    stats: stats,
    views: views,
    reminder: reminder,
    update: {
      compareVersions: compareVersions,
      evaluate: evaluateUpdate,
      parseBases: parseBases,
      notesOf: notesOf,
      pickNewest: pickNewest
    }
  };
});
