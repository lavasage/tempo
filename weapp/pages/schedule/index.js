const { get } = require('../../utils/store');
const { toast, fail } = require('../../utils/ui');
const d = require('../../utils/date');
const r = require('../../utils/rules');

const HOUR_DAY = 150; // rpx / 小时
const HOUR_WEEK = 86;

function startOfDay(day) {
  return new Date(day + 'T00:00:00').getTime();
}

/** 重叠课程分列：与 web 的 bookingLanes 同算法。 */
function lanes(items) {
  const sorted = [...items].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const groups = [];
  let group = [];
  let end = 0;
  for (const b of sorted) {
    if (group.length && Date.parse(b.start_at) >= end) {
      groups.push(group);
      group = [];
      end = 0;
    }
    group.push(b);
    end = Math.max(end, Date.parse(b.end_at));
  }
  if (group.length) groups.push(group);
  const out = [];
  for (const g of groups) {
    const laneEnds = [];
    for (const b of g) {
      let lane = laneEnds.findIndex(e => e <= Date.parse(b.start_at));
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = Date.parse(b.end_at);
      out.push({ b, lane, total: laneEnds.length });
    }
  }
  return out;
}

function build(state, page) {
  const { mode, day, tasksOpen, cancelledOpen } = page;
  const today = d.dateKey();
  const now = Date.now();
  const types = state.types;
  const nameOf = id => (state.students.find(s => s.id === id) || {}).name || '学员';
  const typeOf = id => state.types.find(t => t.id === id);
  const dayBookings = dd =>
    state.bookings
      .filter(b => b.coach_id === state.coach.id && r.onDay(b, dd))
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const activeOf = dd => dayBookings(dd).filter(b => b.status !== 'cancelled');
  const days = mode === 'week' ? d.weekDays(day) : [day];

  // 时间轴范围：可预约时间与课程一起决定，和 web 同口径。
  let start = 8;
  let end = 21;
  for (const dd of days) {
    for (const w of r.dayWindows(state.availability, dd)) {
      const s = new Date(w.start);
      start = Math.min(start, s.getHours());
      const e = new Date(w.end);
      end = Math.max(end, d.dateKey(e) !== dd ? 24 : e.getHours() + Number(e.getMinutes() > 0));
    }
    for (const b of activeOf(dd)) {
      start = Math.min(start, d.dateKey(new Date(b.start_at)) !== dd ? 0 : new Date(b.start_at).getHours());
      const e = new Date(b.end_at);
      end = Math.max(end, d.dateKey(e) !== dd ? 24 : e.getHours() + Number(e.getMinutes() > 0));
    }
  }
  const hourH = mode === 'week' ? HOUR_WEEK : HOUR_DAY;
  const span = end - start;
  const boardH = span * hourH;
  const origin = startOfDay(day) + start * 3600000;
  const toTop = iso => Math.round(((Date.parse(iso) - origin) / 3600000) * hourH);

  const hours = Array.from({ length: span }, (_, i) => ({ label: `${String(start + i).padStart(2, '0')}:00`, top: i * hourH }));

  // 不可预约的底色：范围减去当天可预约窗口。
  const windows = r.dayWindows(state.availability, day).map(w => ({ start: w.start, end: w.end }));
  const bands = [];
  let cursor = origin;
  for (const w of windows) {
    if (w.start > cursor) bands.push({ start: cursor, end: Math.min(w.start, origin + span * 3600000) });
    cursor = Math.max(cursor, w.end);
  }
  if (cursor < origin + span * 3600000) bands.push({ start: cursor, end: origin + span * 3600000 });
  const bandRows = bands
    .filter(b => b.end > b.start)
    .map((b, i) => ({ id: 'band-' + i, top: Math.round(((b.start - origin) / 3600000) * hourH), height: Math.round(((b.end - b.start) / 3600000) * hourH) }));

  const decorate = (b, compact) => {
    const from = Math.max(Date.parse(b.start_at), origin);
    const to = Math.min(Date.parse(b.end_at) || from + 3600000, origin + span * 3600000);
    const top = Math.round(((from - origin) / 3600000) * hourH);
    const height = Math.max(compact ? 52 : 74, Math.round(((to - from) / 3600000) * hourH));
    return {
      id: b.id,
      time: d.time(b.start_at),
      endTime: d.time(b.end_at),
      name: nameOf(b.student_id),
      short: nameOf(b.student_id).slice(0, 2),
      typeName: (typeOf(b.course_type_id) || {}).name || '课程',
      status: b.status,
      statusLabel: r.labels[b.status],
      pending: b.status === 'pending',
      bg: r.toneById(types, b.course_type_id).bg,
      ink: r.toneById(types, b.course_type_id).ink,
      top,
      height,
      left: 0,
      width: 100
    };
  };

  const dayEvents = [];
  if (mode === 'day') {
    const items = activeOf(day);
    for (const row of lanes(items)) {
      const view = decorate(row.b, false);
      const gap = 1.4;
      view.left = (row.lane * 100) / row.total + (row.total > 1 ? gap : 0);
      view.width = 100 / row.total - (row.total > 1 ? gap : 0.6);
      dayEvents.push(view);
    }
  }

  const columns =
    mode === 'week'
      ? days.map(dd => {
          const items = activeOf(dd);
          const rows = lanes(items);
          return {
            day: dd,
            weekday: d.weekdayCn(dd),
            num: Number(dd.slice(-2)),
            today: dd === today,
            selected: dd === day,
            count: items.length,
            events: rows.map(row => {
              const view = decorate(row.b, true);
              view.left = 0;
              view.width = 100;
              return view;
            })
          };
        })
      : [];

  const monthCells = d.monthDays(day).map(dd => {
    const items = activeOf(dd);
    return {
      day: dd,
      num: Number(dd.slice(-2)),
      outside: dd.slice(0, 7) !== day.slice(0, 7),
      today: dd === today,
      selected: dd === day,
      count: items.length,
      dots: items.slice(0, 3).map(b => ({ id: b.id, ink: r.toneById(types, b.course_type_id).ink, pending: b.status === 'pending' }))
    };
  });

  const work = r.workbench(state, new Date());
  const anomalies = activeOf(day)
    .map(b => ({ booking: b, reason: r.availabilityError(state, b.start_at, b.end_at, b.id) }))
    .filter(x => x.reason);

  const cancelled = dayBookings(day).filter(b => b.status === 'cancelled');

  return {
    mode,
    day,
    today,
    monthTitle: d.monthTitle(day),
    caption: d.caption(day, mode),
    isToday: day === today,
    days,
    hours,
    boardH,
    hourH,
    span,
    bands: bandRows,
    events: dayEvents,
    columns,
    monthCells,
    monthWeekdays: ['一', '二', '三', '四', '五', '六', '日'],
    nowTop: day === today ? toTop(new Date().toISOString()) : -1,
    showNow: day === today && now > origin && now < origin + span * 3600000,
    count: activeOf(day).length,
    pendingCount: activeOf(day).filter(b => b.status === 'pending').length,
    completedCount: activeOf(day).filter(b => b.status === 'completed').length,
    cancelled: cancelled.map(b => ({ id: b.id, time: d.time(b.start_at), name: nameOf(b.student_id) })),
    cancelledOpen,
    anomalyCount: anomalies.length,
    anomalies: anomalies.slice(0, 4).map(x => ({ id: x.booking.id, time: d.time(x.booking.start_at), name: nameOf(x.booking.student_id), reason: x.reason })),
    overview: {
      todayCount: work.todayCount,
      next: work.next ? { id: work.next.id, time: d.time(work.next.start_at), name: nameOf(work.next.student_id), ongoing: work.ongoing } : null,
      taskCount: work.items.length
    },
    tasksOpen,
    tasks: work.items.map(item => ({
      id: item.booking.id,
      kind: item.kind,
      name: nameOf(item.booking.student_id),
      when: (d.dateKey(new Date(item.booking.start_at)) === today ? '今天' : d.dayLabel(item.booking.start_at)) + ' ' + d.time(item.booking.start_at),
      reason: item.reason
    }))
  };
}

Page({
  data: {
    mode: 'day',
    day: d.dateKey(),
    cancelledOpen: false,
    tasksOpen: false
  },

  onLoad(query) {
    const day = d.validDay(query && query.date);
    this.setData({ day, mode: query && query.view === 'week' ? 'week' : query && query.view === 'month' ? 'month' : 'day' });
    this.render();
  },

  onShow() {
    this.render();
  },

  render() {
    this.setData(build(get(), this.data));
  },

  setMode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode }, () => this.render());
  },

  move(e) {
    const step = Number(e.currentTarget.dataset.step);
    const { mode, day } = this.data;
    const next = mode === 'month' ? d.moveMonth(day, step) : d.shift(day, step * (mode === 'week' ? 7 : 1));
    this.setData({ day: next }, () => this.render());
  },

  pickDate(e) {
    const next = d.validDay(e.detail.value);
    this.setData({ day: next }, () => this.render());
  },

  pickMonth(e) {
    const next = d.validDay(e.detail.value + '-01');
    this.setData({ day: next }, () => this.render());
  },

  goToday() {
    this.setData({ day: d.dateKey() }, () => this.render());
  },

  openDay(e) {
    this.setData({ day: e.currentTarget.dataset.day, mode: 'day' }, () => this.render());
  },

  openBooking(e) {
    wx.navigateTo({ url: `/pages/editor/index?id=${e.currentTarget.dataset.id}` });
  },

  openNext() {
    const next = this.data.overview.next;
    if (next) wx.navigateTo({ url: `/pages/editor/index?id=${next.id}` });
  },

  create() {
    wx.navigateTo({ url: `/pages/editor/index?date=${this.data.day}` });
  },

  openTasks() {
    this.setData({ tasksOpen: true });
  },

  closeTasks() {
    this.setData({ tasksOpen: false });
  },

  toggleCancelled() {
    this.setData({ cancelledOpen: !this.data.cancelledOpen });
  },

  noop() {}
});
