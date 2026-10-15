// 工作台首页：今日概览 + 快速添加 + 分组任务
const store = require('../../utils/store');
const dt = require('../../utils/datetime');

function byDatePriority(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (b.priority || 0) - (a.priority || 0);
}

Page({
  data: {
    nickname: '我',
    greeting: '',
    dateText: '',
    stat: { todo: 0, done: 0, overdue: 0 },
    quickTitle: '',
    cats: [],
    overdue: [],
    today: [],
    upcoming: [],
    upcomingTotal: 0,
    inbox: []
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const tasks = store.getTasks();
    const today = dt.todayStr();
    const active = tasks.filter(t => !t.done);

    const overdue = active.filter(t => t.date && t.date < today);
    const todays = active.filter(t => t.date === today);
    const upcomingAll = active
      .filter(t => t.date && t.date > today)
      .sort(byDatePriority);
    const inbox = active.filter(t => !t.date);
    const doneToday = tasks.filter(t => t.done && t.doneAt && dt.toDateStr(new Date(t.doneAt)) === today);

    this.setData({
      nickname: store.getSettings().nickname || '我',
      greeting: dt.greeting(),
      dateText: dt.fullDateText(),
      cats: store.getCategories(),
      overdue: overdue,
      today: todays,
      upcoming: upcomingAll.slice(0, 8),
      upcomingTotal: upcomingAll.length,
      inbox: inbox,
      stat: {
        todo: todays.length,
        done: doneToday.length,
        overdue: overdue.length
      }
    });
  },

  onQuickInput(e) {
    this.setData({ quickTitle: e.detail.value });
  },

  onQuickAdd() {
    const title = (this.data.quickTitle || '').trim();
    if (!title) {
      wx.showToast({ title: '先写点内容吧', icon: 'none' });
      return;
    }
    store.addTask({ title: title, date: dt.todayStr() });
    this.setData({ quickTitle: '' });
    this.refresh();
    wx.showToast({ title: '已添加', icon: 'success' });
  },

  onToggle(e) {
    store.toggleDone(e.detail.id);
    this.refresh();
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
          this.refresh();
        }
      }
    });
  },

  onNewTask() {
    wx.navigateTo({ url: '/pages/task-edit/task-edit' });
  }
});
