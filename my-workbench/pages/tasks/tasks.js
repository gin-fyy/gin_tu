// 任务列表页：搜索 + 状态筛选 + 分类筛选 + 自动分组
const store = require('../../utils/store');
const dt = require('../../utils/datetime');

const STATUS_TABS = [
  { key: 'active', label: '进行中' },
  { key: 'done', label: '已完成' },
  { key: 'all', label: '全部' }
];

Page({
  data: {
    statusTabs: STATUS_TABS,
    status: 'active',
    keyword: '',
    cats: [],
    chips: [],
    catFilter: 'all',
    groups: [],
    total: 0
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const cats = store.getCategories();
    this.setData({
      cats: cats,
      chips: [{ id: 'all', name: '全部' }].concat(cats)
    });
    this.rebuild();
  },

  rebuild() {
    const status = this.data.status;
    const catFilter = this.data.catFilter;
    const kw = (this.data.keyword || '').trim().toLowerCase();
    const tasks = store.getTasks().filter(t => {
      if (catFilter !== 'all' && t.category !== catFilter) return false;
      if (!kw) return true;
      return (t.title + ' ' + (t.note || '')).toLowerCase().indexOf(kw) >= 0;
    });

    let list;
    if (status === 'done') {
      list = tasks.filter(t => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    } else if (status === 'all') {
      list = tasks;
    } else {
      list = tasks.filter(t => !t.done);
    }

    const today = dt.todayStr();
    const tomorrow = dt.addDays(today, 1);
    const g = { overdue: [], today: [], tomorrow: [], future: [], nodate: [], done: [] };
    list.forEach(t => {
      if (t.done) g.done.push(t);
      else if (!t.date) g.nodate.push(t);
      else if (t.date < today) g.overdue.push(t);
      else if (t.date === today) g.today.push(t);
      else if (t.date === tomorrow) g.tomorrow.push(t);
      else g.future.push(t);
    });

    const byDate = (a, b) => (a.date === b.date ? (b.priority || 0) - (a.priority || 0) : (a.date < b.date ? -1 : 1));
    const byDoneAt = (a, b) => (b.doneAt || 0) - (a.doneAt || 0);

    let groups = [];
    if (status === 'done') {
      groups = [{ key: 'done', title: '已完成 · ' + list.length, tasks: list }];
    } else {
      groups = [
        { key: 'overdue', title: '⚠️ 已逾期 · ' + g.overdue.length, tasks: g.overdue.sort(byDate), danger: true },
        { key: 'today', title: '今天 · ' + g.today.length, tasks: g.today.sort(byDate) },
        { key: 'tomorrow', title: '明天 · ' + g.tomorrow.length, tasks: g.tomorrow.sort(byDate) },
        { key: 'future', title: '以后 · ' + g.future.length, tasks: g.future.sort(byDate) },
        { key: 'nodate', title: '无日期 · ' + g.nodate.length, tasks: g.nodate }
      ];
      if (status === 'all' && g.done.length) {
        groups.push({ key: 'done', title: '已完成 · ' + g.done.length, tasks: g.done.sort(byDoneAt) });
      }
    }
    groups = groups.filter(gp => gp.tasks.length);
    this.setData({ groups: groups, total: list.length });
  },

  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => this.rebuild());
  },

  clearSearch() {
    this.setData({ keyword: '' }, () => this.rebuild());
  },

  onStatus(e) {
    this.setData({ status: e.currentTarget.dataset.key }, () => this.rebuild());
  },

  onChip(e) {
    this.setData({ catFilter: e.currentTarget.dataset.id }, () => this.rebuild());
  },

  onToggle(e) {
    store.toggleDone(e.detail.id);
    this.rebuild();
  },

  onEdit(e) {
    wx.navigateTo({ url: '/pages/task-edit/task-edit?id=' + e.detail.id });
  },

  onMore(e) {
    const id = e.detail.id;
    wx.showActionSheet({
      itemList: ['编辑', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.navigateTo({ url: '/pages/task-edit/task-edit?id=' + id });
        } else if (res.tapIndex === 1) {
          this.confirmDelete(id);
        }
      }
    });
  },

  confirmDelete(id) {
    const task = store.getTasks().find(t => t.id === id);
    wx.showModal({
      title: '删除任务',
      content: '确定删除「' + (task ? task.title : '') + '」吗？',
      confirmColor: '#EF4444',
      success: (res) => {
        if (res.confirm) {
          store.deleteTask(id);
          this.rebuild();
        }
      }
    });
  },

  onNewTask() {
    wx.navigateTo({ url: '/pages/task-edit/task-edit' });
  }
});
