const { get } = require('../../utils/store');
const r = require('../../utils/rules');

function build(state, page) {
  const list = r.searchStudents(state, page.search || '');
  const now = new Date();
  return {
    total: state.students.length,
    rows: list.map(s => {
      const sum = r.studentSummary(state, s.id, now);
      const tone = r.toneById(state.types, (s.preferences || [])[0]);
      return {
        id: s.id,
        name: s.name,
        initial: s.name.slice(0, 1),
        bg: tone.bg,
        ink: tone.ink,
        goal: s.goal || s.phone || '未填写训练目标',
        active: sum.active,
        completed: sum.completed,
        meta: `${sum.active ? `有效 ${sum.active} 节 · ` : ''}已完成 ${sum.completed}`
      };
    }),
    empty: !list.length
  };
}

Page({
  data: { search: '', rows: [], total: 0, empty: false },

  onLoad() {
    this.render();
  },

  onShow() {
    this.render();
  },

  render() {
    this.setData(build(get(), this.data));
  },

  onSearch(e) {
    this.setData({ search: e.detail.value }, () => this.render());
  },

  clearSearch() {
    this.setData({ search: '' }, () => this.render());
  },

  open(e) {
    wx.navigateTo({ url: `/pages/student/index?id=${e.currentTarget.dataset.id}` });
  },

  create() {
    wx.navigateTo({ url: '/pages/student-form/index' });
  },

  noop() {}
});
