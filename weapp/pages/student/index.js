const { get, commit } = require('../../utils/store');
const d = require('../../utils/date');
const r = require('../../utils/rules');
const ui = require('../../utils/ui');

function build(state, page) {
  const student = state.students.find(s => s.id === page.id && s.coach_id === state.coach.id);
  if (!student) return { missing: true };
  const now = new Date();
  const sum = r.studentSummary(state, student.id, now);
  const tone = r.toneById(state.types, (student.preferences || [])[0]);
  const stats = r.trainingStats(state, student.id, 0, now);
  const courses = r.studentCourses(state, student.id, 'all');
  const typeOptions = [{ id: '', name: '不限类型' }].concat(state.types.map(t => ({ id: t.id, name: t.name })));
  const typeIndex = Math.max(0, typeOptions.findIndex(t => t.id === (page.form.courseTypeId || '')));

  return {
    missing: false,
    name: student.name,
    initial: student.name.slice(0, 1),
    bg: tone.bg,
    ink: tone.ink,
    goal: student.goal || '',
    phone: student.phone || '',
    notes: student.notes || '',
    completed: sum.completed,
    active: sum.active,
    last: sum.last ? d.dayLabel(sum.last) : '',
    packages: r.studentPackages(state, student.id, now).map(p => ({
      id: p.pkg.id,
      name: p.pkg.name,
      typeName: p.pkg.course_type_id ? ((state.types.find(t => t.id === p.pkg.course_type_id) || {}).name || '指定类型') : '不限类型',
      total: p.total,
      used: p.used,
      remaining: p.remaining,
      occupied: p.occupied,
      available: p.available,
      expires: p.pkg.expires_on ? `有效期至 ${p.pkg.expires_on}` : '长期有效',
      expired: p.expired,
      low: p.available <= 0 && !p.expired
    })),
    stats: {
      average: stats.average === null ? '—' : (Math.round(stats.average * 10) / 10).toFixed(1),
      effort: stats.effort === null ? '—' : (Math.round(stats.effort * 10) / 10).toFixed(1),
      completed: stats.completed,
      logged: stats.loggedCount,
      minutes: r.durationText(stats.minutes),
      unrated: stats.unrated
    },
    courses: courses.slice(0, 8).map(b => {
      const t = r.toneById(state.types, b.course_type_id);
      return {
        id: b.id,
        day: d.dayLabel(b.start_at).replace(' 月 ', '/').replace(' 日', ''),
        time: d.time(b.start_at),
        typeName: (state.types.find(x => x.id === b.course_type_id) || {}).name || '课程',
        status: b.status,
        statusLabel: r.labels[b.status],
        bg: t.bg,
        ink: t.ink
      };
    }),
    more: Math.max(0, courses.length - 8),
    typeOptions: typeOptions.map(t => t.name),
    form: {
      name: page.form.name,
      total: page.form.total,
      initial: page.form.initial,
      purchased: page.form.purchased,
      expires: page.form.expires,
      notes: page.form.notes,
      courseTypeId: page.form.courseTypeId,
      typeIndex
    }
  };
}

Page({
  data: {
    id: '',
    packageOpen: false,
    form: { name: '', total: '', initial: '0', purchased: d.dateKey(), expires: '', notes: '', courseTypeId: '' }
  },

  onLoad(query) {
    this.setData({ id: (query && query.id) || '' });
    this.render();
  },

  onShow() {
    this.render();
  },

  render() {
    this.setData(build(get(), this.data));
  },

  edit() {
    wx.navigateTo({ url: `/pages/student-form/index?id=${this.data.id}` });
  },

  openCourse(e) {
    wx.navigateTo({ url: `/pages/editor/index?id=${e.currentTarget.dataset.id}` });
  },

  openPackage() {
    this.setData({ packageOpen: true });
  },

  closePackage() {
    this.setData({ packageOpen: false });
  },

  renew(e) {
    const pkg = this.data.packages.find(p => p.id === e.currentTarget.dataset.id);
    if (!pkg) return;
    const state = get();
    const raw = state.packages.find(p => p.id === pkg.id);
    this.setData({
      packageOpen: true,
      form: {
        name: pkg.name,
        total: String(pkg.total),
        initial: '0',
        purchased: d.dateKey(),
        expires: '',
        notes: '',
        courseTypeId: (raw && raw.course_type_id) || ''
      }
    });
  },

  onField(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value }, () => this.render());
  },

  onType(e) {
    const state = get();
    const index = Number(e.detail.value);
    const options = [{ id: '' }].concat(state.types);
    this.setData({ 'form.courseTypeId': (options[index] || {}).id || '' }, () => this.render());
  },

  pickExpiry(e) {
    this.setData({ 'form.expires': e.detail.value }, () => this.render());
  },

  clearExpiry() {
    this.setData({ 'form.expires': '' }, () => this.render());
  },

  savePackage() {
    const f = this.data.form;
    try {
      const state = get();
      const input = {
        student_id: this.data.id,
        course_type_id: f.courseTypeId || null,
        name: f.name || '',
        total_sessions: Number(f.total),
        initial_used: f.initial === '' ? 0 : Number(f.initial),
        purchased_on: f.purchased || d.dateKey(),
        expires_on: f.expires || null,
        notes: f.notes || ''
      };
      commit(r.savePackage(state, input, `pkg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`));
      this.setData({ packageOpen: false, form: { name: '', total: '', initial: '0', purchased: d.dateKey(), expires: '', notes: '', courseTypeId: '' } });
      ui.toast('套餐已登记', 'success');
      this.render();
    } catch (e) {
      ui.fail(e);
    }
  },

  noop() {}
});
