/** 登录态：存在本地。真实项目里这一步要拿 code 去服务端换 openid，本轮没有服务端，如实标注。 */
const KEY = 'tempo.weapp.session';
const HINT_KEY = 'tempo.weapp.loginHinted';

export function session() {
  try {
    const s = wx.getStorageSync(KEY);
    return s && s.loggedIn ? s : null;
  } catch (e) {
    return null;
  }
}

export function isLoggedIn() {
  return !!session();
}

export function signIn(profile) {
  const s = {
    loggedIn: true,
    nickname: (profile && profile.nickname) || '教练',
    avatar: (profile && profile.avatar) || '',
    signedAt: new Date().toISOString()
  };
  wx.setStorageSync(KEY, s);
  return s;
}

export function signOut() {
  try {
    wx.removeStorageSync(KEY);
  } catch (e) {
    /* 忽略 */
  }
}

/** 微信登录只拿得到 code + 基础身份；没有服务端就不假装拿到了用户资料。 */
export function wxLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: res => resolve(res.code || ''),
      fail: err => reject(err)
    });
  });
}

export function hinted() {
  try {
    return !!wx.getStorageSync(HINT_KEY);
  } catch (e) {
    return false;
  }
}

export function markHinted() {
  try {
    wx.setStorageSync(HINT_KEY, 1);
  } catch (e) {
    /* 忽略 */
  }
}

/** 需要身份时才弹窗，确认后跳到登录页；取消返回 false，调用方自己决定是否继续。 */
export function requireLogin(reason) {
  if (isLoggedIn()) return Promise.resolve(true);
  return new Promise(resolve => {
    wx.showModal({
      title: '需要登录',
      content: reason || '这个操作需要登录后使用，现在去登录？',
      confirmText: '去登录',
      cancelText: '稍后',
      confirmColor: '#20252c',
      success(res) {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/login/index' });
          resolve(false);
        } else {
          resolve(false);
        }
      },
      fail() {
        resolve(false);
      }
    });
  });
}
