// 我的页：昵称 / 分类管理 / 订阅消息配置 / 数据管理（导出 + 导入）
const store = require('../../utils/store');

Page({
  data: {
    nickname: '',
    avatar: '我',
    cats: [],
    newCat: '',
    templateId: '',
    showImport: false,
    importText: '',
    version: '1.1.0'
  },

  onShow() {
    this.refresh();
  },

  refresh() {
    const s = store.getSettings();
    const name = s.nickname || '我';
    this.setData({
      nickname: name,
      avatar: Array.from(name)[0] || '我',
      cats: store.getCategories(),
      templateId: s.subscribeTemplateId || ''
    });
  },

  editNickname() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '输入昵称',
      content: this.data.nickname,
      success: (res) => {
        if (res.confirm && res.content && res.content.trim()) {
          store.saveSettings({ nickname: res.content.trim() });
          this.refresh();
        }
      }
    });
  },

  onNewCatInput(e) {
    this.setData({ newCat: e.detail.value });
  },

  addCat() {
    const name = (this.data.newCat || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入分类名称', icon: 'none' });
      return;
    }
    if (this.data.cats.some(c => c.name === name)) {
      wx.showToast({ title: '分类已存在', icon: 'none' });
      return;
    }
    store.addCategory(name);
    this.setData({ newCat: '' });
    this.refresh();
  },

  delCat(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.cats.length <= 1) {
      wx.showToast({ title: '至少保留一个分类', icon: 'none' });
      return;
    }
    const cat = this.data.cats.find(c => c.id === id);
    const target = this.data.cats.find(c => c.id !== id);
    wx.showModal({
      title: '删除分类',
      content: '删除「' + cat.name + '」后，该分类下的任务会归入「' + target.name + '」',
      confirmColor: '#EF4444',
      success: (res) => {
        if (res.confirm) {
          store.deleteCategory(id);
          this.refresh();
        }
      }
    });
  },

  onTplInput(e) {
    this.setData({ templateId: e.detail.value });
  },

  saveTpl() {
    store.saveSettings({ subscribeTemplateId: (this.data.templateId || '').trim() });
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  aboutRemind() {
    wx.showModal({
      title: '关于提醒',
      content: '本地提醒：给任务设置日期、时间和提醒开关后，任务到期 2 小时内打开小程序会弹窗提醒，每个时间点只提醒一次。\n\n服务通知（可选）：小程序正式上线后，在微信公众平台申请「订阅消息」模板，把模板 ID 填到本页，保存带提醒的任务时会请求订阅授权，之后任务到期可收到微信服务通知。',
      showCancel: false
    });
  },

  exportData() {
    wx.setClipboardData({
      data: store.exportData(),
      success: () => {
        wx.showToast({ title: '已复制到剪贴板', icon: 'success' });
      }
    });
  },

  /* ============ 数据导入 ============ */
  toggleImport() {
    this.setData({ showImport: !this.data.showImport });
  },

  onImportInput(e) {
    this.setData({ importText: e.detail.value });
  },

  cancelImport() {
    this.setData({ showImport: false, importText: '' });
  },

  doImport() {
    const text = (this.data.importText || '').trim();
    if (!text) {
      wx.showToast({ title: '先粘贴导出的 JSON', icon: 'none' });
      return;
    }
    let result;
    try {
      result = store.importData(text);
    } catch (e) {
      wx.showModal({
        title: '导入失败',
        content: (e && e.message) || '数据格式不正确',
        showCancel: false
      });
      return;
    }
    wx.showModal({
      title: '导入成功',
      content: '任务 ' + result.tasks + ' 条，分类 ' + result.categories + ' 个，完成记录 ' + result.completions + ' 条。\n当前数据已被覆盖。',
      showCancel: false
    });
    this.setData({ showImport: false, importText: '' });
  },

  clearData() {
    wx.showModal({
      title: '清空数据',
      content: '将删除全部任务与完成记录，且无法恢复。确定吗？',
      confirmColor: '#EF4444',
      success: (res) => {
        if (!res.confirm) return;
        wx.showModal({
          title: '再次确认',
          content: '真的要清空吗？',
          confirmColor: '#EF4444',
          success: (r2) => {
            if (r2.confirm) {
              store.clearAll();
              this.refresh();
              wx.showToast({ title: '已清空', icon: 'success' });
            }
          }
        });
      }
    });
  }
});
