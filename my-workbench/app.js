// 应用入口：初始化默认分类，并在每次进入前台时检查到期提醒
const store = require('./utils/store');

const REMIND_INTERVAL = 60 * 1000; // 停留在小程序里时的提醒轮询间隔

App({
  onLaunch() {
    store.getCategories();
  },

  onShow() {
    this.checkReminders();
    this.startRemindWatch();
  },

  onHide() {
    this.stopRemindWatch();
  },

  onError(err) {
    console.error('app error:', err);
  },

  // 前台时每 60s 扫一次，避免用户一直停在页面里错过提醒
  startRemindWatch() {
    this.stopRemindWatch();
    this._remindTimer = setInterval(() => this.checkReminders(), REMIND_INTERVAL);
  },

  stopRemindWatch() {
    if (this._remindTimer) {
      clearInterval(this._remindTimer);
      this._remindTimer = null;
    }
  },

  /**
   * 本地提醒检查：
   * 给任务设置了「日期 + 时间 + 提醒开关」后，任务到期 2 小时内
   * 打开小程序（或停在小程序里）会弹窗提醒一次（每个任务时间点只提醒一次）。
   */
  checkReminders() {
    try {
      const tasks = store.getTasks();
      const now = Date.now();
      const keys = new Set(store.getNotifiedKeys());
      const hits = [];

      tasks.forEach(t => {
        if (t.done || !t.remind || !t.date || !t.time) return;
        const due = new Date(t.date + 'T' + t.time + ':00').getTime();
        if (isNaN(due)) return;
        const key = t.id + '@' + t.date + ' ' + t.time;
        if (now >= due && now - due < 2 * 3600 * 1000 && !keys.has(key)) {
          hits.push(t);
          keys.add(key);
        }
      });

      if (hits.length) {
        store.saveNotifiedKeys(Array.from(keys));
        const lines = hits.slice(0, 5).map(t => '「' + t.title + '」' + t.time);
        wx.showModal({
          title: '⏰ 任务提醒',
          content: lines.join('\n') + (hits.length > 5 ? '\n…等共 ' + hits.length + ' 项' : ''),
          confirmText: '知道了',
          showCancel: false
        });
      }
    } catch (e) {
      console.error('checkReminders error', e);
    }
  }
});
