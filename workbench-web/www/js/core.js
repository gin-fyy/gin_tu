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
  var APP_VERSION = '1.1.6';
  // 默认更新地址：打包时内置，装完即可直接「检查更新」。
  // 可以填多个（一行一个）：App 会同时问所有源，取「版本最新的那个」，
  // 这样某个 CDN 边缘还缓存着旧版也不影响；版本号相同时用排在前面的。
  // 后三个是国内可达的 GitHub 加速镜像（实测 3 秒内返回正确版本）。
  var DEFAULT_UPDATE_BASE = [
    'https://cdn.jsdelivr.net/gh/gin-fyy/gin_tu@main/docs',
    'https://ghfast.top/https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs',
    'https://ghproxy.net/https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs',
    'https://gh-proxy.com/https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs',
    'https://raw.githubusercontent.com/gin-fyy/gin_tu/main/docs'
  ].join('\n');

  var KEY_TASKS = 'wb_tasks';
  var KEY_CATEGORIES = 'wb_categories';
  var KEY_COMPLETIONS = 'wb_completions';
  var KEY_SETTINGS = 'wb_settings';
  var KEY_NOTIFIED = 'wb_notified';

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
    comps.push({
      taskId: task.id,
      title: task.title,
      category: task.category,
      priority: task.priority,
      at: Date.now()
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
      { nickname: '打工人', notify: true, updateBase: DEFAULT_UPDATE_BASE, confirmDone: true },
      read(KEY_SETTINGS, {})
    );
  }

  function saveSettings(patch) {
    write(KEY_SETTINGS, Object.assign({}, getSettings(), patch));
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
      notified: KEY_NOTIFIED
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
