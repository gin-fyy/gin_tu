// 订阅消息（可选功能）：
// 小程序正式上线后，在 mp.weixin.qq.com → 订阅消息 申请模板，
// 把模板 ID 填到「我的 → 订阅消息模板 ID」，即可在任务到期时收到微信服务通知。
// 测试号 / 游客模式没有模板，这里会静默跳过，不影响本地提醒。
const store = require('./store');

function requestSubscribe() {
  const tid = (store.getSettings().subscribeTemplateId || '').trim();
  if (!tid || !wx.requestSubscribeMessage) return;
  wx.requestSubscribeMessage({
    tmplIds: [tid],
    fail: () => { /* 未授权或模板无效时忽略，本地提醒仍可用 */ }
  });
}

module.exports = {
  requestSubscribe: requestSubscribe
};
