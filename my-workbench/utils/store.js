// 数据层：全部数据用 wx storage 存在本机，无后端
const datetime = require('./datetime');

const KEY_TASKS = 'wb_tasks';
const KEY_CATEGORIES = 'wb_categories';
const KEY_COMPLETIONS = 'wb_completions';
const KEY_SETTINGS = 'wb_settings';
const KEY_NOTIFIED = 'wb_notified';

const APP_TAG = 'my-workbench';
const DATA_VERSION = 2;

const DEFAULT_CATEGORIES = [
  { id: 'work', name: '工作', color: '#4C6EF5' },
  { id: 'study', name: '学习', color: '#9333EA' },
  { id: 'life', name: '生活', color: '#10B981' },
  { id: 'other', name: '其他', color: '#F59E0B' }
];
const COLOR_PALETTE = ['#4C6EF5', '#9333EA', '#10B981', '#F59E0B', '#EF4444', '#0EA5E9', '#EC4899', '#84CC16'];

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return (v === '' || v === null || v === undefined) ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {
    console.error('storage write failed:', key, e);
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ================= 任务 ================= */
/**
 * 任务字段：
 * id/title/note/category/priority(0低1中2高)/date(YYYY-MM-DD)/time(HH:mm)/
 * remind(bool)/repeat(none|daily|weekly|monthly)/done/doneAt/
 * lastRoll({from,at} 重复任务上一周期的滚动记录，用于撤销)/createdAt/updatedAt
 */
function normalizeTask(raw) {
  const now = Date.now();
  const t = raw || {};
  const priority = (t.priority === 0 || t.priority) ? Number(t.priority) : 1;
  const roll = t.lastRoll && t.lastRoll.from ? { from: t.lastRoll.from, at: t.lastRoll.at || now } : null;
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

// 读出时统一返回副本：避免调用方改到 storage 里的原始数组，
// 也避免 addCategory 这类 push 操作污染模块级常量 DEFAULT_CATEGORIES
function cloneList(list) {
  return (list || []).map(x => Object.assign({}, x));
}

function getTasks() {
  return cloneList(read(KEY_TASKS, []));
}

function saveTasks(tasks) {
  write(KEY_TASKS, tasks);
}

function addTask(data) {
  const now = Date.now();
  const task = normalizeTask(Object.assign({}, data, { createdAt: now, updatedAt: now }));
  const tasks = getTasks();
  tasks.unshift(task);
  saveTasks(tasks);
  return task;
}

function updateTask(id, patch) {
  const tasks = getTasks();
  const i = tasks.findIndex(t => t.id === id);
  if (i < 0) return null;
  const clean = Object.assign({}, patch);
  // 日期或重复规则被改动后，上一周期的滚动记录就失效了
  if ('date' in clean || 'repeat' in clean) clean.lastRoll = null;
  tasks[i] = normalizeTask(Object.assign({}, tasks[i], clean, { updatedAt: Date.now() }));
  saveTasks(tasks);
  return tasks[i];
}

function deleteTask(id) {
  saveTasks(getTasks().filter(t => t.id !== id));
}

function nextDate(task) {
  if (task.repeat === 'daily') return datetime.addDays(task.date, 1);
  if (task.repeat === 'weekly') return datetime.addDays(task.date, 7);
  if (task.repeat === 'monthly') return datetime.addMonths(task.date, 1);
  return task.date;
}

/**
 * 勾选/取消勾选任务：
 * - 普通任务：完成 → 置 done + 记完成记录；再点一次 → 撤销并删掉那条完成记录
 * - 重复任务：完成 → 记完成记录并把日期滚到下一个周期（任务保持未完成）；
 *   再点一次 → 日期滚回上一周期并撤销完成记录（不会重复计数、不会连跳周期）
 */
function toggleDone(id) {
  const tasks = getTasks();
  const i = tasks.findIndex(t => t.id === id);
  if (i < 0) return;
  const t = tasks[i];
  const now = Date.now();

  if (t.repeat !== 'none' && t.date) {
    if (t.lastRoll) {
      tasks[i] = Object.assign({}, t, { date: t.lastRoll.from, lastRoll: null, updatedAt: now });
      removeLatestCompletion(id, t.lastRoll.at);
    } else {
      logCompletion(t);
      tasks[i] = Object.assign({}, t, {
        date: nextDate(t),
        lastRoll: { from: t.date, at: now },
        updatedAt: now
      });
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

/* ================= 完成记录（统计用） ================= */
function getCompletions() {
  return cloneList(read(KEY_COMPLETIONS, []));
}

function logCompletion(task) {
  const comps = getCompletions();
  comps.push({
    taskId: task.id,
    title: task.title,
    category: task.category,
    priority: task.priority,
    at: Date.now()
  });
  write(KEY_COMPLETIONS, comps.slice(-2000));
}

// 撤销：优先删 at 匹配的那条，匹配不到就删该任务最近一条
function removeLatestCompletion(taskId, at) {
  const comps = getCompletions();
  let idx = -1;
  if (at) {
    for (let j = comps.length - 1; j >= 0; j--) {
      if (comps[j].taskId === taskId && comps[j].at === at) { idx = j; break; }
    }
  }
  if (idx < 0) {
    for (let j = comps.length - 1; j >= 0; j--) {
      if (comps[j].taskId === taskId) { idx = j; break; }
    }
  }
  if (idx >= 0) {
    comps.splice(idx, 1);
    write(KEY_COMPLETIONS, comps);
  }
  return idx >= 0;
}

/* ================= 分类 ================= */
function getCategories() {
  const c = read(KEY_CATEGORIES, null);
  if (Array.isArray(c) && c.length) return cloneList(c);
  const defaults = cloneList(DEFAULT_CATEGORIES);
  saveCategories(defaults);
  return cloneList(defaults);
}

function saveCategories(list) {
  write(KEY_CATEGORIES, list);
}

function addCategory(name) {
  const list = getCategories();
  const id = 'c' + uid();
  list.push({
    id: id,
    name: name.trim(),
    color: COLOR_PALETTE[list.length % COLOR_PALETTE.length]
  });
  saveCategories(list);
  return id;
}

function deleteCategory(id) {
  let list = getCategories().filter(c => c.id !== id);
  if (!list.length) list = cloneList(DEFAULT_CATEGORIES);
  // 被删分类下的任务归入剩余的第一个分类
  const target = list[0].id;
  const tasks = getTasks().map(t => (
    t.category === id ? Object.assign({}, t, { category: target }) : t
  ));
  saveTasks(tasks);
  saveCategories(list);
}

/* ================= 设置 ================= */
function getSettings() {
  return Object.assign(
    { nickname: '打工人', subscribeTemplateId: '' },
    read(KEY_SETTINGS, {})
  );
}

function saveSettings(patch) {
  write(KEY_SETTINGS, Object.assign({}, getSettings(), patch));
}

/* ================= 提醒已通知标记 ================= */
function getNotifiedKeys() {
  return read(KEY_NOTIFIED, []);
}

function saveNotifiedKeys(keys) {
  write(KEY_NOTIFIED, keys.slice(-200));
}

/* ================= 数据管理 ================= */
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

/**
 * 导入导出数据（覆盖式）：只接受本应用导出的 JSON。
 * 返回 { tasks, categories, completions } 三个数量，便于提示用户。
 */
function importData(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('内容不是合法的 JSON');
  }
  if (!data || data.app !== APP_TAG) throw new Error('不是本应用导出的数据');
  if (!Array.isArray(data.tasks)) throw new Error('缺少 tasks 字段');

  const tasks = data.tasks.map(normalizeTask).filter(t => t.title);
  const cats = (Array.isArray(data.categories) ? data.categories : [])
    .filter(c => c && c.id && c.name)
    .map(c => ({ id: c.id, name: c.name, color: c.color || '#6B7280' }));
  const categories = cats.length ? cats : getCategories();
  const completions = (Array.isArray(data.completions) ? data.completions : [])
    .filter(c => c && c.taskId)
    .map(c => ({
      taskId: c.taskId,
      title: c.title || '',
      category: c.category || 'other',
      priority: c.priority || 1,
      at: c.at || Date.now()
    }))
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

// 清空任务与完成记录（保留分类和设置）
function clearAll() {
  [KEY_TASKS, KEY_COMPLETIONS, KEY_NOTIFIED].forEach(k => {
    try { wx.removeStorageSync(k); } catch (e) { /* ignore */ }
  });
}

module.exports = {
  APP_TAG: APP_TAG,
  DATA_VERSION: DATA_VERSION,
  getTasks: getTasks,
  saveTasks: saveTasks,
  addTask: addTask,
  updateTask: updateTask,
  deleteTask: deleteTask,
  toggleDone: toggleDone,
  getCompletions: getCompletions,
  getCategories: getCategories,
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
