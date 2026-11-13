Component({
  options: { addGlobalClass: true },
  properties: {
    title: { type: String, value: '' },
    sub: { type: String, value: '' },
    back: { type: Boolean, value: false },
    compact: { type: Boolean, value: false }
  },
  data: { statusBar: 20, navH: 44 },
  lifetimes: {
    attached() {
      let statusBar = 20;
      let navH = 44;
      try {
        const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        statusBar = info.statusBarHeight || 20;
        const box = wx.getMenuButtonBoundingClientRect();
        if (box && box.height) navH = (box.top - statusBar) * 2 + box.height;
      } catch (e) {
        /* 用默认值 */
      }
      this.setData({ statusBar, navH });
    }
  },
  methods: {
    onBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack();
      else wx.switchTab({ url: '/pages/schedule/index' });
    }
  }
});
