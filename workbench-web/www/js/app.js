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

  /* APK 自更新：读远端 version.json → 比较 → 打开下载页（系统安装器会再确认一次） */
  function checkApkUpdate() {
    var base = (S.getSettings().updateBase || '').trim().replace(/\/+$/, '');
    if (!base) {
      setUpdateState('先填更新地址：电脑上跑 node _tools/serve.js，它打印的局域网地址填到上面。');
      return;
    }
    setUpdateState('正在检查…');
    fetch(base + '/update/version.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (remote) {
        var res = window.WB.update.evaluate(LOCAL_VERSION, remote, base);
        if (!res.hasUpdate) {
          setUpdateState('已是最新版本（' + LOCAL_VERSION.version + '）');
          toast('已是最新版本');
          return;
        }
        setUpdateState('发现新版本 ' + res.latestVersion + '（当前 ' + LOCAL_VERSION.version + '）');
        if (window.confirm('发现新版本 ' + res.latestVersion +
          '\n当前版本 ' + LOCAL_VERSION.version +
          '\n\n现在去下载吗？会用浏览器打开下载页，装完数据保留。')) {
          openUpdatePage(res.pageUrl);
        }
      })
      .catch(function (e) {
        setUpdateState('检查失败：' + e.message + '（确认手机和电脑在同一个 Wi-Fi，且 serve.js 正在运行）');
      });
  }

  /* 热更新：只更新网页层（页面/样式/逻辑），不用重装 APK */
  function checkOtaUpdate() {
    if (!Updater) {
      setUpdateState('热更新只在手机 App（APK）里可用；网页版刷新页面就是最新。');
      return;
    }
    var base = (S.getSettings().updateBase || '').trim().replace(/\/+$/, '');
    if (!base) {
      setUpdateState('先填更新地址');
      return;
    }
    setUpdateState('正在检查热更新…');
    fetch(base + '/ota/latest.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + '（先跑 npm.cmd run ota）');
        return r.json();
      })
      .then(function (remote) {
        if (!remote || !remote.version || !remote.url) throw new Error('latest.json 缺少 version/url');
        return Promise.resolve(Updater.current()).catch(function () { return { version: '' }; }).then(function (cur) {
          if (cur && cur.version === remote.version) {
            setUpdateState('热更新已是最新（' + remote.version + '）');
            toast('热更新已是最新');
            return null;
          }
          setUpdateState('发现热更新 ' + remote.version + '，正在下载…');
          var zipUrl = absolutizeOtaUrl(remote.url, base);
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
    renderStats();
    renderMine();
  }

  /* ===================== 视图切换 ===================== */
  function showView(name) {
    state.view = name;
    ['home', 'tasks', 'stats', 'mine'].forEach(function (v) {
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
    $('fabNew').addEventListener('click', function () { openTaskSheet(null); });
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
    $('checkUpdateBtn').addEventListener('click', checkApkUpdate);
    $('checkOtaBtn').addEventListener('click', checkOtaUpdate);
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

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { checkReminders(); renderAll(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
