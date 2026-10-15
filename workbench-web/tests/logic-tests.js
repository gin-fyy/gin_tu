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

    r = WB.update.evaluate(local, { version: '1.1.1', versionCode: 2 }, base);
    eq(r.hasUpdate, true);
    eq(r.latestVersion, '1.1.1');
    eq(r.latestCode, 2);

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

  return cases;
}

suite('内存降级模式', null, makeCases('memory'));
suite('localStorage 模式', makeFakeLocalStorage(), makeCases('ls'));

console.log('\n通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  failures.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
