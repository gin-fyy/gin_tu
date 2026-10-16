/**
 * 网页版核心逻辑测试：node tests/logic-tests.js
 * 同一套用例跑两种存储模式：内存降级模式 / localStorage 持久化模式。
 */
const assert = require('assert');
const path = require('path');

const CORE = path.resolve(__dirname, '..', 'www', 'js', 'core.js');

function makeFakeLocalStorage() {
  const map = new Map();
  return {
    _map: map,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

function loadCore(ls) {
  if (ls) global.localStorage = ls;
  else delete global.localStorage;
  delete require.cache[require.resolve(CORE)];
  return require(CORE);
}

let pass = 0;
const failures = [];

function suite(label, ls, cases) {
  Object.keys(cases).forEach((name) => {
    const WB = loadCore(ls);
    if (ls) ls._map.clear();
    try {
      cases[name](WB);
      pass++;
      console.log('✓ [' + label + '] ' + name);
    } catch (e) {
      failures.push('[' + label + '] ' + name + ' → ' + (e && e.message));
      console.log('✗ [' + label + '] ' + name + ' → ' + (e && e.message));
    }
  });
}

const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg);
const ok = (v, msg) => assert.ok(v, msg);

function makeCases(mode) {
  const D = (WB) => WB.datetime;
  const S = (WB) => WB.store;
  const cases = {};

  /* ---------------- 存储模式 ---------------- */
  cases['storage: 持久化标记正确'] = (WB) => {
    eq(WB.storage.persistent, mode === 'ls', 'persistent 标记应为 ' + (mode === 'ls'));
  };

  if (mode === 'ls') {
    cases['storage: 重载页面后数据仍在'] = (WB) => {
      WB.store.addTask({ title: '持久化' });
      const reloaded = loadCore(global.localStorage);
      eq(reloaded.store.getTasks().length, 1);
      eq(reloaded.store.getTasks()[0].title, '持久化');
    };
  } else {
    cases['storage: 内存模式重载后数据清空（可预期的降级）'] = (WB) => {
      WB.store.addTask({ title: '临时' });
      const reloaded = loadCore(null);
      eq(reloaded.store.getTasks().length, 0);
    };
  }

  /* ---------------- datetime ---------------- */
  cases['datetime: 格式化与解析'] = (WB) => {
    const d = D(WB);
    eq(d.toDateStr(new Date(2026, 0, 5)), '2026-01-05');
    eq(d.parseDate('2026-01-05').getMonth(), 0);
    eq(d.todayStr(), d.toDateStr(new Date()));
    eq(d.pad(7), '07');
  };

  cases['datetime: addDays 跨月跨年'] = (WB) => {
    const d = D(WB);
    eq(d.addDays('2026-01-31', 1), '2026-02-01');
    eq(d.addDays('2026-03-01', -1), '2026-02-28');
    eq(d.addDays('2025-12-31', 1), '2026-01-01');
  };

  cases['datetime: addMonths 月末夹取'] = (WB) => {
    const d = D(WB);
    eq(d.addMonths('2026-01-31', 1), '2026-02-28');
    eq(d.addMonths('2026-03-31', -1), '2026-02-28');
    eq(d.addMonths('2024-01-31', 1), '2024-02-29');
    eq(d.addMonths('2026-01-15', 1), '2026-02-15');
  };

  cases['datetime: dateLabel 今天/明天/后天'] = (WB) => {
    const d = D(WB);
    const today = d.todayStr();
    eq(d.dateLabel(''), '');
    eq(d.dateLabel(today), '今天');
    eq(d.dateLabel(d.addDays(today, 1)), '明天');
    eq(d.dateLabel(d.addDays(today, 2)), '后天');
    ok(/^\d+月\d+日 周[日一二三四五六]$/.test(d.dateLabel(d.addDays(today, 5))));
  };

  cases['datetime: 逾期判断与展示'] = (WB) => {
    const d = D(WB);
    const today = d.todayStr();
    eq(d.isOverdue(d.addDays(today, -1)), true);
    eq(d.isOverdue(today), false);
    eq(d.isOverdue(''), false);
    const at = d.parseDate(today);
    at.setHours(9, 0, 0, 0);
    ok(/^\d{2}-\d{2} 09:00$/.test(d.fmtTime(at.getTime())));
    ok(d.greeting().length > 0 && d.fullDateText().indexOf('月') > 0);
  };

  /* ---------------- store ---------------- */
  cases['store: addTask 默认值与 trim'] = (WB) => {
    const t = S(WB).addTask({ title: '  写方案  ' });
    eq(t.title, '写方案');
    eq(t.priority, 1);
    eq(t.repeat, 'none');
    eq(t.done, false);
    eq(t.lastRoll, null);
    eq(t.category, 'other');
    ok(t.id && t.createdAt > 0);
    eq(S(WB).getTasks().length, 1);
  };

  cases['store: priority 0 保留、非法值回退'] = (WB) => {
    const s = S(WB);
    eq(s.addTask({ title: 'a', priority: 0 }).priority, 0);
    eq(s.addTask({ title: 'b', priority: 9 }).priority, 1);
    eq(s.addTask({ title: 'c', priority: 2 }).priority, 2);
  };

  cases['store: updateTask 清理 lastRoll'] = (WB) => {
    const s = S(WB);
    const t = s.addTask({ title: 'x', date: '2026-01-31', repeat: 'monthly' });
    s.toggleDone(t.id);
    ok(s.getTasks()[0].lastRoll);
    s.updateTask(t.id, { date: '2026-02-10', repeat: 'monthly' });
    eq(s.getTasks()[0].date, '2026-02-10');
    eq(s.getTasks()[0].lastRoll, null);
    eq(s.updateTask('nope', { title: 'z' }), null);
  };

  cases['store: deleteTask'] = (WB) => {
    const s = S(WB);
    const a = s.addTask({ title: 'a' });
    s.addTask({ title: 'b' });
    s.deleteTask(a.id);
    eq(s.getTasks().length, 1);
    eq(s.getTasks()[0].title, 'b');
  };

  cases['store: 普通任务完成与撤销'] = (WB) => {
    const s = S(WB);
    const t = s.addTask({ title: '普通' });
    s.toggleDone(t.id);
    ok(s.getTasks()[0].done && s.getTasks()[0].doneAt > 0);
    eq(s.getCompletions().length, 1);
    s.toggleDone(t.id);
    eq(s.getTasks()[0].done, false);
    eq(s.getCompletions().length, 0);
  };

  cases['store: 撤销只删自己的记录'] = (WB) => {
    const s = S(WB);
    const a = s.addTask({ title: 'a' });
    const b = s.addTask({ title: 'b' });
    s.toggleDone(a.id);
    s.toggleDone(b.id);
    s.toggleDone(a.id);
    eq(s.getCompletions().length, 1);
    eq(s.getCompletions()[0].taskId, b.id);
  };

  cases['store: 重复任务滚动 + 撤销（不重复计数）'] = (WB) => {
    const s = S(WB), d = D(WB);
    const today = d.todayStr();
    const t = s.addTask({ title: '每日复盘', date: today, repeat: 'daily' });
    s.toggleDone(t.id);
    eq(s.getTasks()[0].date, d.addDays(today, 1));
    eq(s.getTasks()[0].done, false);
    eq(s.getTasks()[0].lastRoll.from, today);
    eq(s.getCompletions().length, 1);
    s.toggleDone(t.id);
    eq(s.getTasks()[0].date, today);
    eq(s.getTasks()[0].lastRoll, null);
    eq(s.getCompletions().length, 0);
    s.toggleDone(t.id);
    eq(s.getCompletions().length, 1);
    eq(s.getTasks()[0].date, d.addDays(today, 1));
  };

  cases['store: weekly / monthly 滚动'] = (WB) => {
    const s = S(WB);
    const w = s.addTask({ title: '周会', date: '2026-01-05', repeat: 'weekly' });
    s.toggleDone(w.id);
    const list = s.getTasks();
    eq(list.filter((t) => t.id === w.id)[0].date, '2026-01-12');
    const m = s.addTask({ title: '月报', date: '2026-01-31', repeat: 'monthly' });
    s.toggleDone(m.id);
    eq(s.getTasks().filter((t) => t.id === m.id)[0].date, '2026-02-28');
    eq(s.getCompletions().length, 2);
  };

  cases['store: 无日期的重复任务按普通任务处理'] = (WB) => {
    const s = S(WB);
    const t = s.addTask({ title: '随手做', repeat: 'daily' });
    s.toggleDone(t.id);
    eq(s.getTasks()[0].done, true);
    eq(s.getTasks()[0].lastRoll, null);
  };

  cases['store: 默认分类与新增'] = (WB) => {
    const s = S(WB);
    eq(s.getCategories().length, 4);
    eq(s.getCategories()[0].id, 'work');
    const id = s.addCategory('健身');
    const cats = s.getCategories();
    eq(cats.length, 5);
    eq(cats[4].name, '健身');
    eq(cats[4].id, id);
    ok(/^#/.test(cats[4].color));
  };

  cases['store: 新增分类不污染默认分类（回归）'] = (WB) => {
    const s = S(WB);
    s.addCategory('健身');
    const reloaded = loadCore(mode === 'ls' ? global.localStorage : null);
    if (mode === 'ls') global.localStorage._map.clear();
    const cats = reloaded.store.getCategories();
    eq(cats.length, 4);
    ok(!cats.some((c) => c.name === '健身'));
    cats.push({ id: 'x', name: 'X' });
    eq(reloaded.store.getCategories().length, 4);
  };

  cases['store: getTasks 返回副本'] = (WB) => {
    const s = S(WB);
    s.addTask({ title: 'a' });
    s.getTasks().push({ id: 'fake', title: 'b' });
    eq(s.getTasks().length, 1);
  };

  cases['store: 删除分类迁移任务'] = (WB) => {
    const s = S(WB);
    const id = s.addCategory('健身');
    const t = s.addTask({ title: '跑步', category: id });
    s.deleteCategory(id);
    eq(s.getCategories().length, 4);
    eq(s.getTasks()[0].category, 'work');
    eq(t.id, s.getTasks()[0].id);
  };

  cases['store: 分类删空回退默认'] = (WB) => {
    const s = S(WB);
    const t = s.addTask({ title: 'x', category: 'other' });
    ['work', 'study', 'life', 'other'].forEach((id) => s.deleteCategory(id));
    eq(s.getCategories().length, 4);
    eq(s.getTasks()[0].category, 'work');
    eq(t.title, 'x');
  };

  cases['store: 设置读写与合并'] = (WB) => {
    const s = S(WB);
    eq(s.getSettings().nickname, '打工人');
    eq(s.getSettings().confirmDone, true); // 完成二次确认默认开启
    s.saveSettings({ nickname: 'Gin' });
    eq(s.getSettings().nickname, 'Gin');
    eq(s.getSettings().notify, true);
    s.saveSettings({ confirmDone: false });
    eq(s.getSettings().confirmDone, false);
    eq(s.getSettings().nickname, 'Gin'); // 其它设置不受影响
  };

  cases['store: 提醒标记只保留 200 条'] = (WB) => {
    const s = S(WB);
    const keys = [];
    for (let i = 0; i < 250; i++) keys.push('k' + i);
    s.saveNotifiedKeys(keys);
    eq(s.getNotifiedKeys().length, 200);
    eq(s.getNotifiedKeys()[0], 'k50');
    eq(s.getNotifiedKeys()[199], 'k249');
  };

  cases['store: 导出/导入往返'] = (WB) => {
    const s = S(WB), d = D(WB);
    const t = s.addTask({ title: '任务A', category: 'study', date: d.todayStr(), repeat: 'daily' });
    s.addTask({ title: '任务B' });
    s.toggleDone(t.id);
    s.addCategory('健身');
    s.saveSettings({ nickname: 'Gin' });
    const text = s.exportData();
    eq(JSON.parse(text).app, 'my-workbench');
    s.clearAll();
    s.saveNotifiedKeys(['old']);
    const r = s.importData(text);
    eq(r.tasks, 2);
    eq(r.categories, 5);
    eq(r.completions, 1);
    eq(s.getTasks().length, 2);
    eq(s.getCategories().length, 5);
    eq(s.getSettings().nickname, 'Gin');
    eq(s.getNotifiedKeys().length, 0);
  };

  cases['store: 导入非法数据报错'] = (WB) => {
    const s = S(WB);
    assert.throws(() => s.importData('不是 json'), /JSON/);
    assert.throws(() => s.importData('{"app":"other","tasks":[]}'), /不是本应用/);
    assert.throws(() => s.importData('{"app":"my-workbench"}'), /tasks/);
  };

  cases['store: clearAll 保留分类与设置'] = (WB) => {
    const s = S(WB);
    const t = s.addTask({ title: 'x' });
    s.toggleDone(t.id);
    s.saveSettings({ nickname: 'Gin' });
    s.clearAll();
    eq(s.getTasks().length, 0);
    eq(s.getCompletions().length, 0);
    eq(s.getCategories().length, 4);
    eq(s.getSettings().nickname, 'Gin');
  };

  /* ---------------- stats ---------------- */
  cases['stats: countsOf'] = (WB) => {
    const d = D(WB), today = d.todayStr();
    eq(WB.stats.countsOf([
      { done: false, date: today },
      { done: false, date: d.addDays(today, -1) },
      { done: false, date: '' },
      { done: true, date: today }
    ], today), { open: 3, overdue: 1, today: 1, done: 1 });
  };

  cases['stats: streakOf 连续打卡'] = (WB) => {
    const d = D(WB), today = d.todayStr();
    const comps = (dates) => dates.map((ds, i) => {
      const x = d.parseDate(ds);
      x.setHours(10, 0, 0, 0);
      return { taskId: 't' + i, category: 'work', at: x.getTime() };
    });
    eq(WB.stats.streakOf(comps([today, d.addDays(today, -1), d.addDays(today, -2)]), today), 3);
    eq(WB.stats.streakOf(comps([today]), today), 1);
    eq(WB.stats.streakOf(comps([d.addDays(today, -1)]), today), 1);
    eq(WB.stats.streakOf(comps([d.addDays(today, -2)]), today), 0);
    eq(WB.stats.streakOf([], today), 0);
  };

  cases['stats: rateOf / weekCountOf'] = (WB) => {
    const d = D(WB), today = d.todayStr();
    const comps = (n, offset) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const x = d.parseDate(d.addDays(today, offset));
        x.setHours(10, 0, 0, 0);
        out.push({ taskId: 't' + i, category: 'work', at: x.getTime() });
      }
      return out;
    };
    eq(WB.stats.rateOf(comps(3, 0), 1), 75);
    eq(WB.stats.rateOf([], 0), 0);
    eq(WB.stats.weekCountOf(comps(1, 0).concat(comps(1, -6)).concat(comps(1, -7)), today), 2);
  };

  cases['stats: last7 结构与归一化'] = (WB) => {
    const d = D(WB), today = d.todayStr();
    const mk = (offset, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const x = d.parseDate(d.addDays(today, offset));
        x.setHours(10, 0, 0, 0);
        out.push({ taskId: 't' + i, category: 'work', at: x.getTime() });
      }
      return out;
    };
    const days = WB.stats.last7(mk(0, 3).concat(mk(-1, 1)), today);
    eq(days.length, 7);
    eq(days[6].label, '今天');
    eq(days[5].label, '昨天');
    eq(days[6].count, 3);
    eq(days[6].h, 100);
    eq(days[5].h, 33);
    eq(days[0].count, 0);
    eq(days[0].h, 4);
  };

  cases['stats: byCategory 过滤零值并倒序'] = (WB) => {
    const d = D(WB), today = d.todayStr();
    const at = d.parseDate(today).getTime() + 3600 * 1000;
    const cats = [
      { id: 'a', name: 'A', color: '#111111' },
      { id: 'b', name: 'B', color: '#222222' },
      { id: 'c', name: 'C', color: '#333333' }
    ];
    const out = WB.stats.byCategory(cats, [
      { taskId: '1', category: 'b', at },
      { taskId: '2', category: 'b', at },
      { taskId: '3', category: 'b', at },
      { taskId: '4', category: 'a', at }
    ]);
    eq(out.length, 2);
    eq(out[0].name, 'B');
    eq(out[0].pct, 75);
    eq(out[1].pct, 25);
  };

  cases['stats: overview 六张卡片'] = (WB) => {
    const d = D(WB), today = d.todayStr();
    const at = d.parseDate(today).getTime();
    const o = WB.stats.overview(
      [{ done: false, date: today }, { done: false, date: d.addDays(today, -3) }],
      [{ taskId: 'a', category: 'work', at }, { taskId: 'b', category: 'work', at: at - 86400000 }],
      [{ id: 'work', name: '工作', color: '#4C6EF5' }],
      today
    );
    eq(o.cards.length, 6);
    eq(o.cards[0], { label: '累计完成', value: 2 });
    eq(o.cards[4], { label: '进行中', value: 2 });
    eq(o.cards[5], { label: '已逾期', value: 1 });
    eq(o.streak, 2);
  };

  /* ---------------- views ---------------- */
  cases['views: filterTasks 状态/分类/关键词'] = (WB) => {
    const tasks = [
      { id: '1', title: '写周报', note: '周五前', category: 'work', done: false, date: '' },
      { id: '2', title: '买牛奶', note: '', category: 'life', done: true, date: '' },
      { id: '3', title: '看论文', note: '周报相关', category: 'study', done: false, date: '' }
    ];
    const f = WB.views.filterTasks;
    eq(f(tasks, { status: 'active' }).length, 2);
    eq(f(tasks, { status: 'done' })[0].id, '2');
    eq(f(tasks, { status: 'all', category: 'work' }).length, 1);
    eq(f(tasks, { status: 'all', keyword: '周报' }).map((t) => t.id), ['1', '3']);
    eq(f(tasks, { status: 'active', keyword: '牛奶' }).length, 0);
  };

  cases['views: buckets 分组与排序'] = (WB) => {
    const d = D(WB), today = d.todayStr();
    const list = [
      { id: 'a', date: d.addDays(today, -1), priority: 1, done: false },
      { id: 'b', date: today, priority: 0, done: false },
      { id: 'c', date: today, priority: 2, done: false },
      { id: 'd', date: d.addDays(today, 1), priority: 1, done: false },
      { id: 'e', date: d.addDays(today, 5), priority: 1, done: false },
      { id: 'f', date: '', priority: 1, done: false },
      { id: 'g', date: today, priority: 1, done: true, doneAt: 111 }
    ];
    const g = WB.views.buckets(list, today);
    eq(g.overdue.map((t) => t.id), ['a']);
    eq(g.today.map((t) => t.id), ['c', 'b']); // 同一天按优先级降序
    eq(g.tomorrow.map((t) => t.id), ['d']);
    eq(g.future.map((t) => t.id), ['e']);
    eq(g.nodate.map((t) => t.id), ['f']);
    eq(g.done.map((t) => t.id), ['g']);
  };

  /* ---------------- 到期提醒 ---------------- */
  cases['reminder: 2 小时窗口内命中且去重'] = (WB) => {
    const d = D(WB), today = d.todayStr();
    const mk = (time) => ({
      id: 'r1', title: '开会', date: today, time: time, remind: true, done: false
    });
    const base = d.parseDate(today).getTime();
    const at = (h, m) => base + h * 3600000 + (m || 0) * 60000;

    // 到期 30 分钟：命中
    let res = WB.reminder.dueReminders([mk('10:00')], [], at(10, 30));
    eq(res.hits.length, 1);
    eq(res.keys.length, 1);

    // 用已提醒标记再扫一次：不再命中
    res = WB.reminder.dueReminders([mk('10:00')], res.keys, at(10, 45));
    eq(res.hits.length, 0);

    // 还没到点 / 超过 2 小时：都不命中
    eq(WB.reminder.dueReminders([mk('10:00')], [], at(9, 30)).hits.length, 0);
    eq(WB.reminder.dueReminders([mk('10:00')], [], at(12, 30)).hits.length, 0);
  };

  cases['reminder: 跳过完成/未开提醒/无时间的任务'] = (WB) => {
    const d = D(WB), today = d.todayStr();
    const base = d.parseDate(today).getTime();
    const now = base + 10 * 3600000;
    const list = [
      { id: '1', title: '已完成', date: today, time: '09:30', remind: true, done: true },
      { id: '2', title: '没开提醒', date: today, time: '09:30', remind: false, done: false },
      { id: '3', title: '没时间', date: today, time: '', remind: true, done: false },
      { id: '4', title: '没日期', date: '', time: '09:30', remind: true, done: false },
      { id: '5', title: '正常', date: today, time: '09:30', remind: true, done: false }
    ];
    const res = WB.reminder.dueReminders(list, [], now);
    eq(res.hits.map((t) => t.id), ['5']);
  };

  /* ---------------- 更新 ---------------- */
  cases['update: compareVersions 版本比较'] = (WB) => {
    const c = WB.update.compareVersions;
    eq(c('1.1.0', '1.1.0'), 0);
    eq(c('1.2.0', '1.1.9'), 1);
    eq(c('1.9.9', '1.10.0'), -1);
    eq(c('2.0', '1.9.9'), 1);
    eq(c('1.1', '1.1.0'), 0);
    eq(c('', '0.0.1'), -1);
  };

  cases['update: evaluate 判定与链接'] = (WB) => {
    const local = { version: '1.1.0', versionCode: 1 };
    const base = 'http://192.168.1.5:5173/';

    let r = WB.update.evaluate(local, { version: '1.1.0', versionCode: 1, apk: 'workbench-debug.apk' }, base);
    eq(r.hasUpdate, false);
    eq(r.pageUrl, 'http://192.168.1.5:5173/update/');
    eq(r.apkUrl, 'http://192.168.1.5:5173/update/workbench-debug.apk');
    eq(r.otaUrl, 'http://192.168.1.5:5173/ota/latest.json');

    r = WB.update.evaluate(local, { version: '1.1.1', versionCode: 2, apk: 'workbench-debug.apk', sha256: 'a'.repeat(64) }, base);
    eq(r.hasUpdate, true);
    eq(r.latestVersion, '1.1.1');
    eq(r.latestCode, 2);
    eq(r.apkFileName, 'workbench-debug.apk');
    eq(r.sha256, 'a'.repeat(64));

    // 远端只有版本号（没 versionCode）时按版本号比较
    r = WB.update.evaluate(local, { version: '1.2.0' }, base);
    eq(r.hasUpdate, true);

    // 两边都有 versionCode 时以 versionCode 为准（更可靠）
    r = WB.update.evaluate({ version: '1.1.0', versionCode: 5 }, { version: '9.9.9', versionCode: 3 }, base);
    eq(r.hasUpdate, false);

    // 没填更新地址 → 链接为空
    r = WB.update.evaluate(local, { version: '2.0.0' }, '');
    eq(r.hasUpdate, true);
    eq(r.pageUrl, '');
  };

  cases['update: parseBases 多地址解析'] = (WB) => {
    const p = WB.update.parseBases;
    eq(p(''), []);
    eq(p('  \n \n'), []);
    eq(p('http://a.com/'), ['http://a.com']);
    eq(p('http://a.com\nhttps://b.com/x//'), ['http://a.com', 'https://b.com/x']);
    // 去重 + 保持顺序 + 容忍多余空白与空行
    eq(p(' http://a.com \n\nhttp://a.com\n  http://c.com  '), ['http://a.com', 'http://c.com']);
  };

  cases['update: 默认更新地址已内置'] = (WB) => {
    const d = WB.store.getSettings().updateBase;
    const list = WB.update.parseBases(d);
    ok(list.length >= 1, '默认更新地址至少要有 1 个，实际：' + JSON.stringify(list));
    list.forEach((u) => ok(/^https?:\/\//.test(u), '默认地址应是 http(s)：' + u));
    ok(list[0].indexOf('gh-proxy.com') >= 0, '第一行应是实测最快的镜像（下载优先用它）：' + list[0]);
    eq(WB.DEFAULT_UPDATE_BASE, d);
  };

  cases['update: notesOf 更新日志规范化'] = (WB) => {
    const n = WB.update.notesOf;
    eq(n(null), []);
    eq(n({}), []);
    eq(n({ notes: [] }), []);
    eq(n({ notes: ['换了新界面', ' 修复了提醒 ', ''] }), ['换了新界面', '修复了提醒']);
    eq(n({ notes: '- 修好了 A\n* 加了 B\n\n普通一行' }), ['修好了 A', '加了 B', '普通一行']);
  };

  cases['update: pickNewest 多个源取最新'] = (WB) => {
    const p = WB.update.pickNewest;
    eq(p([]), null);
    eq(p([null, undefined]), null);
    const a = { base: 'a', remote: { version: '1.1.3', versionCode: 3 } };
    const b = { base: 'b', remote: { version: '1.1.4', versionCode: 4 } };
    const c = { base: 'c', remote: { version: '1.1.1', versionCode: 2 } };
    eq(p([a, b, c]).base, 'b');
    eq(p([c, b, a]).base, 'b');
    eq(p([c, a]).base, 'a');
    // 没有 versionCode 时退回比较版本号
    const d = { base: 'd', remote: { version: '1.2.0' } };
    const e = { base: 'e', remote: { version: '1.1.9' } };
    eq(p([e, d]).base, 'd');
    // 版本相同 → 保持传入顺序（快的源排在前面）
    eq(p([a, { base: 'a2', remote: { version: '1.1.3', versionCode: 3 } }]).base, 'a');
  };

  cases['壁纸: wallpaperCss 预设/自定义/遮罩'] = (WB) => {
    // 默认没有壁纸
    let w = WB.wallpaperCss({ wallpaper: '', wallpaperDim: 30 }, '');
    eq(w.kind, 'none');
    eq(w.image, '');
    eq(w.dim, 30);

    // 内置预设（樱花是图片，其他是渐变）
    w = WB.wallpaperCss({ wallpaper: 'sakura', wallpaperDim: 40 }, '');
    eq(w.kind, 'preset');
    ok(w.image.indexOf('wallpaper-sakura.webp') > 0, '樱花壁纸应指向图片：' + w.image);
    eq(w.dim, 40);

    w = WB.wallpaperCss({ wallpaper: 'dusk', wallpaperDim: 0 }, '');
    ok(w.image.indexOf('linear-gradient') === 0, '渐变壁纸应直接用 CSS 渐变：' + w.image);

    // 自定义照片
    w = WB.wallpaperCss({ wallpaper: 'custom', wallpaperDim: 30 }, 'data:image/jpeg;base64,AAAA');
    eq(w.kind, 'custom');
    ok(w.image.indexOf('data:image/jpeg') > 0, '自定义壁纸应使用 dataURL');

    // 选了 custom 但没有图 → 退回默认，不报错
    eq(WB.wallpaperCss({ wallpaper: 'custom' }, '').kind, 'none');

    // 遮罩浓度会被限制在 0-80
    eq(WB.wallpaperCss({ wallpaper: 'sakura', wallpaperDim: 999 }, '').dim, 80);
    eq(WB.wallpaperCss({ wallpaper: 'sakura', wallpaperDim: -5 }, '').dim, 0);
    eq(WB.wallpaperCss({ wallpaper: 'sakura' }, '').dim, 30);

    // 内置壁纸列表至少有 4 个，且都带 id/name
    ok(WB.WALLPAPERS.length >= 4, '内置壁纸至少 4 个');
    WB.WALLPAPERS.forEach((p) => {
      ok(!!p.id && !!p.name && !!p.image, '壁纸条目要完整：' + JSON.stringify(p));
    });
  };

  cases['课表: 本地规则解析课表文字'] = (WB) => {
    const r = WB.course.parseCourseText([
      '周一 1-2节 高等数学 教三101',
      '周二 3-4节 大学物理 @实验楼B203',
      '周三 5节 英语 外语楼302 1-16周',
      '周四 7-8 程序设计 计算机楼A401 单周',
      '周五 9-10节 体育 操场 1-8周 双周',
      '这行什么信息都没有'
    ].join('\n'));

    eq(r.courses.length, 5);
    eq(r.errors.length, 1);
    eq(r.errors[0].line, 6);

    const math = r.courses[0];
    eq(math.name, '高等数学');
    eq(math.weekday, 1);
    eq(math.startPeriod, 1);
    eq(math.endPeriod, 2);
    eq(math.room, '教三101');

    eq(r.courses[1].name, '大学物理');
    eq(r.courses[1].room, '实验楼B203');
    eq(r.courses[1].weekday, 2);

    const en = r.courses[2];
    eq(en.name, '英语');
    eq(en.startPeriod, 5);
    eq(en.endPeriod, 5);
    eq(en.weekFrom, 1);
    eq(en.weekTo, 16);
    eq(en.room, '外语楼302');

    const code = r.courses[3];
    eq(code.name, '程序设计');
    eq(code.weekday, 4);
    eq(code.startPeriod, 7);
    eq(code.endPeriod, 8);
    eq(code.parity, 'odd');

    const pe = r.courses[4];
    eq(pe.name, '体育');
    eq(pe.room, '操场');
    eq(pe.weekTo, 8);
    eq(pe.parity, 'even');

    // 单周写法：第5周 / 5周（正方课表常见）
    const one = WB.course.parseCourseText('周六 1-2节 高等数学A(一) @教三楼A101 第5周\n周五 6-7节 大学体育(一) 5周');
    eq(one.courses.length, 2);
    eq(one.courses[0].weekFrom, 5);
    eq(one.courses[0].weekTo, 5);
    eq(one.courses[0].weekday, 6);
    eq(one.courses[0].room, '教三楼A101');
    eq(one.courses[1].weekFrom, 5);
    eq(one.courses[1].weekTo, 5);
    eq(one.courses[1].name, '大学体育(一)');
  };

  cases['课表: 周次计算与某天的课'] = (WB) => {
    eq(WB.course.mondayOf('2026-09-09'), '2026-09-07');   // 周三 → 本周一
    eq(WB.course.mondayOf('2026-09-13'), '2026-09-07');   // 周日 → 上周一
    eq(WB.course.weekOf('2026-09-07', '2026-09-07'), 1);
    eq(WB.course.weekOf('2026-09-13', '2026-09-07'), 1);
    eq(WB.course.weekOf('2026-09-14', '2026-09-07'), 2);
    eq(WB.course.weekOf('2026-09-21', '2026-09-07'), 3);

    const start = '2026-09-07';
    const courses = [
      { id: 'a', name: 'A', weekday: 1, startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 16, parity: 'all' },
      { id: 'b', name: 'B', weekday: 1, startPeriod: 3, endPeriod: 4, weekFrom: 1, weekTo: 16, parity: 'odd' },
      { id: 'c', name: 'C', weekday: 2, startPeriod: 1, endPeriod: 2, weekFrom: 1, weekTo: 4, parity: 'all' }
    ];
    eq(WB.course.coursesOn(courses, 1, 1).map((c) => c.name).join(','), 'A,B');
    eq(WB.course.coursesOn(courses, 1, 2).map((c) => c.name).join(','), 'A');   // B 是单周
    eq(WB.course.coursesOn(courses, 1, 3).map((c) => c.name).join(','), 'A,B');
    eq(WB.course.coursesOn(courses, 2, 5).length, 0);                            // C 只上到第 4 周
    eq(WB.course.coursesOnDate(courses, '2026-09-07', start).length, 2);         // 第 1 周周一
    eq(WB.course.coursesOnDate(courses, '2026-09-14', start).length, 1);         // 第 2 周周一只有 A
    eq(WB.course.periodLabel({ startPeriod: 3, endPeriod: 4 }), '第 3-4 节');
    eq(WB.course.periodLabel({ startPeriod: 5 }), '第 5 节');
    ok(WB.course.periodTime(1).indexOf('08:00') === 0, '第 1 节时间：' + WB.course.periodTime(1));
    eq(WB.course.courseWeeksLabel({ weekFrom: 1, weekTo: 8, parity: 'even' }), '1-8 周（双周）');
    eq(WB.course.courseWeeksLabel({ weekFrom: 1, weekTo: 16, parity: 'all' }), '1-16 周');
  };

  cases['课表: AI 图片识别的返回要能容错解析'] = (WB) => {
    // 正常：```json 包裹
    let r = WB.coursesFromAiText('```json\n[{"name":"线性代数","weekday":2,"startPeriod":3,"endPeriod":4,"room":"教二201","weekFrom":1,"weekTo":16,"parity":"all"}]\n```');
    eq(r.courses.length, 1);
    eq(r.courses[0].name, '线性代数');
    eq(r.courses[0].weekday, 2);
    eq(r.courses[0].startPeriod, 3);
    eq(r.courses[0].endPeriod, 4);
    eq(r.courses[0].room, '教二201');
    eq(r.courses[0].weekTo, 16);

    // 前后有废话也能抠出数组
    r = WB.coursesFromAiText('好的，我识别到：[{"name":"英语","weekday":3,"startPeriod":5,"endPeriod":6}] 希望有帮助！');
    eq(r.courses.length, 1);
    eq(r.courses[0].name, '英语');
    eq(r.courses[0].weekday, 3);

    // 只返回一个对象（没包成数组）
    r = WB.coursesFromAiText('{"name":"体育","weekday":5,"startPeriod":9,"endPeriod":10,"room":"操场"}');
    eq(r.courses.length, 1);
    eq(r.courses[0].room, '操场');

    // 中文字段名 / 变体字段名
    r = WB.coursesFromAiText('[{"课程":"高等数学","星期":"周一","开始节":1,"结束节":2,"地点":"教三101","教师":"张老师"}]');
    eq(r.courses.length, 1);
    eq(r.courses[0].name, '高等数学');
    eq(r.courses[0].weekday, 1);
    eq(r.courses[0].startPeriod, 1);
    eq(r.courses[0].room, '教三101');
    eq(r.courses[0].teacher, '张老师');

    // 单双周 + 越界钳制 + 结束节小于开始节要纠正
    r = WB.coursesFromAiText('[{"name":"A","weekday":9,"startPeriod":30,"endPeriod":1,"parity":"单周"},{"name":"B","parity":"双周"},{"name":"C","parity":"每周"}]');
    eq(r.courses[0].weekday, 7);
    eq(r.courses[0].startPeriod, 12);
    eq(r.courses[0].endPeriod, 12);
    eq(r.courses[0].parity, 'odd');
    eq(r.courses[1].parity, 'even');
    eq(r.courses[2].parity, 'all');

    // 没名字的条目丢掉
    r = WB.coursesFromAiText('[{"weekday":1},{"name":"   "},{"name":"保留"}]');
    eq(r.courses.length, 1);
    eq(r.courses[0].name, '保留');

    // 完全不是 JSON：给明确错误，而不是崩
    r = WB.coursesFromAiText('这张图我看不清');
    eq(r.courses.length, 0);
    ok(!!r.error, '应该有错误提示：' + r.error);
  };

  cases['课表: 模型手抖的 JSON 也要能修好（真实案例）'] = (WB) => {
    // 这是 glm-4v-flash 真实返回过的内容：把 "teacher","" 的冒号写成了逗号，还夹了换行
    const broken = [
      '```json',
      '[',
      '    {"name":"高等数学", "weekday":1, "startPeriod":1, "endPeriod":2, "room":"教三101", "teacher":"张伟", "weekFrom":1, "weekTo":20, "parity":"all"},',
      '    {"name":"线性代数", "weekday":2, "startPeriod":1, "endPeriod":2, "room":"教二201", "teacher","", "weekFrom":1, "weekTo":20, "parity":"all"},',
      '    {"name":"体育", "weekday":4, "startPeriod":1, "endPeriod":2, "room":"田径场", "teacher":"",',
      '     "weekFrom":1, "weekTo":20, "parity":"all"}',
      ']',
      '```'
    ].join('\n');

    const r = WB.coursesFromAiText(broken);
    eq(r.courses.length, 3);
    eq(r.courses[0].name, '高等数学');
    eq(r.courses[1].name, '线性代数');
    eq(r.courses[1].room, '教二201');
    eq(r.courses[2].name, '体育');
    eq(r.courses[2].weekday, 4);
    eq(r.courses[2].room, '田径场');
    eq(r.error, '');

    // 模型改用纯文字列课表（完全不是 JSON）→ 退回按行解析
    const plain = WB.coursesFromAiText('周一 1-2节 高等数学 教三101\n周三 5-6节 英语 外语楼302');
    eq(plain.courses.length, 2);
    eq(plain.courses[0].name, '高等数学');
    eq(plain.courses[1].room, '外语楼302');

    // 结尾多逗号
    const trailing = WB.coursesFromAiText('[{"name":"A","weekday":1,"startPeriod":1,"endPeriod":2},]');
    eq(trailing.courses.length, 1);
    eq(trailing.courses[0].name, 'A');
  };

  cases['课表: 节次时间可以自己改'] = (WB) => {
    const d = WB.course.periodsOf({});
    ok(d.length >= 8, '默认作息至少 8 节');
    eq(WB.course.periodTime(1, d), '08:00-08:45');

    // 自定义（乱序也会按节次排好）
    const list = WB.course.periodsOf({ periods: [{ no: 2, time: '09:00-09:45' }, { no: 1, time: '08:10-08:55' }] });
    eq(list.length, 2);
    eq(list[0].no, 1);
    eq(WB.course.periodTime(2, list), '09:00-09:45');

    // 坏数据过滤；全坏 → 退回默认
    eq(WB.course.periodsOf({ periods: [{ no: 1, time: '乱写' }] }).length, WB.course.DEFAULT_PERIODS.length);

    // 文本解析：一行一节，容忍 、/~/到 等写法
    const p = WB.course.parsePeriodsText('1 08:00-08:45\n2、08:55-09:40\n3 10:00~10:45\n乱七八糟');
    eq(p.length, 3);
    eq(p[1].time, '08:55-09:40');
    eq(p[2].time, '10:00-10:45');
    ok(WB.course.periodsToText(p).indexOf('1 08:00-08:45') === 0, '导出文本：' + WB.course.periodsToText(p));
  };

  cases['小树: 只按完成记录成长（中断不长）'] = (WB) => {
    const day = (n) => ({ taskId: 't' + n, title: 'T' + n, at: Date.now() });
    const today = WB.datetime.todayStr();

    let t = WB.treeOf([], today);
    eq(t.stage, 'seed');
    eq(t.stageName, '种子');
    eq(t.total, 0);
    eq(t.wateredToday, false);
    eq(t.remaining, 3);

    // 完成 1 个 → 还是种子，但进度往前走
    t = WB.treeOf([day(1)], today);
    eq(t.stage, 'seed');
    eq(t.intoStage, 1);
    ok(t.progress > 0 && t.progress < 1, '进度应在 0~1 之间：' + t.progress);
    eq(t.wateredToday, true);

    // 到 3 个 → 幼苗
    t = WB.treeOf([day(1), day(2), day(3)], today);
    eq(t.stage, 'sprout');
    eq(t.stageName, '幼苗');
    eq(t.remaining, 9);

    // 到 12 个 → 小树（满级）
    const many = [];
    for (let i = 0; i < 12; i++) many.push(day(i));
    t = WB.treeOf(many, today);
    eq(t.stage, 'tree');
    eq(t.atMax, true);
    eq(t.progress, 1);
    eq(t.remaining, 0);

    // 昨天的完成记录：不计入"今日已浇水"，但依然算成长
    const old = [{ taskId: 'x', at: Date.now() - 3 * 86400000 }];
    t = WB.treeOf(old, today);
    eq(t.total, 1);
    eq(t.wateredToday, false);
  };

  cases['每日一句: 同一天固定、换一句会变'] = (WB) => {
    const a = WB.quoteOfDay('2026-10-16');
    const b = WB.quoteOfDay('2026-10-16');
    const c = WB.quoteOfDay('2026-10-17');
    eq(a, b);
    ok(a.length > 4, '语录不能是空的：' + a);
    ok(WB.QUOTES.indexOf(a) >= 0, '必须来自语录库');
    ok(WB.QUOTES.length >= 10, '语录至少要 10 条：' + WB.QUOTES.length);
    // 不同日期大概率不同（允许极端巧合相同，这里只要求能取到库里的内容）
    ok(WB.QUOTES.indexOf(c) >= 0, '换一天也要取到库里的内容');
    // 换一句：不会和当前重复
    const d = WB.randomQuote(null, a);
    ok(d !== a, '换一句应该换掉：' + d);
    ok(WB.QUOTES.indexOf(d) >= 0, '换来的也要在库里');
  };

  cases['壁纸: 按长边算压缩尺寸（不低于屏幕就是清晰）'] = (WB) => {
    // 手机竖屏 1080×2400：上限给 2400（=屏幕长边）→ 不缩，保持原分辨率
    var s = WB.wallpaperTargetSize(1080, 2400, 2400);
    eq(s.w, 1080);
    eq(s.h, 2400);
    // 上限 2160 时按长边等比缩（2400 → 2160）
    s = WB.wallpaperTargetSize(1080, 2400, 2160);
    eq(s.w, 972);
    eq(s.h, 2160);
    // 大图按长边缩到 2160
    s = WB.wallpaperTargetSize(4000, 3000, 2160);
    eq(s.w, 2160);
    eq(s.h, 1620);
    // 方形
    s = WB.wallpaperTargetSize(3000, 3000, 2160);
    eq(s.w, 2160);
    eq(s.h, 2160);
    // 尺寸缺失时也要给出合理值
    s = WB.wallpaperTargetSize(0, 0, 2160);
    ok(s.w > 0 && s.h > 0, '尺寸缺失时也要给出合理值：' + JSON.stringify(s));
  };

  return cases;
}

suite('内存降级模式', null, makeCases('memory'));
suite('localStorage 模式', makeFakeLocalStorage(), makeCases('ls'));

console.log('\n通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
