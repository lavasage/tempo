const { get, reset } = require('../../utils/store');
const d = require('../../utils/date');
const r = require('../../utils/rules');
const auth = require('../../utils/auth');
const ui = require('../../utils/ui');

function rowView(state, row) {
  const tone = r.toneById(state.types, row.booking.course_type_id);
  return {
    id: row.booking.id,
    day: d.dayLabel(row.booking.start_at),
    name: (state.students.find(s => s.id === row.booking.student_id) || {}).name || '学员',
    typeName: (state.types.find(t => t.id === row.booking.course_type_id) || {}).name || '课程',
    status: row.review ? (r.hasRating(row.review) ? 'scored' : 'logged') : 'plain',
    statusText: r.statusText(row.review),
    bg: tone.bg,
    ink: tone.ink
  };
}

function build(state, page) {
  const rec = r.teachingRecords(state, Number(page.days), new Date());
  const work = r.workbench(state, new Date());
  const s = auth.session();
  const shown = page.pendingOnly ? rec.pending : rec.latest;
  return {
    coach: state.coach.name,
    initial: state.coach.name.slice(0, 1).toUpperCase(),
    weekCount: work.weekCount,
    monthCompleted: work.monthCompleted,
    studentCount: state.students.length,
    days: Number(page.days),
    dayOptions: [
      { n: 7, on: Number(page.days) === 7 },
      { n: 30, on: Number(page.days) === 30 },
      { n: 90, on: Number(page.days) === 90 },
      { n: 0, on: Number(page.days) === 0 }
    ],
    allCount: rec.allCount,
    hasRows: rec.rows.length > 0,
    scopeEmpty: rec.allCount > 0 && !rec.rows.length,
    count: rec.rows.length,
    scheduled: r.durationText(rec.scheduledMinutes),
    logged: r.durationText(rec.loggedMinutes),
    loggedCount: rec.loggedCount,
    ratedCount: rec.ratedCount,
    effortCount: rec.effortCount,
    pendingCount: rec.pending.length,
    pendingOnly: page.pendingOnly,
    rows: shown.map(row => rowView(state, row)),
    rest: page.pendingOnly ? [] : rec.rest.map(row => rowView(state, row)),
    restCount: rec.rows.length,
    expandAll: page.expandAll,
    listTitle: page.pendingOnly ? '待补反馈' : '最近授课',
    loggedIn: !!s,
    nickname: s ? s.nickname : '',
    avatar: s ? s.avatar : ''
  };
}

Page({
  data: { days: 30, pendingOnly: false, expandAll: false },

  onLoad() {
    this.render();
  },

  onShow() {
    this.render();
  },

  render() {
    const view = build(get(), this.data);
    // 范围切走后没有待补项时，筛选状态自动退回最近授课。
    if (view.pendingCount === 0 && this.data.pendingOnly) {
      this.setData({ pendingOnly: false }, () => this.setData(build(get(), this.data)));
      return;
    }
    this.setData(view);
  },

  setDays(e) {
    this.setData({ days: Number(e.currentTarget.dataset.days), expandAll: false }, () => this.render());
  },

  togglePending() {
    this.setData({ pendingOnly: !this.data.pendingOnly, expandAll: false }, () => this.render());
  },

  toggleAll() {
    this.setData({ expandAll: !this.data.expandAll }, () => this.render());
  },

  openRecord(e) {
    wx.navigateTo({ url: `/pages/editor/index?id=${e.currentTarget.dataset.id}` });
  },

  goSchedule() {
    wx.switchTab({ url: '/pages/schedule/index' });
  },

  goStudents() {
    wx.switchTab({ url: '/pages/students/index' });
  },

  login() {
    wx.navigateTo({ url: '/pages/login/index' });
  },

  async signOut() {
    const ok = await ui.confirm('退出后仍可继续使用本机数据，只是不再显示登录身份。', '退出登录');
    if (!ok) return;
    auth.signOut();
    ui.toast('已退出登录');
    this.render();
  },

  async resetDemo() {
    const ok = await ui.confirm('会清空本机所有学员与课程，恢复成演示数据。此操作不可撤销。', '重置数据');
    if (!ok) return;
    reset();
    ui.toast('已恢复演示数据');
    this.render();
  },

  noop() {}
});
