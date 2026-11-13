const auth = require('../../utils/auth');
const ui = require('../../utils/ui');

Page({
  data: {
    avatar: '',
    nickname: '',
    busy: false,
    loggedIn: false,
    current: ''
  },

  onLoad() {
    const s = auth.session();
    this.setData({ loggedIn: !!s, current: s ? s.nickname : '', avatar: s ? s.avatar : '', nickname: s ? s.nickname : '' });
  },

  onChooseAvatar(e) {
    this.setData({ avatar: e.detail.avatarUrl || '' });
  },

  onNickname(e) {
    this.setData({ nickname: e.detail.value });
  },

  async signIn() {
    if (this.data.busy) return;
    const nickname = (this.data.nickname || '').trim();
    if (!nickname) {
      ui.toast('先填写昵称');
      return;
    }
    this.setData({ busy: true });
    try {
      // 拿 code 是为了将来接服务端换 openid；本轮没有服务端，code 不落盘。
      await auth.wxLogin().catch(() => '');
      auth.signIn({ nickname, avatar: this.data.avatar });
      ui.toast('已登录', 'success');
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) {
      ui.toast('登录失败，请重试');
    } finally {
      this.setData({ busy: false });
    }
  },

  skip() {
    wx.navigateBack();
  },

  async signOut() {
    const ok = await ui.confirm('退出后本机数据仍保留。', '退出登录');
    if (!ok) return;
    auth.signOut();
    this.setData({ loggedIn: false, current: '', avatar: '', nickname: '' });
    ui.toast('已退出');
  },

  noop() {}
});
