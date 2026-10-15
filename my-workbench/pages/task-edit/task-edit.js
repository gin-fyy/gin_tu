// 任务新建/编辑页
const store = require('../../utils/store');
const dt = require('../../utils/datetime');
const subscribe = require('../../utils/subscribe');

const PRIORITIES = [
  { v: 2, label: '🔥 高' },
  { v: 1, label: '⚡ 中' },
  { v: 0, label: '🌱 低' }
];
const REPEATS = [
  { v: 'none', label: '不重复' },
  { v: 'daily', label: '每天' },
  { v: 'weekly', label: '每周' },
  { v: 'monthly', label: '每月' }
];

Page({
  data: {
    isEdit: false,
    id: '',
    title: '',
    note: '',
    cats: [],
    category: '',
    priorities: PRIORITIES,
    priority: 1,
    date: '',
    dateStart: '',
    time: '',
    remind: false,
    repeats: REPEATS,
    repeatLabels: [],
    repeatIndex: 0
  },

  onLoad(query) {
    const cats = store.getCategories();
    const patch = {
      cats: cats,
      category: cats.length ? cats[0].id : '',
      dateStart: dt.todayStr(),
      repeatLabels: REPEATS.map(r => r.label)
    };

    if (query && query.id) {
      const t = store.getTasks().find(x => x.id === query.id);
      if (t) {
        // 分类被删过就回退到第一个分类
        const catOk = cats.some(c => c.id === t.category);
        const repeatIndex = REPEATS.findIndex(r => r.v === t.repeat);
        Object.assign(patch, {
          isEdit: true,
          id: t.id,
          title: t.title,
          note: t.note || '',
          category: catOk ? t.category : patch.category,
          priority: t.priority === 0 || t.priority ? t.priority : 1,
          date: t.date || '',
          dateStart: '2000-01-01', // 编辑时允许保留过去的日期（逾期任务）
          time: t.time || '',
          remind: !!t.remind,
          repeatIndex: repeatIndex >= 0 ? repeatIndex : 0
        });
      }
    }

    this.setData(patch);
    wx.setNavigationBarTitle({ title: this.data.isEdit ? '编辑任务' : '新建任务' });
  },

  onTitle(e) {
    this.setData({ title: e.detail.value });
  },
  onNote(e) {
    this.setData({ note: e.detail.value });
  },
  pickCat(e) {
    this.setData({ category: e.currentTarget.dataset.id });
  },
  pickPriority(e) {
    this.setData({ priority: Number(e.currentTarget.dataset.v) });
  },
  onDate(e) {
    this.setData({ date: e.detail.value });
  },
  onTime(e) {
    this.setData({ time: e.detail.value });
  },
  onRemind(e) {
    this.setData({ remind: e.detail.value });
  },
  onRepeat(e) {
    this.setData({ repeatIndex: Number(e.detail.value) });
  },
  clearDate() {
    this.setData({ date: '', time: '', remind: false });
  },

  save() {
    const d = this.data;
    const title = (d.title || '').trim();
    if (!title) {
      wx.showToast({ title: '请填写任务标题', icon: 'none' });
      return;
    }
    const remind = d.remind && !!d.date && !!d.time;
    const payload = {
      title: title,
      note: d.note,
      category: d.category,
      priority: d.priority,
      date: d.date,
      time: d.time,
      remind: remind,
      repeat: REPEATS[d.repeatIndex].v
    };
    if (d.isEdit) {
      store.updateTask(d.id, payload);
    } else {
      store.addTask(payload);
    }
    if (remind) {
      subscribe.requestSubscribe();
    }
    wx.showToast({ title: d.isEdit ? '已保存' : '已创建', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 350);
  },

  remove() {
    wx.showModal({
      title: '删除任务',
      content: '删除后无法恢复，确定吗？',
      confirmColor: '#EF4444',
      success: (res) => {
        if (res.confirm) {
          store.deleteTask(this.data.id);
          wx.navigateBack();
        }
      }
    });
  }
});
