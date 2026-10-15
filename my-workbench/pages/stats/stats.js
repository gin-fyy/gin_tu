// 统计页：概览卡片 + 近7天柱状图 + 分类分布（计算都在 utils/stats.js，这里是纯展示）
const store = require('../../utils/store');
const dt = require('../../utils/datetime');
const stats = require('../../utils/stats');

Page({
  data: {
    cards: [],
    days: [],
    catStats: []
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const today = dt.todayStr();
    const o = stats.overview(
      store.getTasks(),
      store.getCompletions(),
      store.getCategories(),
      today
    );
    this.setData({
      cards: o.cards,
      days: o.days,
      catStats: o.catStats
    });
  }
});
