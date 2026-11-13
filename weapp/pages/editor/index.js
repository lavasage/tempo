const { get, commit } = require('../../utils/store');
const d = require('../../utils/date');
const r = require('../../utils/rules');
const ui = require('../../utils/ui');

const DURATIONS = [30, 45, 60, 90];

function fmtRange(b) {
  return `${d.time(b.start_at)} – ${d.time(b.end_at)}`;
}

/**
 * 新建课程时不要直接落在已被占用的时段，否则一进页面就是冲突态。
 * 复用 availableSlots（与排课页的时段建议同一口径）；当天只取 30 分钟后。
 */
function freeStart(state, date, duration) {
  const slots = r.availableSlots(state, date, duration);
  if (!slots.length) return '09:00';
  const now = new Date();
  if (date !== d.dateKey(now)) return slots[0];
  const cur = now.getHours() * 60 + now.getMinutes() + 30;
  return slots.find(s => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m >= cur;
  }) || slots[slots.length - 1];
}

function build(state, page) {
  const own = state.students.filter(s => s.coach_id === state.coach.id);
  const types = state.types;
  const existing = page.id ? state.bookings.find(b => b.id === page.id && b.coach_id === state.coach.id) || null : null;
  const studentSelect = own.length ? own : [{ id: '', name: '请先添加学员' }];
  const studentIndex = Math.min(Math.max(page.studentIndex, 0), studentSelect.length - 1);
  const typeIndex = Math.min(Math.max(page.typeIndex, 0), Math.max(types.length - 1, 0));
  const student = studentSelect[studentIndex] || { id: '', name: '' };
  const type = types[typeIndex] || { id: '', name: '', default_duration: 60 };

  // 已结束的课程只读。
  const locked = !!existing && ['cancelled', 'completed'].includes(existing.status);

  const parts = (page.start || '09:00').split(':').map(Number);
  let draft = null;
  let endTime = '—';
  try {
    const startAt = d.at(page.date, parts[0] || 0, parts[1] || 0);
    const endAt = new Date(Date.parse(startAt) + Number(page.duration || 60) * 60000).toISOString();
    endTime = d.time(endAt);
    draft = {
      // 新建课程还没有 id，但校验需要它；用占位 id 参与校验，保存时再换成真实 id。
      id: existing ? existing.id : 'draft',
      coach_id: state.coach.id,
      student_id: student.id,
      course_type_id: type.id,
      start_at: startAt,
      end_at: endAt,
      status: existing ? existing.status : 'confirmed',
      notes: page.notes || '',
      package_id: page.packageId || null,
      created_at: existing ? existing.created_at : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  } catch (e) {
    draft = null;
  }

  // 冲突提示：与 web 同一判定顺序（引用 → 时段 → 套餐 → 可预约时间）。
  let conflict = '';
  if (draft && !locked) {
    try {
      r.validateReferences(state, draft);
      r.validateBooking(draft, state.bookings);
      const pkgIssue = r.packageError(state, draft);
      if (pkgIssue) throw Error(pkgIssue);
      conflict = r.availabilityError(state, draft.start_at, draft.end_at, existing ? existing.id : '');
      if (conflict) {
        const clash = state.bookings.find(
          b =>
            b.id !== draft.id &&
            b.coach_id === draft.coach_id &&
            b.status !== 'cancelled' &&
            Date.parse(draft.start_at) < Date.parse(b.end_at) &&
            Date.parse(b.start_at) < Date.parse(draft.end_at)
        );
        if (clash) {
          const who = (state.students.find(s => s.id === clash.student_id) || {}).name || '学员';
          conflict = `与 ${who} ${d.time(clash.start_at)}–${d.time(clash.end_at)} 的课程重叠`;
        }
      }
    } catch (e) {
      conflict = e.message || '请填写有效日期和时间';
    }
  }

  const alternatives = [];
  if (conflict && draft) {
    const wanted = (parts[0] || 0) * 60 + (parts[1] || 0);
    r.availableSlots(state, page.date, page.duration, existing ? existing.id : '')
      .sort((a, b) => Math.abs(Number(a.slice(0, 2)) * 60 + Number(a.slice(3, 5)) - wanted) - Math.abs(Number(b.slice(0, 2)) * 60 + Number(b.slice(3, 5)) - wanted))
      .slice(0, 4)
      .forEach(t => alternatives.push(t));
  }

  // 套餐可选项：学员 + 类型 + 日期都匹配，且还有余额。
  const options = student.id && type.id && page.date ? r.matchingPackages(state, student.id, type.id, page.date) : [];
  const packageNames = ['不计套餐'].concat(options.map(o => `${o.pkg.name} · 剩余 ${o.remaining} 节`));
  const packageIndex = Math.max(0, options.findIndex(o => o.pkg.id === page.packageId) + 1);
  let packageHint = '';
  if (page.packageId) {
    const pkg = state.packages.find(p => p.id === page.packageId);
    if (pkg) {
      const sum = r.summarize(state, pkg);
      packageHint = `完成后扣 1 节：剩余 ${sum.remaining} → ${sum.remaining - 1} 节，还可约 ${Math.max(0, sum.available - 1)} 节`;
    }
  } else if (student.id && page.date && !options.length) {
    packageHint = '这位学员暂时没有可用套餐，按不计套餐记录。';
  }

  const consume = existing ? r.consumeOf(state, existing.id) : null;
  const refund = consume ? state.lesson_tx.find(t => t.booking_id === existing.id && t.kind === 'refund') : null;
  const consumePkg = consume ? state.packages.find(p => p.id === consume.package_id) : null;

  const review = state.reviews.find(x => x.booking_id === page.id) || null;

  const typeTone = r.toneOf(type);

  return {
    title: existing ? '课程详情' : '新建课程',
    mode: existing ? 'view' : 'create',
    locked,
    status: existing ? existing.status : 'confirmed',
    statusLabel: r.labels[existing ? existing.status : 'confirmed'],
    dateLabel: d.dayLabel(d.at(page.date)),
    weekday: '周' + d.weekdayCn(page.date),
    endTime,
    studentNames: studentSelect.map(s => s.name),
    studentIndex,
    typeNames: types.map(t => t.name),
    typeIndex,
    typeName: type.name,
    typeBg: typeTone.bg,
    typeInk: typeTone.ink,
    packageNames,
    packageIndex,
    packageHint,
    conflict,
    alternatives,
    durationOptions: DURATIONS.map(n => ({ n, on: Number(page.duration) === n })),
    canSave: !conflict && !!student.id && !!type.id,
    hasStudents: own.length > 0,
    hasPackage: !!consume,
    packageName: consumePkg ? consumePkg.name : '',
    packageBalance: consumePkg ? r.packageBalance(state, consumePkg.id) : 0,
    refunded: !!refund,
    refundReason: refund ? refund.reason : '',
    review: {
      rating: review ? review.rating : null,
      minutes: review && review.actual_minutes !== null ? String(review.actual_minutes) : '',
      effort: review && review.effort !== null ? review.effort : null,
      notes: review ? review.notes : '',
      has: !!review
    },
    createdAt: existing ? existing.created_at : '',
    notes: page.notes || ''
  };
}

Page({
  data: {
    id: '',
    studentIndex: 0,
    typeIndex: 0,
    date: d.dateKey(),
    start: '09:00',
    duration: 60,
    notes: '',
    packageId: '',
    reviewOpen: false,
    review: { rating: null, minutes: '', effort: null, notes: '', has: false }
  },

  onLoad(query) {
    const state = get();
    const id = (query && query.id) || '';
    const existing = id ? state.bookings.find(b => b.id === id) : null;
    if (id && !existing) {
      ui.toast('课程不存在');
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    const students = state.students.filter(s => s.coach_id === state.coach.id);
    if (!existing && !students.length) {
      ui.toast('请先添加学员');
    }
    const firstStudent = existing ? students.findIndex(s => s.id === existing.student_id) : 0;
    const studentId = existing ? existing.student_id : (students[0] || {}).id;
    const preferred = (state.students.find(s => s.id === studentId) || {}).preferences || [];
    const typeIndex = existing
      ? Math.max(0, state.types.findIndex(t => t.id === existing.course_type_id))
      : Math.max(0, state.types.findIndex(t => t.id === preferred[0]));

    const date = existing ? d.dateKey(new Date(existing.start_at)) : d.validDay(query && query.date);
    const duration = existing ? Math.round((Date.parse(existing.end_at) - Date.parse(existing.start_at)) / 60000) : (state.types[typeIndex] || {}).default_duration || 60;
    const start = existing ? d.time(existing.start_at) : freeStart(state, date, duration);

    this.setData(
      {
        id,
        studentIndex: Math.max(0, firstStudent),
        typeIndex,
        date,
        start,
        duration,
        notes: existing ? existing.notes : '',
        packageId: existing ? existing.package_id || '' : ''
      },
      () => {
        if (!existing) this.pickDefaultPackage();
        this.render();
      }
    );
  },

  onShow() {
    if (this.data.id) this.render();
  },

  render() {
    const state = get();
    const view = build(state, this.data);
    this.setData(view);
  },

  /** 新建时自动选最早到期且还能约的套餐；手动改过就不再覆盖。 */
  pickDefaultPackage() {
    const state = get();
    const own = state.students.filter(s => s.coach_id === state.coach.id);
    const student = own[this.data.studentIndex] || {};
    const type = state.types[this.data.typeIndex] || {};
    if (!student.id || !type.id || !this.data.date) return;
    if (this.data.packageId) {
      const still = r.matchingPackages(state, student.id, type.id, this.data.date).some(o => o.pkg.id === this.data.packageId);
      if (still) return;
    }
    const list = r.matchingPackages(state, student.id, type.id, this.data.date);
    const best = list.find(o => o.available > 0) || list[0];
    this.setData({ packageId: best ? best.pkg.id : '' });
  },

  onStudent(e) {
    this.setData({ studentIndex: Number(e.detail.value) }, () => {
      if (!this.data.id) this.pickDefaultPackage();
      this.render();
    });
  },

  onType(e) {
    const state = get();
    const index = Number(e.detail.value);
    const duration = (state.types[index] || {}).default_duration || this.data.duration;
    this.setData({ typeIndex: index, duration }, () => {
      if (!this.data.id) this.pickDefaultPackage();
      this.render();
    });
  },

  onDate(e) {
    this.setData({ date: e.detail.value }, () => {
      if (!this.data.id) this.pickDefaultPackage();
      this.render();
    });
  },

  onStart(e) {
    this.setData({ start: e.detail.value }, () => this.render());
  },

  onDuration(e) {
    this.setData({ duration: Number(e.currentTarget.dataset.n) }, () => this.render());
  },

  onAlt(e) {
    this.setData({ start: e.currentTarget.dataset.t }, () => this.render());
  },

  onNotes(e) {
    this.setData({ notes: e.detail.value });
  },

  onPackage(e) {
    const index = Number(e.detail.value);
    const state = get();
    const own = state.students.filter(s => s.coach_id === state.coach.id);
    const student = own[this.data.studentIndex] || {};
    const type = state.types[this.data.typeIndex] || {};
    const options = r.matchingPackages(state, student.id, type.id, this.data.date);
    this.setData({ packageId: index === 0 ? '' : options[index - 1].pkg.id }, () => this.render());
  },

  save() {
    try {
      const state = get();
      const own = state.students.filter(s => s.coach_id === state.coach.id);
      const student = own[this.data.studentIndex] || {};
      const type = state.types[this.data.typeIndex] || {};
      if (!student.id) throw Error('请先添加学员');
      const parts = this.data.start.split(':').map(Number);
      const startAt = d.at(this.data.date, parts[0], parts[1]);
      const endAt = new Date(Date.parse(startAt) + Number(this.data.duration) * 60000).toISOString();
      const existing = this.data.id ? state.bookings.find(b => b.id === this.data.id) : null;
      const booking = {
        id: existing ? existing.id : `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        coach_id: state.coach.id,
        student_id: student.id,
        course_type_id: type.id,
        start_at: startAt,
        end_at: endAt,
        status: existing ? existing.status : 'confirmed',
        notes: this.data.notes || '',
        package_id: this.data.packageId || null,
        created_at: existing ? existing.created_at : new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      commit(r.saveBookingRecord(state, booking));
      ui.toast(existing ? '课程已更新' : '课程已排好', 'success');
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) {
      ui.fail(e);
    }
  },

  async changeStatus(e) {
    const status = e.currentTarget.dataset.status;
    if (status === 'cancelled') {
      const ok = await ui.confirm('确定取消这节课程？记录会保留。', '取消课程');
      if (!ok) return;
    }
    try {
      const state = get();
      let next = r.setBookingStatus(state, this.data.id, status);
      if (status === 'completed') next = r.consumeLesson(next, this.data.id);
      commit(next);
      if (status !== 'completed') {
        wx.navigateBack();
        return;
      }
      const pkg = this.data.packageName;
      ui.toast(pkg ? `已完成，扣 1 节（${pkg}）` : '课程已完成，可以填记录了', 'none');
      this.render();
    } catch (e) {
      ui.fail(e);
    }
  },

  async revertLesson() {
    const reason = await ui.prompt('撤销这次扣课', '填写更正原因，例如「套餐归属选错了」');
    if (reason === null) return;
    try {
      commit(r.revertLesson(get(), this.data.id, reason));
      ui.toast('已撤销这次扣课', 'success');
      this.render();
    } catch (e) {
      ui.fail(e);
    }
  },

  /* ---------------- 课后记录 ---------------- */
  setRating(e) {
    const value = Number(e.currentTarget.dataset.n);
    const rating = this.data.review.rating === value ? null : value;
    this.setData({ 'review.rating': rating });
  },

  clearRating() {
    this.setData({ 'review.rating': null });
  },

  onMinutes(e) {
    this.setData({ 'review.minutes': e.detail.value });
  },

  quickMinutes(e) {
    this.setData({ 'review.minutes': String(e.currentTarget.dataset.n) });
  },

  effortMinus() {
    const v = this.data.review.effort;
    this.setData({ 'review.effort': v === null ? null : v <= 1 ? null : v - 1 });
  },

  effortPlus() {
    const v = this.data.review.effort;
    this.setData({ 'review.effort': v === null ? 5 : Math.min(10, v + 1) });
  },

  clearEffort() {
    this.setData({ 'review.effort': null });
  },

  onReviewNotes(e) {
    this.setData({ 'review.notes': e.detail.value });
  },

  saveReview() {
    const review = this.data.review;
    const minutes = review.minutes === '' ? null : Number(review.minutes);
    try {
      commit(
        r.saveReview(get(), this.data.id, {
          rating: review.rating,
          effort: review.effort,
          actual_minutes: Number.isFinite(minutes) ? minutes : null,
          notes: review.notes || ''
        })
      );
      ui.toast('记录已保存', 'success');
      this.render();
    } catch (e) {
      ui.fail(e);
    }
  },

  noop() {}
});
