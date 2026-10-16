/**
 * 我的工作台 · 界面层（零依赖，纯 DOM）
 * 逻辑全在 js/core.js；这里只做渲染与交互。
 */
(function () {
  'use strict';

  var D = window.WB.datetime;
  var S = window.WB.store;
  var ST = window.WB.stats;
  var V = window.WB.views;
  var R = window.WB.reminder;

  var $ = function (id) { return document.getElementById(id); };
  var ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; });
  }
  function hexA(hex, a) {
    var h = String(hex || '#6B7280').replace('#', '');
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  var state = {
    view: 'home',
    status: 'active',
    category: 'all',
    keyword: '',
    editingId: null
  };

  /* ===================== 提醒能力（网页通知 / APK 本地通知） ===================== */
  var Native = (function () {
    try {
      var C = window.Capacitor;
      return (C && C.Plugins && C.Plugins.LocalNotifications) ? C.Plugins.LocalNotifications : null;
    } catch (e) { return null; }
  })();

  function nativeId(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % 2147483000;
  }

  /* ===================== 更新相关插件 ===================== */
  // 热更新插件（Capacitor Updater）：装进 APK 且 cap sync 之后才存在
  var Updater = (function () {
    try {
      var C = window.Capacitor;
      return (C && C.Plugins && C.Plugins.CapacitorUpdater) ? C.Plugins.CapacitorUpdater : null;
    } catch (e) { return null; }
  })();

  // 用系统浏览器打开链接（下载 APK 用）；没有插件就退回 window.open
  var Browser = (function () {
    try {
      var C = window.Capacitor;
      return (C && C.Plugins && C.Plugins.Browser) ? C.Plugins.Browser : null;
    } catch (e) { return null; }
  })();

  // 自更新插件（本地原生插件 native-plugins/apk-installer）：应用内下载 APK + 拉起系统安装器
  var ApkInstaller = (function () {
    try {
      var C = window.Capacitor;
      return (C && C.Plugins && C.Plugins.ApkInstaller) ? C.Plugins.ApkInstaller : null;
    } catch (e) { return null; }
  })();

  // 当前版本：优先读打包时生成的 www/version.json（APK 里有），取不到就用内联常量
  var LOCAL_VERSION = { version: window.WB.APP_VERSION, versionCode: 0 };

  function loadLocalVersion() {
    try {
      return fetch('version.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.version) {
            LOCAL_VERSION = { version: j.version, versionCode: Number(j.versionCode) || 0 };
          }
        })
        .catch(function () { /* file:// 下取不到，用内联常量 */ });
    } catch (e) {
      return Promise.resolve();
    }
  }

  function setUpdateState(text) {
    var el = $('updateState');
    if (el) el.textContent = text || '';
  }

  function openUpdatePage(url) {
    if (Browser && Browser.open) {
      Browser.open({ url: url }).catch(function () { window.open(url, '_blank'); });
      return;
    }
    window.open(url, '_blank');
  }

  // latest.json 里可能写的是打包机上的 localhost，换成 App 里配置的更新地址
  function absolutizeOtaUrl(url, base) {
    var u = String(url || '');
    if (/^https?:\/\//i.test(u)) {
      return u.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, base);
    }
    return base + '/' + u.replace(/^\/+/, '');
  }

  // 带超时的 JSON 请求（不依赖 AbortController，WebView 与 jsdom 都能跑）
  function fetchJson(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error('超时'));
      }, timeoutMs || 8000);
      fetch(url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (json) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(json);
      }).catch(function (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  // 候选更新源 = 用户填的（优先）+ 内置默认源
  // 这样即使「更新地址」被填成了某个固定/过期的地址（例如某个 commit 固定地址），
  // 也不会漏掉新版本；用户自己填的源永远排在最前面。
  function updateBases() {
    var user = window.WB.update.parseBases(S.getSettings().updateBase);
    var dflt = window.WB.update.parseBases(window.WB.DEFAULT_UPDATE_BASE);
    var out = user.slice();
    dflt.forEach(function (u) { if (out.indexOf(u) < 0) out.push(u); });
    return out;
  }

  // 依次尝试多个更新地址，返回第一个可用的：{ base, json }（热更新用：latest.json 不适合比"谁最新"）
  function fetchFirstJson(bases, pathSuffix, timeoutMs) {
    var i = 0;
    var failed = [];
    function tryNext() {
      if (i >= bases.length) {
        var why = failed.length ? failed.slice(0, 2).join('；') : '没有可用的更新地址';
        return Promise.reject(new Error('所有更新地址都连不上（' + why + '）'));
      }
      var base = bases[i++];
      return fetchJson(base + pathSuffix, timeoutMs).then(function (json) {
        return { base: base, json: json };
      }).catch(function (e) {
        failed.push(base.replace(/^https?:\/\//, '') + ' → ' + e.message);
        return tryNext();
      });
    }
    return tryNext();
  }

  // 同时问所有更新地址，取「版本最新」的那个：{ base, remote, sources }
  // 这样某个 CDN 边缘还缓存着旧版也不影响；版本号相同则用列表里靠前的（通常最快）
  function fetchNewest(bases, pathSuffix, timeoutMs) {
    if (!bases.length) return Promise.reject(new Error('没有配置更新地址'));
    var tasks = bases.map(function (base) {
      return fetchJson(base + pathSuffix, timeoutMs).then(function (json) {
        return { base: base, remote: json };
      }).catch(function () { return null; });
    });
    return Promise.all(tasks).then(function (list) {
      var alive = list.filter(Boolean);
      if (!alive.length) throw new Error('所有更新地址都连不上');
      var best = window.WB.update.pickNewest(alive);
      best.sources = alive.length;
      return best;
    });
  }

  /* APK 自更新：读各源的 version.json → 取最新 → 弹更新弹窗 → 应用内下载安装 */
  function checkApkUpdate() {
    var bases = updateBases();
    if (!bases.length) {
      setUpdateState('先填更新地址：可填多个，一行一个（例如 CDN 地址 + 电脑上 node _tools/serve.js 打印的局域网地址）。');
      return;
    }
    setUpdateState('正在检查（' + bases.length + ' 个地址）…');
    fetchNewest(bases, '/update/version.json')
      .then(function (hit) {
        var res = window.WB.update.evaluate(LOCAL_VERSION, hit.remote, hit.base);
        var from = hit.base.replace(/^https?:\/\//, '') + (hit.sources > 1 ? '（' + hit.sources + ' 个源中最新）' : '');
        if (!res.hasUpdate) {
          setUpdateState('已是最新版本（' + LOCAL_VERSION.version + '）· 源：' + from);
          toast('已是最新版本');
          return;
        }
        setUpdateState('发现新版本 ' + res.latestVersion + '（当前 ' + LOCAL_VERSION.version + '）· 源：' + from);
        res.raw = hit.remote;
        showUpdateModal(res);
      })
      .catch(function (e) {
        setUpdateState('检查失败：' + e.message + '（可在「更新地址」里填多个来源，一行一个）');
      });
  }

  /* 热更新：只更新网页层（页面/样式/逻辑），不用重装 APK */
  function checkOtaUpdate() {
    if (!Updater) {
      setUpdateState('热更新只在手机 App（APK）里可用；网页版刷新页面就是最新。');
      return;
    }
    var bases = updateBases();
    if (!bases.length) {
      setUpdateState('先填更新地址');
      return;
    }
    setUpdateState('正在检查热更新（' + bases.length + ' 个地址）…');
    fetchFirstJson(bases, '/ota/latest.json')
      .then(function (hit) {
        var remote = hit.json;
        if (!remote || !remote.version || !remote.url) throw new Error('latest.json 缺少 version/url');
        return Promise.resolve(Updater.current()).catch(function () { return { version: '' }; }).then(function (cur) {
          if (cur && cur.version === remote.version) {
            setUpdateState('热更新已是最新（' + remote.version + '）· 源：' + hit.base);
            toast('热更新已是最新');
            return null;
          }
          setUpdateState('发现热更新 ' + remote.version + '，正在下载…');
          var zipUrl = absolutizeOtaUrl(remote.url, hit.base);
          return Updater.download({ version: remote.version, url: zipUrl }).then(function (info) {
            setUpdateState('下载完成，正在应用（App 会自动重启）…');
            return Updater.set(info);
          });
        });
      })
      .catch(function (e) {
        setUpdateState('热更新失败：' + e.message);
      });
  }

  /* ===================== 更新弹窗（App 内更新） ===================== */
  var pendingUpdate = null;
  var lastAutoCheck = 0;

  function hideUpdateModal() { $('updateModal').hidden = true; }
  function setUpdHint(text) { $('updHint').textContent = text || ''; }

  function setProgress(pct) {
    $('updProgressWrap').hidden = false;
    $('updProgressFill').style.width = Math.max(0, Math.min(100, pct)) + '%';
    $('updProgressText').textContent = '已下载 ' + Math.round(pct) + '%';
  }

  // 给 Promise 加总超时：某个源卡死也能自动换下一个（原生端仍会把已下载部分留着续传）
  function withTimeout(promise, ms, msg) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        reject(new Error(msg));
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      }, function (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  function showUpdateModal(info) {
    pendingUpdate = info;
    $('updVersion').textContent = 'v' + info.latestVersion + (info.latestCode ? ' (' + info.latestCode + ')' : '');
    var meta = [];
    if (info.size) meta.push((info.size / 1048576).toFixed(2) + ' MB');
    if (info.builtAt) meta.push(String(info.builtAt).replace('T', ' ').slice(0, 16));
    $('updMeta').textContent = meta.join(' · ') + '　（当前 v' + LOCAL_VERSION.version + '）';

    var notes = window.WB.update.notesOf(info.raw);
    $('updNotes').innerHTML = notes.length
      ? notes.map(function (s) { return '<div class="note">' + esc(s) + '</div>'; }).join('')
      : '<div class="tip">本次更新没有写更新日志。</div>';

    $('updProgressWrap').hidden = true;
    $('updProgressFill').style.width = '0%';
    setUpdHint(ApkInstaller
      ? '点「立即更新」会在应用内下载安装包，然后打开系统安装界面（覆盖安装，数据保留）。'
      : '当前不在 App 里，点「立即更新」会用浏览器打开下载页。');
    $('updateModal').hidden = false;
  }

  // 依次用多个源下载安装包（某个源慢/断就换下一个；已下载部分由原生端断点续传）
  function downloadApkWithFallback(info, fileName) {
    var bases = updateBases();
    var urls = [];
    if (info.apkUrl) urls.push(info.apkUrl);   // 先用「报告了最新版本的那个源」
    bases.forEach(function (b) {
      var u = b.replace(/\/+$/, '') + '/update/' + (info.apkFileName || 'workbench-debug.apk');
      if (urls.indexOf(u) < 0) urls.push(u);   // 再用其它源（同一个文件，内容一致）
    });

    var i = 0;
    function tryNext() {
      if (i >= urls.length) return Promise.reject(new Error('所有下载源都没成功，稍后重试'));
      var url = urls[i++];
      setUpdHint('正在下载安装包（第 ' + i + '/' + urls.length + ' 个源，支持断点续传）…');
      setProgress(0);
      return withTimeout(ApkInstaller.download({
        url: url,
        fileName: fileName,
        sha256: info.sha256 || ''
      }), 240000, '这个源 4 分钟没下完').catch(function (e) {
        var msg = (e && e.message) ? e.message : String(e);
        setUpdHint('这个源没成功（' + msg + '），换下一个…');
        return tryNext();
      });
    }
    return tryNext();
  }

  // 应用内下载 + 拉起系统安装器；没有原生插件时退回浏览器下载页
  function runInAppUpdate() {
    var info = pendingUpdate;
    if (!info) return;
    if (!ApkInstaller) { openUpdatePage(info.pageUrl); return; }

    setUpdHint('正在检查安装权限…');
    Promise.resolve(ApkInstaller.canInstall()).then(function (r) {
      if (r && r.allowed === false) {
        setUpdHint('需要先允许「我的工作台」安装应用：已打开系统设置，打开开关后回来再点一次「立即更新」。');
        return ApkInstaller.openInstallSettings().then(function () {
          throw new Error('__need_permission__');
        });
      }
    }).then(function () {
      return downloadApkWithFallback(info, 'workbench-' + info.latestVersion + '.apk');
    }).then(function (res) {
      setUpdHint('下载完成' + (res && res.attempts > 1 ? '（重试 ' + res.attempts + ' 次）' : '') + '，正在打开系统安装界面…');
      return ApkInstaller.install({ path: res && res.path });
    }).then(function (r2) {
      if (r2 && r2.needPermission) {
        setUpdHint('还需要允许安装未知应用：点「立即更新」重试。');
        return;
      }
      $('updProgressWrap').hidden = true;
      setUpdHint('已打开系统安装界面，点「安装」即可完成（覆盖安装，数据保留）。');
    }).catch(function (e) {
      if (e && e.message === '__need_permission__') return;
      setUpdHint('更新失败：' + ((e && e.message) ? e.message : e));
    });
  }

  // 静默检查（启动时 + 回到前台；最多每 6 小时一次），有新版就弹窗
  function checkUpdateAuto(force) {
    var now = Date.now();
    if (!force && now - lastAutoCheck < 6 * 3600 * 1000) return;
    lastAutoCheck = now;
    var bases = updateBases();
    if (!bases.length) return;
    fetchNewest(bases, '/update/version.json', 6000).then(function (hit) {
      var res = window.WB.update.evaluate(LOCAL_VERSION, hit.remote, hit.base);
      res.raw = hit.remote;
      if (!res.hasUpdate) return;
      if (S.getSettings().ignoredVersion === res.latestVersion) return;
      showUpdateModal(res);
    }).catch(function () { /* 静默失败，不打扰 */ });
  }

  // APK 内：把带提醒的任务写进系统定时通知（关掉 App 也能收到）
  function syncNativeNotifications() {
    if (!Native) return;
    var list = S.getTasks().filter(function (t) {
      return !t.done && t.remind && t.date && t.time;
    });
    Promise.resolve(Native.getPending()).then(function (pending) {
      var old = (pending && pending.notifications) || [];
      if (!old.length) return null;
      return Native.cancel({ notifications: old.map(function (n) { return { id: n.id }; }) });
    }).then(function () {
      var now = Date.now();
      var items = list.map(function (t) {
        return {
          id: nativeId(t.id + '@' + t.date + ' ' + t.time),
          title: '⏰ 任务提醒',
          body: t.title + (t.time ? '（' + t.time + '）' : ''),
          schedule: { at: new Date(t.date + 'T' + t.time + ':00') }
        };
      }).filter(function (n) { return n.schedule.at.getTime() > now; });
      if (!items.length) return null;
      return Native.schedule({ notifications: items });
    }).catch(function (e) { console.warn('native notification sync failed', e); });
  }

  function notify(title, body) {
    toast(title + ' ' + String(body).split('\n')[0]);
    try {
      if (window.Notification && window.Notification.permission === 'granted') {
        new window.Notification(title, { body: body, icon: 'icons/icon-192.png' });
      }
    } catch (e) { /* 通知失败不影响页面提醒 */ }
  }

  function checkReminders() {
    if (!S.getSettings().notify) return;
    var res = R.dueReminders(S.getTasks(), S.getNotifiedKeys(), Date.now());
    if (!res.hits.length) return;
    S.saveNotifiedKeys(res.keys);
    var lines = res.hits.slice(0, 5).map(function (t) { return '「' + t.title + '」' + t.time; });
    var body = lines.join('\n') + (res.hits.length > 5 ? '\n…等共 ' + res.hits.length + ' 项' : '');
    notify('⏰ 任务提醒', body);
  }

  /* ===================== 通用 UI ===================== */
  var toastTimer = null;
  function toast(msg) {
    var el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2000);
  }

  function taskCardHtml(t, cats) {
    var cat = null;
    for (var i = 0; i < cats.length; i++) if (cats[i].id === t.category) cat = cats[i];
    if (!cat) cat = { id: 'other', name: '其他', color: '#6B7280' };
    var repeatLabel = { daily: '每天', weekly: '每周', monthly: '每月' }[t.repeat] || '';
    var dateText = (t.done && t.doneAt) ? ('完成于 ' + D.fmtTime(t.doneAt)) : D.dateLabel(t.date);
    var overdue = !t.done && D.isOverdue(t.date);
    var pcls = ['p-low', 'p-mid', 'p-high'][t.priority] || 'p-mid';
    return '<div class="tcard' + (t.done ? ' is-done' : '') + '">' +
      '<button class="check ' + pcls + (t.done ? ' checked' : '') + '" data-act="toggle" data-id="' + esc(t.id) + '">' + (t.done ? '✓' : '') + '</button>' +
      '<div class="main" data-act="edit" data-id="' + esc(t.id) + '">' +
        '<div class="title-line"><span class="title">' + esc(t.title) + '</span>' +
          (repeatLabel && !t.done ? '<span class="repeat">🔁 ' + repeatLabel + '</span>' : '') +
        '</div>' +
        '<div class="meta">' +
          '<span class="cat" style="color:' + esc(cat.color) + ';background:' + hexA(cat.color, 0.12) + '">' + esc(cat.name) + '</span>' +
          (dateText ? '<span class="date' + (overdue ? ' is-overdue' : '') + '">' + (overdue ? '已逾期 · ' : '') + esc(dateText) + '</span>' : '') +
          (t.time && !t.done ? '<span class="time">⏰ ' + esc(t.time) + '</span>' : '') +
          (t.priority === 2 && !t.done ? '<span class="urgent">🔥 紧急</span>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function groupsHtml(groups, cats) {
    var html = '';
    groups.forEach(function (g) {
      if (!g.tasks.length) return;
      html += '<div class="group-title' + (g.danger ? ' danger' : '') + '">' + esc(g.title) + '</div>';
      g.tasks.forEach(function (t) { html += taskCardHtml(t, cats); });
    });
    return html;
  }

  function emptyHtml(icon, text, sub) {
    return '<div class="empty card"><div class="empty-icon">' + icon + '</div>' +
      '<div class="empty-text">' + esc(text) + '</div>' +
      (sub ? '<div class="empty-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  /* ===================== 各页渲染 ===================== */
  function renderTop() {
    $('topSub').textContent = D.fullDateText();
  }

  function renderHome() {
    var tasks = S.getTasks();
    var comps = S.getCompletions();
    var cats = S.getCategories();
    var today = D.todayStr();
    var settings = S.getSettings();

    var active = tasks.filter(function (t) { return !t.done; });
    var overdue = active.filter(function (t) { return t.date && t.date < today; });
    var todays = active.filter(function (t) { return t.date === today; });
    var upcomingAll = active.filter(function (t) { return t.date && t.date > today; }).sort(V.byDatePriority);
    var inbox = active.filter(function (t) { return !t.date; });
    var doneToday = comps.filter(function (c) { return D.toDateStr(new Date(c.at)) === today; }).length;

    $('homeGreet').textContent = D.greeting() + '，' + (settings.nickname || '我');
    $('homeDate').textContent = D.fullDateText();
    $('homeTodo').textContent = todays.length;
    $('homeDone').textContent = doneToday;
    var od = $('homeOverdue');
    od.textContent = overdue.length;
    od.className = 'num' + (overdue.length ? ' warn' : '');

    var groups = [
      { title: '⚠️ 已逾期 · ' + overdue.length, tasks: overdue.sort(V.byDatePriority), danger: true },
      { title: '今天 · ' + todays.length, tasks: todays.sort(V.byDatePriority) },
      { title: '即将到来 · ' + upcomingAll.length, tasks: upcomingAll.slice(0, 8) },
      { title: '没有日期 · ' + inbox.length, tasks: inbox }
    ];
    var html = groupsHtml(groups, cats);
    if (!html) html = emptyHtml('🌤️', '还没有任务', '用上面的输入框快速记一件事，或点右下角 ＋ 新建详细任务');
    $('homeGroups').innerHTML = html;
  }

  function renderTasks() {
    var cats = S.getCategories();
    var today = D.todayStr();
    var list = V.filterTasks(S.getTasks(), {
      status: state.status,
      category: state.category,
      keyword: state.keyword
    });

    // 状态分段
    Array.prototype.forEach.call($('statusSeg').children, function (btn) {
      btn.className = 'seg-item' + (btn.dataset.status === state.status ? ' on' : '');
    });

    // 分类胶囊
    var chips = '<button class="chip' + (state.category === 'all' ? ' on' : '') + '" data-cat="all">全部</button>';
    cats.forEach(function (c) {
      chips += '<button class="chip' + (state.category === c.id ? ' on' : '') + '" data-cat="' + esc(c.id) + '">' + esc(c.name) + '</button>';
    });
    $('catChips').innerHTML = chips;
    $('searchClear').hidden = !state.keyword;

    var groups;
    if (state.status === 'done') {
      var doneList = list.slice().sort(function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); });
      groups = [{ title: '已完成 · ' + doneList.length, tasks: doneList }];
    } else {
      var g = V.buckets(list, today);
      groups = [
        { title: '⚠️ 已逾期 · ' + g.overdue.length, tasks: g.overdue, danger: true },
        { title: '今天 · ' + g.today.length, tasks: g.today },
        { title: '明天 · ' + g.tomorrow.length, tasks: g.tomorrow },
        { title: '以后 · ' + g.future.length, tasks: g.future },
        { title: '无日期 · ' + g.nodate.length, tasks: g.nodate }
      ];
      if (state.status === 'all' && g.done.length) {
        groups.push({ title: '已完成 · ' + g.done.length, tasks: g.done });
      }
    }

    $('tasksCount').textContent = list.length ? ('共 ' + list.length + ' 项 · 点按卡片编辑，圆点勾选完成') : '';
    var html = groupsHtml(groups, cats);
    if (!html) {
      html = state.keyword
        ? emptyHtml('🔍', '没有匹配「' + state.keyword + '」的任务', '换个关键词试试')
        : emptyHtml('🗂️', '这里还没有任务', '点右下角 ＋ 新建一个吧');
    }
    $('taskGroups').innerHTML = html;
  }

  function renderStats() {
    var today = D.todayStr();
    var o = ST.overview(S.getTasks(), S.getCompletions(), S.getCategories(), today);

    $('statCards').innerHTML = o.cards.map(function (c) {
      return '<div class="stat-card"><div class="v">' + esc(c.value) + '</div><div class="l">' + esc(c.label) + '</div></div>';
    }).join('');

    $('bars').innerHTML = o.days.map(function (d) {
      return '<div class="bar-col">' +
        '<div class="bar-count">' + (d.count ? d.count : '') + '</div>' +
        '<div class="bar-track"><div class="bar' + (d.count ? '' : ' zero') + '" style="height:' + d.h + '%"></div></div>' +
        '<div class="bar-label">' + esc(d.label) + '</div>' +
      '</div>';
    }).join('');

    if (o.catStats.length) {
      $('catStats').innerHTML = o.catStats.map(function (c) {
        return '<div class="cat-row">' +
          '<div class="cat-name"><span class="dot" style="background:' + esc(c.color) + '"></span>' + esc(c.name) + '</div>' +
          '<div class="cat-bar"><div class="cat-fill" style="width:' + c.pct + '%;background:' + esc(c.color) + '"></div></div>' +
          '<div class="cat-num">' + c.count + ' · ' + c.pct + '%</div>' +
        '</div>';
      }).join('');
    } else {
      $('catStats').innerHTML = '<div class="empty-small">完成第一个任务后，这里会展示数据</div>';
    }
  }

  function renderMine() {
    var s = S.getSettings();
    var name = s.nickname || '我';
    $('mineName').textContent = name;
    $('mineAvatar').textContent = Array.from(name)[0] || '我';

    var cats = S.getCategories();
    $('catList').innerHTML = cats.map(function (c) {
      return '<div class="cat-item">' +
        '<span class="dot" style="background:' + esc(c.color) + '"></span>' +
        '<span class="cat-name">' + esc(c.name) + '</span>' +
        '<button class="cat-del" data-act="delCat" data-id="' + esc(c.id) + '">删除</button>' +
      '</div>';
    }).join('');

    $('storageState').textContent = window.WB.storage.persistent
      ? '数据存在本机浏览器（localStorage），清浏览器数据会丢失，建议定期导出。'
      : '当前环境不允许本地持久化（可能是 file:// 的隐私限制），数据只存在内存里，关掉页面就没了——请用 _tools/serve.js 起本地服务打开，或装成 APK。';
    renderNotifyState();

    // 版本 / 更新地址
    $('confirmDoneSwitch').checked = s.confirmDone !== false;
    $('versionLine').textContent = LOCAL_VERSION.version + (LOCAL_VERSION.versionCode ? ' (' + LOCAL_VERSION.versionCode + ')' : '');
    var ub = $('updateBaseInput');
    if (document.activeElement !== ub) ub.value = s.updateBase || '';
    $('appFooter').textContent = '我的工作台 · v' + LOCAL_VERSION.version + (Native ? ' · App' : ' · 网页版');

    renderWallpaperGrid();
    applyWallpaper();
  }

  /* ===================== 壁纸 ===================== */
  function renderWallpaperGrid() {
    var s = S.getSettings();
    var cur = s.wallpaper || '';
    var custom = S.getWallpaperImage();
    var items = [{ id: '', name: '无', none: true }].concat(window.WB.WALLPAPERS);
    if (custom) items.push({ id: 'custom', name: '我的', image: 'url("' + custom + '")' });

    $('wpGrid').innerHTML = items.map(function (p) {
      var bg = '';
      if (p.image) bg = (p.image.indexOf('url(') === 0 || p.image.indexOf('linear-gradient') === 0)
        ? 'background-image:' + p.image
        : 'background-image:url("' + p.image + '")';
      var cls = 'wp-item' + (p.none ? ' none' : '') + (cur === p.id ? ' on' : '');
      return '<button class="' + cls + '" data-wp="' + esc(p.id) + '" style="' + bg + '">' + esc(p.name) + '</button>';
    }).join('');
  }

  function applyWallpaper() {
    var s = S.getSettings();
    var w = window.WB.wallpaperCss(s, S.getWallpaperImage());
    var layer = $('wallpaperLayer');
    var dim = $('wallpaperDim');

    if (w.image) {
      layer.hidden = false;
      layer.style.backgroundImage = w.image;
      dim.hidden = false;
      dim.style.background = 'rgba(12,16,24,' + (w.dim / 100) + ')';
      document.body.classList.add('wb-wallpaper');
    } else {
      layer.hidden = true;
      layer.style.backgroundImage = '';
      dim.hidden = true;
      document.body.classList.remove('wb-wallpaper');
    }

    var slider = $('wpDim');
    if (slider) slider.value = String(w.dim);
    $('wpDimVal').textContent = w.dim + '%';
    $('wpState').textContent = w.kind === 'custom'
      ? '当前：我的照片（存在本机，删掉 App 数据会丢）'
      : (w.kind === 'preset' ? '当前：内置壁纸' : '当前：默认背景');
  }

  function pickWallpaper(id) {
    if (id === 'custom' && !S.getWallpaperImage()) { $('wpFile').click(); return; }
    S.saveSettings({ wallpaper: id || '' });
    renderWallpaperGrid();
    applyWallpaper();
    toast(id ? '壁纸已更换' : '已恢复默认背景');
  }

  // 选照片 → 压缩后再存（localStorage 空间有限）
  function onWallpaperFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast('请选择图片文件'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      function save(data, note) {
        S.setWallpaperImage(data);
        S.saveSettings({ wallpaper: 'custom' });
        renderWallpaperGrid();
        applyWallpaper();
        toast('壁纸已更新' + (note ? '（' + note + '）' : ''));
      }
      var img = new Image();
      img.onload = function () {
        try {
          var maxW = 1080;
          var scale = Math.min(1, maxW / (img.width || maxW));
          var cw = Math.max(1, Math.round((img.width || maxW) * scale));
          var ch = Math.max(1, Math.round((img.height || maxW) * scale));
          var cv = document.createElement('canvas');
          cv.width = cw;
          cv.height = ch;
          var ctx = cv.getContext('2d');
          if (!ctx) throw new Error('no-canvas');
          ctx.drawImage(img, 0, 0, cw, ch);
          var data = cv.toDataURL('image/jpeg', 0.82);
          if (data.length > 2400000) { toast('这张图压完还是太大，换一张小点的吧'); return; }
          save(data, Math.round(data.length / 1024) + 'KB');
        } catch (e) {
          // 环境不支持 canvas 时退回原图（可能较大，但能用）
          var raw = reader.result;
          if (raw && raw.length > 2400000) { toast('这张图太大，换一张小点的吧'); return; }
          save(raw, '');
        }
      };
      img.onerror = function () { toast('这张图片读不了，换一张试试'); };
      img.src = reader.result;
    };
    reader.onerror = function () { toast('读取图片失败'); };
    reader.readAsDataURL(file);
  }

  function renderNotifyState() {
    var el = $('notifyState');
    if (Native) { el.textContent = '当前运行在 App（APK）里，使用系统定时通知。'; return; }
    if (!window.Notification) { el.textContent = '当前浏览器不支持系统通知，只在页面内弹提示。'; return; }
    el.textContent = '浏览器通知权限：' + window.Notification.permission;
  }

  function renderAll() {
    renderTop();
    renderHome();
    renderTasks();
    renderCourse();
    renderStats();
    renderMine();
    applyAppearance();
  }

  /* ===================== 课表 ===================== */
  var C = window.WB.course;
  var cwOffset = 0;             // 相对「本周」的偏移（周）
  var courseEditingId = null;
  var coursePickColor = null;
  var importPreview = null;

  function shortTime(t) { return String(t || '').split('-')[0] || ''; }
  function fmtMD(dateStr) {
    var d = D.parseDate(dateStr);
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  function courseWeekInfo() {
    var s = S.getSettings();
    var monday = D.addDays(C.mondayOf(D.todayStr()), cwOffset * 7);
    var termStart = s.termStart || '';
    var weekNo = termStart ? C.weekOf(monday, termStart) : (cwOffset + 1);
    return { monday: monday, sunday: D.addDays(monday, 6), weekNo: weekNo, termStart: termStart };
  }

  function renderCourse() {
    var s = S.getSettings();
    var info = courseWeekInfo();
    var courses = S.getCourses();
    var weekend = s.courseWeekend !== false;
    var periods = C.periodsOf(s);
    var days = weekend ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5];

    var maxPeriod = 8;
    courses.forEach(function (c) { maxPeriod = Math.max(maxPeriod, Number(c.endPeriod) || 0); });
    maxPeriod = Math.min(12, maxPeriod);

    var todayWd = D.parseDate(D.todayStr()).getDay();
    todayWd = todayWd === 0 ? 7 : todayWd;

    var html = ['<div class="cg-corner"></div>'];
    days.forEach(function (d) {
      html.push('<div class="cg-day' + (d === todayWd && cwOffset === 0 ? ' today' : '') + '">' + C.WEEKDAY_LABELS[d - 1] + '</div>');
    });
    for (var p = 1; p <= maxPeriod; p++) {
      html.push('<div class="cg-period" style="grid-row:' + (p + 1) + '; grid-column:1"><b>' + p + '</b><span>' + shortTime(C.periodTime(p, periods)) + '</span></div>');
      days.forEach(function (d, di) {
        html.push('<div class="cg-empty" style="grid-row:' + (p + 1) + '; grid-column:' + (di + 2) + '"></div>');
      });
    }
    courses.forEach(function (c) {
      var di = days.indexOf(Number(c.weekday));
      if (di < 0) return;
      if (!C.coursesOn([c], c.weekday, info.weekNo).length) return;   // 这一周不上
      var sp = Math.max(1, Number(c.startPeriod) || 1);
      if (sp > maxPeriod) return;
      var ep = Math.min(maxPeriod, Math.max(sp, Number(c.endPeriod) || sp));
      var span = ep - sp + 1;
      html.push('<div class="cg-course" data-course="' + esc(c.id) + '" style="grid-row:' + (sp + 1) + ' / span ' + span +
        '; grid-column:' + (di + 2) + '; background:' + esc(c.color || '#4C6EF5') + '">' +
        '<b>' + esc(c.name) + '</b>' + (c.room ? '<span>' + esc(c.room) + '</span>' : '') + '</div>');
    });

    var grid = $('courseGrid');
    grid.className = 'cg' + (weekend ? '' : ' no-weekend');
    grid.innerHTML = html.join('');

    $('cwLabel').textContent = info.termStart
      ? ('第 ' + info.weekNo + ' 周')
      : (cwOffset === 0 ? '本周' : (cwOffset > 0 ? cwOffset + ' 周后' : (-cwOffset) + ' 周前'));
    $('cwRange').textContent = fmtMD(info.monday) + ' - ' + fmtMD(info.sunday);
    $('cwTermStart').value = info.termStart || '';
    $('cwWeekend').textContent = weekend ? '隐藏周末' : '显示周末';
    $('courseHint').textContent = info.termStart
      ? '学期首周：' + info.termStart + '（单双周按周次准确判断）'
      : '还没设「学期首周」，单双周暂时按当前这周 = 第 1 周算；点上面按钮填一下更准。';

    var today = D.todayStr();
    var todays = C.coursesOnDate(courses, today, info.termStart);
    $('courseTodayLabel').textContent = D.dateLabel(today) + ' ' + C.WEEKDAY_LABELS[(D.parseDate(today).getDay() + 6) % 7];
    $('courseToday').innerHTML = todays.length
      ? todays.map(function (c) {
          return '<div class="course-item" data-course="' + esc(c.id) + '">' +
            '<span class="ci-color" style="background:' + esc(c.color || '#4C6EF5') + '"></span>' +
            '<div class="ci-main">' +
              '<div class="ci-name">' + esc(c.name) + '</div>' +
              '<div class="tip">' + C.periodLabel(c) + ' · ' + esc(C.periodTime(c.startPeriod, periods)) +
                (c.room ? ' · ' + esc(c.room) : '') + (c.teacher ? ' · ' + esc(c.teacher) : '') + '</div>' +
            '</div>' +
          '</div>';
        }).join('')
      : '<div class="tip">今天没有课 🎉</div>';
  }

  function fillCourseWeekdays(sel) {
    $('cWeekdays').innerHTML = C.WEEKDAY_LABELS.map(function (n, i) {
      return '<button class="opt' + (i + 1 === Number(sel) ? ' on' : '') + '" data-act="pickWeekday" data-v="' + (i + 1) + '">' + n + '</button>';
    }).join('');
  }

  function fillCourseColors(sel) {
    $('cColors').innerHTML = C.COURSE_COLORS.map(function (c) {
      return '<button class="swatch' + (c === sel ? ' on' : '') + '" data-act="pickColor" data-v="' + c + '" style="background:' + c + '"></button>';
    }).join('');
  }

  function currentCourseWeekday() {
    var on = $('cWeekdays').querySelector('.opt.on');
    return on ? Number(on.dataset.v) : 1;
  }

  function openCourseSheet(id, preset) {
    var c = null;
    if (id) c = S.getCourses().filter(function (x) { return x.id === id; })[0] || null;
    courseEditingId = c ? c.id : null;
    var data = c || Object.assign({
      name: '', teacher: '', room: '', weekday: 1, startPeriod: 1, endPeriod: 2,
      weekFrom: 1, weekTo: 20, parity: 'all'
    }, preset || {});

    $('courseSheetTitle').textContent = c ? '编辑课程' : '添加课程';
    $('cName').value = data.name || '';
    $('cRoom').value = data.room || '';
    $('cTeacher').value = data.teacher || '';
    $('cStart').value = String(data.startPeriod || 1);
    $('cEnd').value = String(data.endPeriod || 2);
    $('cWeekFrom').value = String(data.weekFrom || 1);
    $('cWeekTo').value = String(data.weekTo || 20);
    $('cParity').value = data.parity || 'all';
    coursePickColor = data.color || C.COURSE_COLORS[0];
    fillCourseWeekdays(data.weekday || 1);
    fillCourseColors(coursePickColor);
    $('cDelete').hidden = !c;
    $('cSave').textContent = c ? '保存修改' : '添加课程';
    openSheet('course');
  }

  function saveCourseForm() {
    var name = ($('cName').value || '').trim();
    if (!name) { toast('先写课程名'); return; }
    var sp = Math.max(1, Math.min(12, Number($('cStart').value) || 1));
    var ep = Math.max(sp, Math.min(12, Number($('cEnd').value) || sp));
    var patch = {
      name: name,
      room: ($('cRoom').value || '').trim(),
      teacher: ($('cTeacher').value || '').trim(),
      weekday: currentCourseWeekday(),
      startPeriod: sp,
      endPeriod: ep,
      weekFrom: Math.max(1, Number($('cWeekFrom').value) || 1),
      weekTo: Math.max(1, Number($('cWeekTo').value) || 20),
      parity: $('cParity').value || 'all',
      color: coursePickColor || C.COURSE_COLORS[0]
    };
    if (courseEditingId) { S.updateCourse(courseEditingId, patch); toast('已保存'); }
    else { S.addCourse(patch); toast('已添加课程'); }
    closeSheet();
    renderCourse();
  }

  function deleteCourseEditing() {
    if (!courseEditingId) return;
    if (!window.confirm('删除这门课？')) return;
    S.deleteCourse(courseEditingId);
    closeSheet();
    renderCourse();
    toast('已删除');
  }

  function openCourseImport() {
    importPreview = null;
    $('ciText').value = '';
    $('ciPreview').innerHTML = '';
    $('ciDo').disabled = true;
    $('ciDo').textContent = '导入';
    $('aiCfg').hidden = true;
    fillAiConfig();
    openSheet('courseImport');
  }

  function renderImportPreview(r, fromImage) {
    importPreview = r;
    var html = '';
    if (r.courses.length) {
      html += '<div class="tip">' + (fromImage ? 'AI 识别到 ' : '识别到 ') + r.courses.length + ' 门课（确认没问题再点下面的导入）：</div>';
      html += r.courses.map(function (c) {
        return '<div class="ci-preview">' + C.WEEKDAY_LABELS[c.weekday - 1] + ' ' + C.periodLabel(c) + ' · ' + esc(c.name) +
          (c.room ? ' · ' + esc(c.room) : '') + ' · ' + C.courseWeeksLabel(c) + '</div>';
      }).join('');
    }
    if (r.errors && r.errors.length) {
      html += '<div class="tip" style="margin-top:10px">有 ' + r.errors.length + ' 行没认出来（可以改改再解析，或手动添加）：</div>';
      html += r.errors.map(function (e) {
        return '<div class="ci-error">第 ' + e.line + ' 行：' + esc(e.text) + '</div>';
      }).join('');
    }
    if (r.error) html += '<div class="ci-error">' + esc(r.error) + '</div>';
    if (!r.courses.length && !(r.errors && r.errors.length) && !r.error) html = '<div class="tip">还没输入内容。</div>';

    $('ciPreview').innerHTML = html;
    $('ciDo').disabled = !r.courses.length;
    $('ciDo').textContent = r.courses.length ? ('导入这 ' + r.courses.length + ' 门课') : '导入';
  }

  function parseImportText() {
    renderImportPreview(C.parseCourseText($('ciText').value || ''), false);
  }

  /* ---------- 图片识别课表（视觉大模型；Key 只存本机） ---------- */
  function aiKeyOf() { return String(S.getSettings().aiKey || '').trim(); }

  function fillAiConfig() {
    var s = S.getSettings();
    $('aiEndpoint').value = s.aiEndpoint || window.WB.AI_DEFAULT_ENDPOINT;
    $('aiModel').value = s.aiModel || window.WB.AI_DEFAULT_MODEL;
    var key = aiKeyOf();
    $('aiKey').value = key ? ('已保存 ' + '•'.repeat(Math.max(4, Math.min(12, key.length - 4))) + key.slice(-4)) : '';
    $('aiState').textContent = key
      ? '✓ 已配置 AI，可以点「选图片识别」（拍/选一张课表截图）'
      : '还没配置 AI：图片识别需要它；不想配也可以直接用下面的文字导入。';
  }

  function saveAiConfig() {
    var key = ($('aiKey').value || '').trim();
    var patch = {
      aiEndpoint: ($('aiEndpoint').value || '').trim() || window.WB.AI_DEFAULT_ENDPOINT,
      aiModel: ($('aiModel').value || '').trim() || window.WB.AI_DEFAULT_MODEL
    };
    if (!key) patch.aiKey = '';
    else if (key.indexOf('已保存') !== 0 && key.indexOf('•') !== 0) patch.aiKey = key;
    S.saveSettings(patch);
    fillAiConfig();
    toast(aiKeyOf() ? 'AI 配置已保存' : '已清空 AI Key');
  }

  // 压缩图片，避免上传太大、也省流量（解码不出来就直接用原图，绝不卡住）
  function compressImage(dataUrl, maxW, quality, cb) {
    var done = false;
    var timer = setTimeout(function () { finish(dataUrl); }, 1500);
    function finish(out) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(out);
    }
    try {
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, maxW / (img.width || maxW));
          var w = Math.max(1, Math.round((img.width || maxW) * scale));
          var h = Math.max(1, Math.round((img.height || maxW) * scale));
          var cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          var ctx = cv.getContext('2d');
          if (!ctx) throw new Error('no-canvas');
          ctx.drawImage(img, 0, 0, w, h);
          finish(cv.toDataURL('image/jpeg', quality));
        } catch (e) { finish(dataUrl); }
      };
      img.onerror = function () { finish(dataUrl); };
      img.src = dataUrl;
    } catch (e) { finish(dataUrl); }
  }

  function callAiVision(dataUrl) {
    var s = S.getSettings();
    var key = aiKeyOf();
    if (!key) return Promise.reject(new Error('没有配置 AI Key'));
    var body = {
      model: (s.aiModel || window.WB.AI_DEFAULT_MODEL).trim(),
      temperature: 0.1,
      stream: false,
      max_tokens: 4096,        // 课表长，输出容易被截断 → 给足长度，否则 JSON 会缺半截
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: window.WB.AI_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }]
    };
    return fetch((s.aiEndpoint || window.WB.AI_DEFAULT_ENDPOINT).trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.text().then(function (t) {
        if (!r.ok) throw new Error('AI 接口 HTTP ' + r.status + '：' + String(t).slice(0, 140));
        var j = null;
        try { j = JSON.parse(t); } catch (e) { throw new Error('AI 返回不是 JSON'); }
        var c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        if (Array.isArray(c)) c = c.map(function (p) { return p && p.text ? p.text : ''; }).join('');
        if (!c) throw new Error('AI 返回里没有内容');
        return String(c);
      });
    });
  }

  // 测试 AI 是否可用（纯文字的最小请求）——手机上出问题时点它看真实错误
  function testAiConnection() {
    var s = S.getSettings();
    var key = aiKeyOf();
    var endpoint = (s.aiEndpoint || window.WB.AI_DEFAULT_ENDPOINT).trim();
    var model = (s.aiModel || window.WB.AI_DEFAULT_MODEL).trim();
    if (!key) { $('aiState').textContent = '✗ 还没填 API Key'; return; }
    $('aiState').textContent = '正在测试（' + model + '）…';
    var t0 = Date.now();
    withTimeout(fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: model,
        stream: false,
        max_tokens: 8,
        messages: [{ role: 'user', content: '回复一个「好」字' }]
      })
    }).then(function (r) {
      return r.text().then(function (t) {
        var secs = ((Date.now() - t0) / 1000).toFixed(1);
        if (r.ok) {
          $('aiState').textContent = '✓ 连接正常（HTTP ' + r.status + '，' + secs + 's）：' + String(t).replace(/\s+/g, ' ').slice(0, 120);
          toast('AI 连接正常');
        } else {
          $('aiState').textContent = '✗ 接口返回 HTTP ' + r.status + '：' + String(t).replace(/\s+/g, ' ').slice(0, 220);
          toast('AI 返回 HTTP ' + r.status);
        }
        return null;
      });
    }), 40000, '测试超时（40 秒）').catch(function (e) {
      $('aiState').textContent = '✗ 连不上：' + ((e && e.message) ? e.message : String(e)) +
        '（检查手机能否上网 / 接口地址 / Key 是否填对）';
      toast('连不上 AI 接口');
    });
  }

  function onCourseImageFile(file) {
    if (!file) return;
    if (!aiKeyOf()) {
      toast('先点「AI 配置」填一个 Key，图片识别要用它');
      $('aiCfg').hidden = false;
      return;
    }
    if (!/^image\//.test(file.type || '')) { toast('请选一张图片'); return; }

    var reader = new FileReader();
    reader.onload = function () {
      var raw = String(reader.result || '');
      $('ciPreview').innerHTML = '<div class="tip">正在压缩图片…</div>';

      function send(payload) {
        $('ciPreview').innerHTML = '<div class="tip">正在让 AI 读课表（' + Math.round(payload.length / 1024) + 'KB，大概几秒到十几秒）…</div>';
        withTimeout(callAiVision(payload), 90000, '识别超时（90 秒）').then(function (text) {
          var r = window.WB.coursesFromAiText(text);
          renderImportPreview(r, true);
          toast(r.courses.length ? ('识别到 ' + r.courses.length + ' 门课') : (r.error || '没识别出课程'));
        }).catch(function (e) {
          $('ciPreview').innerHTML = '<div class="ci-error">图片识别失败：' +
            esc(e && e.message ? e.message : String(e)) +
            '<br><br>可以：① 点上面「AI 配置 → 测试连接」看具体错误；② 截一张更清晰、只有课表的图；③ 直接用下面的文字导入。</div>';
        });
      }

      compressImage(raw, 1400, 0.85, function (mid) {
        // 图片太大容易被接口拒绝：超过约 1.3MB 再压一次
        if (mid.length > 1400000) compressImage(raw, 1000, 0.7, send);
        else send(mid);
      });
    };
    reader.onerror = function () { toast('读取图片失败（换一张图试试）'); };
    reader.readAsDataURL(file);
  }

  function doCourseImport() {
    if (!importPreview || !importPreview.courses.length) return;
    importPreview.courses.forEach(function (c) { S.addCourse(c); });
    toast('已导入 ' + importPreview.courses.length + ' 门课');
    closeSheet();
    renderCourse();
  }

  /* ===================== 外观：透明度 + 液态玻璃 ===================== */
  function applyAppearance() {
    var s = S.getSettings();
    var op = Number(s.uiOpacity);
    if (!isFinite(op)) op = 100;
    op = Math.max(40, Math.min(100, op));
    var blur = Number(s.glassBlur);
    if (!isFinite(blur)) blur = 18;
    blur = Math.max(0, Math.min(40, blur));

    var root = document.documentElement;
    root.style.setProperty('--card-alpha', (op / 100).toFixed(3));
    root.style.setProperty('--glass-blur', blur + 'px');
    if (s.glass) document.body.classList.add('wb-glass');
    else document.body.classList.remove('wb-glass');

    if ($('opacityRange')) $('opacityRange').value = String(op);
    if ($('opacityVal')) $('opacityVal').textContent = op + '%';
    if ($('glassRange')) $('glassRange').value = String(blur);
    if ($('glassVal')) $('glassVal').textContent = blur + 'px';
    if ($('glassSwitch')) $('glassSwitch').checked = !!s.glass;
  }

  /* ===================== 轮盘 ===================== */
  var WHEEL_COLORS = ['#4C6EF5', '#12B886', '#F59E0B', '#E8590C', '#AE3EC9', '#1C7ED6', '#E03131', '#0CA678', '#7C5CFF', '#F06595'];
  var wheelRot = -Math.PI / 2;
  var wheelSpinning = false;

  function wheelItems() {
    if (S.getSettings().wheelSource === 'tasks') {
      var list = S.getTasks().filter(function (t) { return !t.done; }).map(function (t) { return t.title; });
      return list.length ? list : ['（暂无未完成任务）'];
    }
    var opts = S.getWheelOptions();
    return opts.length ? opts : window.WB.DEFAULT_WHEEL.slice();
  }

  function drawWheel(rot) {
    var cv = $('wheelCanvas');
    if (!cv) return;
    var items = wheelItems();
    var size = Math.min(300, Math.max(200, cv.clientWidth || 260));
    var dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    cv.style.height = size + 'px';
    var ctx = null;
    try { ctx = cv.getContext && cv.getContext('2d'); } catch (e) { ctx = null; }
    if (!ctx) return;          // 环境不支持 canvas 也不影响抽签逻辑

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    var cx = size / 2;
    var cy = size / 2;
    var r = size / 2 - 10;
    var n = items.length;
    var step = Math.PI * 2 / n;

    for (var i = 0; i < n; i++) {
      var a0 = rot + i * step;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a0, a0 + step);
      ctx.closePath();
      ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
      ctx.fill();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a0 + step / 2);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.font = '600 ' + (n > 8 ? 11 : 13) + 'px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
      var label = String(items[i]);
      var maxLen = n > 8 ? 7 : 9;
      if (label.length > maxLen) label = label.slice(0, maxLen) + '…';
      ctx.fillText(label, r - 10, 0);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, 24, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.fill();
    ctx.fillStyle = '#2A3040';
    ctx.font = '700 12px -apple-system,"PingFang SC",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('转', cx, cy);

    ctx.beginPath();
    ctx.moveTo(cx - 10, 2);
    ctx.lineTo(cx + 10, 2);
    ctx.lineTo(cx, 24);
    ctx.closePath();
    ctx.fillStyle = '#E03131';
    ctx.fill();
  }

  function openWheelSheet() {
    var s = S.getSettings();
    $('wheelSource').value = s.wheelSource || 'custom';
    $('wheelOptions').value = S.getWheelOptions().join('\n');
    $('wheelResult').textContent = '';
    openSheet('wheel');
    drawWheel(wheelRot);
  }

  function spinWheel() {
    if (wheelSpinning) return;
    var items = wheelItems();
    if (items.length < 2) { toast('至少要有两个选项'); return; }
    wheelSpinning = true;
    $('wheelResult').textContent = '转起来了…';

    var idx = window.WB.wheelPick(items.length, Math.random());
    var step = Math.PI * 2 / items.length;
    var turns = 4 + Math.floor(Math.random() * 3);
    var start = wheelRot;
    var target = -Math.PI / 2 - (idx + 0.5) * step - turns * Math.PI * 2;
    var delta = target - start;
    var dur = 2600;
    var t0 = Date.now();

    function frame() {
      var p = Math.min(1, (Date.now() - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      wheelRot = start + delta * e;
      drawWheel(wheelRot);
      if (p < 1) {
        window.requestAnimationFrame(frame);
      } else {
        wheelSpinning = false;
        $('wheelResult').textContent = '结果：' + items[idx];
        toast('🎯 ' + items[idx]);
      }
    }
    window.requestAnimationFrame(frame);
  }

  /* ---------- 节次时间（可编辑） ---------- */
  function openPeriodsSheet() {
    $('peText').value = C.periodsToText(C.periodsOf(S.getSettings()));
    openSheet('periods');
  }

  function savePeriods() {
    var list = C.parsePeriodsText($('peText').value || '');
    if (!list.length) { toast('一行都没认出来，格式像这样：1 08:00-08:45'); return; }
    S.saveSettings({ periods: list });
    renderCourse();
    closeSheet();
    toast('已保存 ' + list.length + ' 节的时间');
  }

  function resetPeriods() {
    S.saveSettings({ periods: null });
    $('peText').value = C.periodsToText(null);
    renderCourse();
    toast('已恢复默认作息');
  }

  /* ===================== 视图切换 ===================== */
  function showView(name) {
    state.view = name;
    ['home', 'tasks', 'course', 'stats', 'mine'].forEach(function (v) {
      $('view-' + v).hidden = (v !== name);
    });
    Array.prototype.forEach.call($('tabbar').children, function (btn) {
      btn.className = 'tab' + (btn.dataset.view === name ? ' on' : '');
    });
    $('fabNew').hidden = (name === 'stats' || name === 'mine');
    window.scrollTo(0, 0);
    try { localStorage.setItem('wb_view', name); } catch (e) { /* ignore */ }
  }

  /* ===================== 任务编辑弹层 ===================== */
  var sheetPushed = false;

  function openSheet(which) {
    $('sheetMask').hidden = false;
    $('sheetTask').hidden = (which !== 'task');
    $('sheetImport').hidden = (which !== 'import');
    $('sheetCourse').hidden = (which !== 'course');
    $('sheetCourseImport').hidden = (which !== 'courseImport');
    $('sheetWheel').hidden = (which !== 'wheel');
    $('sheetPeriods').hidden = (which !== 'periods');
    // 让安卓返回键 / 浏览器后退先关掉弹层，而不是直接退出应用
    if (!sheetPushed) {
      try {
        history.pushState({ wbSheet: which }, '');
        sheetPushed = true;
      } catch (e) { /* file:// 下可能不允许，忽略即可 */ }
    }
  }

  function closeSheet(fromPop) {
    $('sheetMask').hidden = true;
    $('sheetTask').hidden = true;
    $('sheetImport').hidden = true;
    $('sheetCourse').hidden = true;
    $('sheetCourseImport').hidden = true;
    $('sheetWheel').hidden = true;
    $('sheetPeriods').hidden = true;
    if (sheetPushed) {
      sheetPushed = false;
      if (!fromPop) {
        try { history.back(); } catch (e) { /* ignore */ }
      }
    }
  }

  function fillCatOptions(selected) {
    var cats = S.getCategories();
    $('fCats').innerHTML = cats.map(function (c) {
      return '<button class="opt' + (c.id === selected ? ' on' : '') + '" data-act="pickCat" data-cat="' + esc(c.id) + '">' +
        '<span class="opt-dot" style="background:' + esc(c.color) + '"></span>' + esc(c.name) + '</button>';
    }).join('');
  }

  function pickPriority(v) {
    Array.prototype.forEach.call($('fPriorities').children, function (b) {
      b.className = 'opt' + (Number(b.dataset.v) === Number(v) ? ' on' : '');
    });
  }

  function currentPriority() {
    var on = $('fPriorities').querySelector('.opt.on');
    return on ? Number(on.dataset.v) : 1;
  }

  function openTaskSheet(id) {
    var cats = S.getCategories();
    var t = null;
    if (id) t = S.getTasks().filter(function (x) { return x.id === id; })[0] || null;
    state.editingId = t ? t.id : null;

    $('sheetTitle').textContent = t ? '编辑任务' : '新建任务';
    $('fSave').textContent = t ? '保存修改' : '创建任务';
    $('fDelete').hidden = !t;
    $('fTitle').value = t ? t.title : '';
    $('fNote').value = t ? (t.note || '') : '';
    $('fDate').value = t ? (t.date || '') : '';
    $('fDate').min = t ? '2000-01-01' : D.todayStr();
    $('fTime').value = t ? (t.time || '') : '';
    $('fRemind').checked = t ? !!t.remind : false;
    $('fRepeat').value = t ? (t.repeat || 'none') : 'none';
    fillCatOptions(t ? t.category : (cats[0] ? cats[0].id : 'other'));
    pickPriority(t ? t.priority : 1);
    openSheet('task');
    setTimeout(function () { $('fTitle').focus(); }, 60);
  }

  function saveTask() {
    var title = ($('fTitle').value || '').trim();
    if (!title) { toast('请填写任务标题'); return; }
    var date = $('fDate').value || '';
    var time = $('fTime').value || '';
    var remind = $('fRemind').checked && !!date && !!time;
    var on = $('fCats').querySelector('.opt.on');
    var payload = {
      title: title,
      note: $('fNote').value || '',
      category: on ? on.dataset.cat : 'other',
      priority: currentPriority(),
      date: date,
      time: time,
      remind: remind,
      repeat: $('fRepeat').value || 'none'
    };
    if (state.editingId) {
      S.updateTask(state.editingId, payload);
      toast('已保存');
    } else {
      S.addTask(payload);
      toast('已创建');
    }
    syncNativeNotifications();
    closeSheet();
    renderAll();
  }

  function deleteEditing() {
    if (!state.editingId) return;
    var t = S.getTasks().filter(function (x) { return x.id === state.editingId; })[0];
    if (!window.confirm('确定删除「' + (t ? t.title : '') + '」吗？')) return;
    S.deleteTask(state.editingId);
    syncNativeNotifications();
    closeSheet();
    renderAll();
    toast('已删除');
  }

  /* ===================== 数据导入导出 ===================== */
  function exportFile() {
    var text = S.exportData();
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'workbench-' + D.todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
    toast('已导出 JSON 文件');
  }

  function copyJson() {
    var text = S.exportData();
    var done = function () { toast('已复制到剪贴板'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败，请用「导出」下载文件'); }
    document.body.removeChild(ta);
  }

  function doImport() {
    var text = ($('importText').value || '').trim();
    if (!text) { toast('先选文件或粘贴 JSON'); return; }
    var r;
    try {
      r = S.importData(text);
    } catch (e) {
      window.alert('导入失败：' + ((e && e.message) || '数据格式不正确'));
      return;
    }
    $('importText').value = '';
    syncNativeNotifications();
    closeSheet();
    renderAll();
    window.alert('导入成功：任务 ' + r.tasks + ' 条，分类 ' + r.categories + ' 个，完成记录 ' + r.completions + ' 条。');
  }

  /* ===================== 事件绑定 ===================== */
  function onAct(act, id, el) {
    if (act === 'toggle') {
      var t = S.getTasks().filter(function (x) { return x.id === id; })[0];
      if (!t) return;
      // 这次点击是「完成」还是「撤销」？重复任务看有没有待回滚的周期
      var isComplete = (t.repeat !== 'none' && t.date) ? !t.lastRoll : !t.done;
      // 完成时二次确认（防误触）；撤销是恢复操作，不拦
      if (isComplete && S.getSettings().confirmDone !== false) {
        if (!window.confirm('把「' + t.title + '」标记为完成？')) return;
      }
      S.toggleDone(id);
      syncNativeNotifications();
      renderAll();
      return;
    }
    if (act === 'edit') {
      openTaskSheet(id);
      return;
    }
    if (act === 'delCat') {
      var cats = S.getCategories();
      if (cats.length <= 1) { toast('至少保留一个分类'); return; }
      var cat = cats.filter(function (c) { return c.id === id; })[0];
      var target = cats.filter(function (c) { return c.id !== id; })[0];
      if (!window.confirm('删除「' + (cat ? cat.name : '') + '」后，该分类下的任务会归入「' + target.name + '」，确定吗？')) return;
      S.deleteCategory(id);
      renderAll();
      return;
    }
    if (act === 'pickCat') {
      Array.prototype.forEach.call($('fCats').children, function (b) { b.className = 'opt'; });
      el.className = 'opt on';
      return;
    }
    if (act === 'pickPriority') {
      pickPriority(el.dataset.v);
    }
  }

  function bind() {
    // 动态区域统一委托
    document.addEventListener('click', function (e) {
      var t = e.target;
      var tab = t.closest ? t.closest('.tab') : null;
      if (tab) { showView(tab.dataset.view); return; }

      var seg = t.closest ? t.closest('.seg-item') : null;
      if (seg) { state.status = seg.dataset.status; renderTasks(); return; }

      var chip = t.closest ? t.closest('.chip') : null;
      if (chip) { state.category = chip.dataset.cat; renderTasks(); return; }

      var act = t.closest ? t.closest('[data-act]') : null;
      if (act) { onAct(act.dataset.act, act.dataset.id, act); return; }
    });

    // 固定按钮
    $('fabNew').addEventListener('click', function () {
      if (state.view === 'course') { openCourseSheet(null); return; }
      openTaskSheet(null);
    });
    $('quickAdd').addEventListener('click', quickAdd);
    $('quickInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') quickAdd(); });
    $('sheetClose').addEventListener('click', closeSheet);
    $('importClose').addEventListener('click', closeSheet);
    $('sheetMask').addEventListener('click', function (e) { if (e.target === $('sheetMask')) closeSheet(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
    window.addEventListener('popstate', function () { if (sheetPushed) closeSheet(true); });
    $('fSave').addEventListener('click', saveTask);
    $('fDelete').addEventListener('click', deleteEditing);
    $('fClearDate').addEventListener('click', function () {
      $('fDate').value = '';
      $('fTime').value = '';
      $('fRemind').checked = false;
    });

    $('searchInput').addEventListener('input', function (e) {
      state.keyword = e.target.value;
      renderTasks();
    });
    $('searchClear').addEventListener('click', function () {
      state.keyword = '';
      $('searchInput').value = '';
      renderTasks();
    });

    $('editNick').addEventListener('click', function () {
      var v = window.prompt('修改昵称', S.getSettings().nickname || '我');
      if (v && v.trim()) { S.saveSettings({ nickname: v.trim() }); renderAll(); }
    });
    $('addCatBtn').addEventListener('click', function () {
      var v = ($('newCatInput').value || '').trim();
      if (!v) { toast('请输入分类名称'); return; }
      if (S.getCategories().some(function (c) { return c.name === v; })) { toast('分类已存在'); return; }
      S.addCategory(v);
      $('newCatInput').value = '';
      renderAll();
    });

    $('notifyPerm').addEventListener('click', function () {
      if (Native) {
        Native.requestPermissions().then(function (r) {
          toast('系统通知权限：' + (r && r.display ? r.display : 'unknown'));
          syncNativeNotifications();
          renderNotifyState();
        }).catch(function () { toast('请求通知权限失败'); });
        return;
      }
      if (window.Notification && window.Notification.requestPermission) {
        window.Notification.requestPermission().then(function (p) {
          toast('通知权限：' + p);
          renderNotifyState();
        });
      } else {
        toast('当前浏览器不支持系统通知');
      }
    });
    $('notifyTest').addEventListener('click', function () {
      notify('⏰ 任务提醒', '这是一条测试通知，看到说明提醒能力已就绪。');
    });

    // 更新
    $('updateBaseSave').addEventListener('click', function () {
      var v = ($('updateBaseInput').value || '').trim().replace(/\/+$/, '');
      S.saveSettings({ updateBase: v });
      $('updateBaseInput').value = v;
      toast(v ? '更新地址已保存' : '已清空更新地址');
    });
    // 壁纸
    $('wpGrid').addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-wp]') : null;
      if (btn) pickWallpaper(btn.getAttribute('data-wp') || '');
    });
    $('wpPickBtn').addEventListener('click', function () { $('wpFile').click(); });
    $('wpFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      onWallpaperFile(f);
      e.target.value = '';
    });
    $('wpClearBtn').addEventListener('click', function () {
      S.saveSettings({ wallpaper: '' });
      renderWallpaperGrid();
      applyWallpaper();
      toast('已恢复默认背景');
    });
    $('wpDim').addEventListener('input', function (e) {
      S.saveSettings({ wallpaperDim: Number(e.target.value) || 0 });
      applyWallpaper();
    });

    // 课表
    $('cwPrev').addEventListener('click', function () { cwOffset -= 1; renderCourse(); });
    $('cwNext').addEventListener('click', function () { cwOffset += 1; renderCourse(); });
    $('cwToday').addEventListener('click', function () { cwOffset = 0; renderCourse(); });
    $('cwWeekend').addEventListener('click', function () {
      S.saveSettings({ courseWeekend: S.getSettings().courseWeekend === false });
      renderCourse();
    });
    $('cwTermBtn').addEventListener('click', function () { $('cwTermRow').hidden = !$('cwTermRow').hidden; });
    $('cwPeriodsBtn').addEventListener('click', openPeriodsSheet);
    $('peClose').addEventListener('click', function () { closeSheet(); });
    $('peSave').addEventListener('click', savePeriods);
    $('peReset').addEventListener('click', resetPeriods);
    $('cwTermStart').addEventListener('change', function (e) {
      S.saveSettings({ termStart: e.target.value || '' });
      renderCourse();
      toast(e.target.value ? '学期首周已设置' : '已清除学期首周');
    });
    $('courseAddBtn').addEventListener('click', function () { openCourseSheet(null); });
    $('courseImportBtn').addEventListener('click', openCourseImport);
    $('courseGrid').addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-course]') : null;
      if (el) openCourseSheet(el.getAttribute('data-course'));
    });
    $('courseToday').addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-course]') : null;
      if (el) openCourseSheet(el.getAttribute('data-course'));
    });
    $('courseClose').addEventListener('click', function () { closeSheet(); });
    $('cSave').addEventListener('click', saveCourseForm);
    $('cDelete').addEventListener('click', deleteCourseEditing);
    $('cWeekdays').addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-act="pickWeekday"]') : null;
      if (!b) return;
      Array.prototype.forEach.call($('cWeekdays').children, function (x) { x.className = 'opt'; });
      b.className = 'opt on';
    });
    $('cColors').addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-act="pickColor"]') : null;
      if (!b) return;
      coursePickColor = b.getAttribute('data-v');
      fillCourseColors(coursePickColor);
    });
    $('ciClose').addEventListener('click', function () { closeSheet(); });
    $('ciParse').addEventListener('click', parseImportText);
    $('ciDo').addEventListener('click', doCourseImport);
    $('ciToggleAi').addEventListener('click', function () { $('aiCfg').hidden = !$('aiCfg').hidden; });
    $('aiSave').addEventListener('click', saveAiConfig);
    $('aiTest').addEventListener('click', testAiConnection);
    $('ciImageBtn').addEventListener('click', function () {
      if (!aiKeyOf()) {
        $('aiCfg').hidden = false;
        fillAiConfig();
        toast('先在下面填一个 AI Key（推荐智谱 glm-4v-flash，有免费额度）');
        return;
      }
      $('ciImage').click();
    });
    $('ciImage').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      onCourseImageFile(f);
      e.target.value = '';
    });

    // 外观
    $('opacityRange').addEventListener('input', function (e) {
      S.saveSettings({ uiOpacity: Number(e.target.value) || 100 });
      applyAppearance();
    });
    $('glassSwitch').addEventListener('change', function (e) {
      S.saveSettings({ glass: !!e.target.checked });
      applyAppearance();
    });
    $('glassRange').addEventListener('input', function (e) {
      S.saveSettings({ glassBlur: Number(e.target.value) || 0 });
      applyAppearance();
    });

    // 轮盘
    $('openWheelBtn').addEventListener('click', openWheelSheet);
    $('wheelClose').addEventListener('click', function () { closeSheet(); });
    $('wheelSpin').addEventListener('click', spinWheel);
    $('wheelSource').addEventListener('change', function (e) {
      S.saveSettings({ wheelSource: e.target.value });
      $('wheelResult').textContent = '';
      drawWheel(wheelRot);
    });
    $('wheelSaveOpts').addEventListener('click', function () {
      S.setWheelOptions(($('wheelOptions').value || '').split(/\r?\n/));
      toast('选项已保存（' + S.getWheelOptions().length + ' 个）');
      drawWheel(wheelRot);
    });
    $('wheelResetOpts').addEventListener('click', function () {
      S.setWheelOptions(window.WB.DEFAULT_WHEEL.slice());
      $('wheelOptions').value = S.getWheelOptions().join('\n');
      drawWheel(wheelRot);
      toast('已恢复默认选项');
    });

    $('checkUpdateBtn').addEventListener('click', checkApkUpdate);
    $('checkOtaBtn').addEventListener('click', checkOtaUpdate);
    // 地址被改坏了一键回到内置源（不用手打长网址）
    $('updateBaseReset').addEventListener('click', function () {
      S.saveSettings({ updateBase: window.WB.DEFAULT_UPDATE_BASE });
      $('updateBaseInput').value = window.WB.DEFAULT_UPDATE_BASE;
      toast('已恢复内置的 ' + window.WB.update.parseBases(window.WB.DEFAULT_UPDATE_BASE).length + ' 个更新源');
    });

    // 更新弹窗
    $('updInstall').addEventListener('click', runInAppUpdate);
    $('updClose').addEventListener('click', hideUpdateModal);
    $('updLater').addEventListener('click', hideUpdateModal);
    $('updIgnore').addEventListener('click', function () {
      if (pendingUpdate) {
        S.saveSettings({ ignoredVersion: pendingUpdate.latestVersion });
        toast('已忽略 v' + pendingUpdate.latestVersion);
      }
      hideUpdateModal();
    });
    $('updateModal').addEventListener('click', function (e) {
      if (e.target === $('updateModal')) hideUpdateModal();
    });
    if (ApkInstaller && ApkInstaller.addListener) {
      try {
        ApkInstaller.addListener('progress', function (d) {
          if (d && typeof d.progress === 'number') setProgress(d.progress);
        });
      } catch (e) { /* 拿不到进度也不影响更新 */ }
    }
    $('confirmDoneSwitch').addEventListener('change', function (e) {
      var on = !!e.target.checked;
      S.saveSettings({ confirmDone: on });
      toast(on ? '已开启完成二次确认' : '已关闭完成二次确认');
    });

    $('exportBtn').addEventListener('click', exportFile);
    $('copyBtn').addEventListener('click', copyJson);
    $('importBtn').addEventListener('click', function () { $('importText').value = ''; openSheet('import'); });
    $('importFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { $('importText').value = String(reader.result || ''); toast('已读取文件，点下面按钮导入'); };
      reader.readAsText(f);
    });
    $('importDo').addEventListener('click', doImport);

    $('clearBtn').addEventListener('click', function () {
      if (!window.confirm('将删除全部任务与完成记录，且无法恢复。确定吗？')) return;
      if (!window.confirm('真的要清空吗？')) return;
      S.clearAll();
      syncNativeNotifications();
      renderAll();
      toast('已清空');
    });

    // 安装到桌面（支持 beforeinstallprompt 的浏览器）
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      state.deferredInstall = e;
      $('btnInstall').hidden = false;
    });
    $('btnInstall').addEventListener('click', function () {
      var ev = state.deferredInstall;
      if (!ev) { $('btnInstall').hidden = true; return; }
      ev.prompt();
      state.deferredInstall = null;
      $('btnInstall').hidden = true;
    });
  }

  function quickAdd() {
    var input = $('quickInput');
    var title = (input.value || '').trim();
    if (!title) { toast('先写点内容吧'); return; }
    S.addTask({ title: title, date: D.todayStr() });
    input.value = '';
    renderAll();
    toast('已添加');
  }

  /* ===================== 启动 ===================== */
  function boot() {
    S.getCategories(); // 首次运行写入默认分类

    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* 离线缓存失败不影响使用 */ });
      });
    }

    bind();
    renderAll();
    loadLocalVersion().then(function () { renderMine(); });

    // 热更新：告诉插件「这个 bundle 正常启动」，否则它会把我们回滚掉
    if (Updater && Updater.notifyAppReady) {
      try {
        var ready = Updater.notifyAppReady();
        if (ready && ready.catch) ready.catch(function () { /* ignore */ });
      } catch (e) { /* ignore */ }
    }

    var saved = null;
    try { saved = localStorage.getItem('wb_view'); } catch (e) { /* ignore */ }
    showView(saved && ['home', 'tasks', 'stats', 'mine'].indexOf(saved) >= 0 ? saved : 'home');

    checkReminders();
    setInterval(checkReminders, 60 * 1000);
    syncNativeNotifications();
    checkUpdateAuto();   // 启动时静默检查更新，有新版就弹窗

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { checkReminders(); renderAll(); checkUpdateAuto(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
