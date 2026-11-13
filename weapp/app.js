/**
 * 启动：加载本地数据；首次进入提示登录（用户明确要求「需要登录就弹窗」）。
 * 登录只是本地身份，不上传任何数据。
 */
const { session, hinted, markHinted } = require('./utils/auth');

App({
  globalData: {
    session: null,
    statusBarHeight: 20
  },

  onLaunch() {
    this.globalData.session = session();
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.globalData.statusBarHeight = info.statusBarHeight || 20;
    } catch (e) {
      this.globalData.statusBarHeight = 20;
    }
    if (!session() && !hinted()) {
      markHinted();
      setTimeout(() => {
        wx.showModal({
          title: '登录 Tempo',
          content: '登录后可保存你的授课记录与学员信息。本轮数据仅存在本机，不上传云端。',
          confirmText: '微信登录',
          cancelText: '先看看',
          confirmColor: '#20252c',
          success: res => {
            if (res.confirm) wx.navigateTo({ url: '/pages/login/index' });
          }
        });
      }, 400);
    }
  }
});
