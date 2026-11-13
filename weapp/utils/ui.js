/** 交互小工具：统一 toast / 确认框，避免每个页面各写一套。 */
export function toast(title, icon = 'none') {
  wx.showToast({ title, icon, duration: 1800 });
}

export function confirm(content, confirmText = '确定', title = '') {
  return new Promise(resolve => {
    wx.showModal({
      title: title || '请确认',
      content,
      confirmText,
      cancelText: '取消',
      confirmColor: '#20252c',
      success: res => resolve(!!res.confirm),
      fail: () => resolve(false)
    });
  });
}

export function prompt(title, placeholder) {
  return new Promise(resolve => {
    wx.showModal({
      title,
      editable: true,
      placeholderText: placeholder || '',
      confirmText: '保存',
      confirmColor: '#20252c',
      success: res => resolve(res.confirm ? (res.content || '') : null),
      fail: () => resolve(null)
    });
  });
}

export function fail(e) {
  toast(e && e.message ? e.message : String(e || '操作失败，请重试'));
}
