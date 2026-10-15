/**
 * 零依赖逻辑测试：node tests/run-tests.js
 * 用内存 Map 打桩 wx storage，直接测 utils/ 里的业务逻辑。
 */
const assert = require('assert');

/* ---------- wx storage 打桩（必须在 require store 之前挂到 global） ---------- */
const storage = new Map();
global.wx = {
  getStorageSync(k) { return storage.has(k) ? storage.get(k) : ''; },
  setStorageSync(k, v) { storage.set(k, v); },
  removeStorageSync(k) { storage.delete(k); }
};

const store = require('../utils/store');
const dt = require('../utils/datetime');
const stats = require('../utils/stats');

/* ---------- 极简测试框架 ---------- */
let pass = 0;
const failures = [];
function test(name, fn) {
  storage.clear();
  try {
    fn();
    pass++;
    console.log('✓ ' + name);
  } catch (e) {
    failures.push(name + ' → ' + (e && e.message));
    console.log('✗ ' + name + ' → ' + (e && e.message));
  }
}
const eq = (a, b, msg) => assert.deepStrictEqual(a, b, msg);
const ok = (v, msg) => assert.ok(v, msg);

const today = dt.todayStr();
const byId = (id) => store.getTasks().find(t => t.id === id);
function tsOn(dateStr, hour) {
  const d = dt.parseDate(dateStr);
  d.setHours(hour === undefined ? 10 : hour, 0, 0, 0);
  return d.getTime();
}
function compsOn(dates) {
  return dates.map((ds, i) => ({ taskId: 't' + i, title: 'x', category: 'work', priority: 1, at: tsOn(ds) }));
}

/* ================= datetime ================= */
test('datetime: 格式化与解析', () => {
  eq(dt.toDateStr(new Date(2026, 0, 5)), '2026-01-05');
  eq(dt.parseDate('2026-01-05').getMonth(), 0);
  eq(dt.todayStr(), dt.toDateStr(new Date()));
  eq(dt.pad(7), '07');
});

test('datetime: addDays 跨月跨年', () => {
  eq(dt.addDays('2026-01-31', 1), '2026-02-01');
  eq(dt.addDays('2026-03-01', -1), '2026-02-28');
  eq(dt.addDays('2025-12-31', 1), '2026-01-01');
});

test('datetime: addMonths 月末夹取', () => {
  eq(dt.addMonths('2026-01-31', 1), '2026-02-28');
  eq(dt.addMonths('2026-03-31', -1), '2026-02-28');
  eq(dt.addMonths('2024-01-31', 1), '2024-02-29');
  eq(dt.addMonths('2026-01-15', 1), '2026-02-15');
});

test('datetime: dateLabel 今天/明天/后天/日期', () => {
  eq(dt.dateLabel(''), '');
  eq(dt.dateLabel(today), '今天');
  eq(dt.dateLabel(dt.addDays(today, 1)), '明天');
  eq(dt.dateLabel(dt.addDays(today, 2)), '后天');
  ok(/^\d+月\d+日 周[日一二三四五六]$/.test(dt.dateLabel(dt.addDays(today, 5))), '远期日期格式');
});

test('datetime: 逾期判断与格式化', () => {
  eq(dt.isOverdue(dt.addDays(today, -1)), true);
  eq(dt.isOverdue(today), false);
  eq(dt.isOverdue(''), false);
  ok(/^\d{2}-\d{2} 09:00$/.test(dt.fmtTime(tsOn(today, 9))), 'fmtTime 格式');
  ok(dt.greeting().length > 0 && dt.fullDateText().indexOf('月') > 0);
});

/* ================= store: 任务 ================= */
test('store: addTask 默认值与标题 trim', () => {
  const t = store.addTask({ title: '  写方案  ' });
  eq(t.title, '写方案');
  eq(t.priority, 1);
  eq(t.repeat, 'none');
  eq(t.done, false);
  eq(t.doneAt, null);
  eq(t.lastRoll, null);
  eq(t.category, 'other');
  ok(t.id && t.createdAt > 0 && t.updatedAt > 0);
  eq(store.getTasks().length, 1);
});

test('store: priority 0 保留、非法值回退 1', () => {
  eq(store.addTask({ title: 'a', priority: 0 }).priority, 0);
  eq(store.addTask({ title: 'b', priority: 9 }).priority, 1);
  eq(store.addTask({ title: 'c', priority: 2 }).priority, 2);
});

test('store: updateTask 更新并清理 lastRoll', () => {
  const t = store.addTask({ title: 'x', date: '2026-01-31', repeat: 'monthly' });
  store.toggleDone(t.id);
  ok(byId(t.id).lastRoll, '完成后应有滚动记录');
  store.updateTask(t.id, { date: '2026-02-10', repeat: 'monthly' });
  const cur = byId(t.id);
  eq(cur.date, '2026-02-10');
  eq(cur.lastRoll, null);
  ok(cur.updatedAt >= t.createdAt);
  eq(store.updateTask('not-exist', { title: 'z' }), null);
});

test('store: deleteTask', () => {
  const a = store.addTask({ title: 'a' });
  store.addTask({ title: 'b' });
  store.deleteTask(a.id);
  eq(store.getTasks().length, 1);
  eq(store.getTasks()[0].title, 'b');
});

/* ================= store: 完成 / 撤销 ================= */
test('store: 普通任务完成与撤销', () => {
  const t = store.addTask({ title: '普通任务' });
  store.toggleDone(t.id);
  ok(byId(t.id).done);
  ok(byId(t.id).doneAt > 0);
  eq(store.getCompletions().length, 1);
  store.toggleDone(t.id);
  eq(byId(t.id).done, false);
  eq(byId(t.id).doneAt, null);
  eq(store.getCompletions().length, 0);
});

test('store: 撤销只删自己的完成记录', () => {
  const a = store.addTask({ title: 'a' });
  const b = store.addTask({ title: 'b' });
  store.toggleDone(a.id);
  store.toggleDone(b.id);
  store.toggleDone(a.id); // 撤销 a
  const comps = store.getCompletions();
  eq(comps.length, 1);
  eq(comps[0].taskId, b.id);
});

test('store: 重复任务完成滚动 + 撤销回滚（不重复计数）', () => {
  const t = store.addTask({ title: '每日复盘', date: today, repeat: 'daily' });
  store.toggleDone(t.id);
  let cur = byId(t.id);
  eq(cur.date, dt.addDays(today, 1));
  eq(cur.done, false);
  eq(cur.lastRoll.from, today);
  eq(store.getCompletions().length, 1);

  store.toggleDone(t.id); // 撤销：日期滚回来、记录删掉
  cur = byId(t.id);
  eq(cur.date, today);
  eq(cur.lastRoll, null);
  eq(store.getCompletions().length, 0);

  store.toggleDone(t.id); // 再完成一次：只记 1 条，不会累计成 2
  eq(store.getCompletions().length, 1);
  eq(byId(t.id).date, dt.addDays(today, 1));
});

test('store: 重复任务 weekly / monthly 滚动', () => {
  const w = store.addTask({ title: '周会', date: '2026-01-05', repeat: 'weekly' });
  store.toggleDone(w.id);
  eq(byId(w.id).date, '2026-01-12');
  const m = store.addTask({ title: '月报', date: '2026-01-31', repeat: 'monthly' });
  store.toggleDone(m.id);
  eq(byId(m.id).date, '2026-02-28');
  eq(store.getCompletions().length, 2);
});

test('store: 无日期的重复任务按普通任务处理', () => {
  const t = store.addTask({ title: '随手做', repeat: 'daily' });
  store.toggleDone(t.id);
  eq(byId(t.id).done, true);
  eq(byId(t.id).lastRoll, null);
});

/* ================= store: 分类 / 设置 / 标记 ================= */
test('store: 默认分类与新增', () => {
  eq(store.getCategories().length, 4);
  eq(store.getCategories()[0].id, 'work');
  const id = store.addCategory('健身');
  const cats = store.getCategories();
  eq(cats.length, 5);
  eq(cats[4].name, '健身');
  ok(/^#/.test(cats[4].color));
  eq(store.getCategories()[4].id, id);
});

test('store: 新增分类不会污染默认分类（回归）', () => {
  store.addCategory('健身');
  storage.clear(); // 模拟新会话：storage 清空后重新读取
  const cats = store.getCategories();
  eq(cats.length, 4);
  ok(!cats.some(c => c.name === '健身'), '默认分类被 addCategory 污染了');
  cats.push({ id: 'x', name: 'X' }); // 外部改返回值也不该影响存储
  eq(store.getCategories().length, 4);
});

test('store: getTasks 返回副本', () => {
  store.addTask({ title: 'a' });
  const list = store.getTasks();
  list.push({ id: 'fake', title: 'b' });
  eq(store.getTasks().length, 1);
});

test('store: 删除分类会把任务迁移到剩余分类', () => {
  const id = store.addCategory('健身');
  const t = store.addTask({ title: '跑步', category: id });
  store.deleteCategory(id);
  eq(store.getCategories().length, 4);
  eq(byId(t.id).category, 'work');
});

test('store: 分类删空回退默认', () => {
  const t = store.addTask({ title: 'x', category: 'other' });
  ['work', 'study', 'life', 'other'].forEach(id => store.deleteCategory(id));
  eq(store.getCategories().length, 4);
  eq(byId(t.id).category, 'work');
});

test('store: 设置读写与合并', () => {
  eq(store.getSettings().nickname, '打工人');
  eq(store.getSettings().subscribeTemplateId, '');
  store.saveSettings({ nickname: 'Gin' });
  eq(store.getSettings().nickname, 'Gin');
  eq(store.getSettings().subscribeTemplateId, '');
});

test('store: 提醒标记只保留最近 200 条', () => {
  const keys = [];
  for (let i = 0; i < 250; i++) keys.push('k' + i);
  store.saveNotifiedKeys(keys);
  const saved = store.getNotifiedKeys();
  eq(saved.length, 200);
  eq(saved[0], 'k50');
  eq(saved[199], 'k249');
});

/* ================= store: 导入导出 ================= */
test('store: 导出/导入往返', () => {
  const t = store.addTask({ title: '任务A', category: 'study', date: today, repeat: 'daily' });
  store.addTask({ title: '任务B' });
  store.toggleDone(t.id);
  store.addCategory('健身');
  store.saveSettings({ nickname: 'Gin' });
  const text = store.exportData();
  const parsed = JSON.parse(text);
  eq(parsed.app, 'my-workbench');
  eq(parsed.tasks.length, 2);

  store.clearAll();
  store.saveNotifiedKeys(['old']);
  const r = store.importData(text);
  eq(r.tasks, 2);
  eq(r.categories, 5);
  eq(r.completions, 1);
  eq(store.getTasks().length, 2);
  eq(store.getCategories().length, 5);
  eq(store.getCompletions().length, 1);
  eq(store.getSettings().nickname, 'Gin');
  eq(store.getNotifiedKeys().length, 0);
});

test('store: 导入非法数据报错', () => {
  assert.throws(() => store.importData('不是 json'), /JSON/);
  assert.throws(() => store.importData('{"app":"other","tasks":[]}'), /不是本应用/);
  assert.throws(() => store.importData('{"app":"my-workbench"}'), /tasks/);
});

test('store: clearAll 保留分类与设置', () => {
  const t = store.addTask({ title: 'x' });
  store.toggleDone(t.id);
  store.saveSettings({ nickname: 'Gin' });
  store.clearAll();
  eq(store.getTasks().length, 0);
  eq(store.getCompletions().length, 0);
  eq(store.getCategories().length, 4);
  eq(store.getSettings().nickname, 'Gin');
});

/* ================= stats ================= */
test('stats: countsOf 计数', () => {
  const tasks = [
    { done: false, date: today },
    { done: false, date: dt.addDays(today, -1) },
    { done: false, date: '' },
    { done: true, date: today }
  ];
  eq(stats.countsOf(tasks, today), { open: 3, overdue: 1, today: 1, done: 1 });
});

test('stats: streakOf 连续打卡', () => {
  eq(stats.streakOf(compsOn([today, dt.addDays(today, -1), dt.addDays(today, -2)]), today), 3);
  eq(stats.streakOf(compsOn([today]), today), 1);
  eq(stats.streakOf(compsOn([dt.addDays(today, -1)]), today), 1);
  eq(stats.streakOf(compsOn([dt.addDays(today, -2)]), today), 0);
  eq(stats.streakOf([], today), 0);
});

test('stats: rateOf 与 weekCountOf', () => {
  eq(stats.rateOf(compsOn([today, today, today]), 1), 75);
  eq(stats.rateOf([], 0), 0);
  eq(stats.rateOf([], 5), 0);
  const comps = compsOn([today, dt.addDays(today, -6), dt.addDays(today, -7)]);
  eq(stats.weekCountOf(comps, today), 2);
});

test('stats: last7 结构与柱高归一化', () => {
  const comps = compsOn([today, today, today, dt.addDays(today, -1)]);
  const days = stats.last7(comps, today);
  eq(days.length, 7);
  eq(days[6].label, '今天');
  eq(days[5].label, '昨天');
  eq(days[6].count, 3);
  eq(days[6].h, 100);
  eq(days[5].count, 1);
  eq(days[5].h, 33);
  eq(days[0].count, 0);
  eq(days[0].h, 4);
  ok(/^\d+\/\d+$/.test(days[0].label), '更早的日期用 M/D');
});

test('stats: byCategory 过滤零值并倒序', () => {
  const cats = [
    { id: 'a', name: 'A', color: '#111111' },
    { id: 'b', name: 'B', color: '#222222' },
    { id: 'c', name: 'C', color: '#333333' }
  ];
  const comps = [
    { taskId: '1', category: 'b', at: tsOn(today) },
    { taskId: '2', category: 'b', at: tsOn(today) },
    { taskId: '3', category: 'b', at: tsOn(today) },
    { taskId: '4', category: 'a', at: tsOn(today) }
  ];
  const out = stats.byCategory(cats, comps);
  eq(out.length, 2);
  eq(out[0].name, 'B');
  eq(out[0].count, 3);
  eq(out[0].pct, 75);
  eq(out[1].pct, 25);
  ok(out.every(c => c.count > 0));
});

test('stats: overview 汇总卡片', () => {
  const tasks = [{ done: false, date: today }, { done: false, date: dt.addDays(today, -3) }];
  const comps = compsOn([today, dt.addDays(today, -1)]);
  const cats = [{ id: 'work', name: '工作', color: '#4C6EF5' }];
  const o = stats.overview(tasks, comps, cats, today);
  eq(o.cards.length, 6);
  eq(o.cards[0], { label: '累计完成', value: 2 });
  eq(o.cards[4], { label: '进行中', value: 2 });
  eq(o.cards[5], { label: '已逾期', value: 1 });
  eq(o.streak, 2);
  eq(o.days.length, 7);
  eq(o.catStats.length, 1);
});

/* ---------- 汇总 ---------- */
console.log('\n通过 ' + pass + ' 项，失败 ' + failures.length + ' 项');
if (failures.length) {
  failures.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
