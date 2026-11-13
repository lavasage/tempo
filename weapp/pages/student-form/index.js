const { get, commit } = require('../../utils/store');
const r = require('../../utils/rules');
const ui = require('../../utils/ui');

Page({
  data: {
    id: '',
    title: '新增学员',
    name: '',
    phone: '',
    goal: '',
    notes: '',
    typeOptions: [],
    picked: []
  },

  onLoad(query) {
    const state = get();
    const id = (query && query.id) || '';
    const s = id ? state.students.find(x => x.id === id) : null;
    this.setData({
      id,
      title: s ? '编辑学员' : '新增学员',
      name: s ? s.name : '',
      phone: s ? s.phone : '',
      goal: s ? s.goal || '' : '',
      notes: s ? s.notes : '',
      typeOptions: state.types.map(t => ({ id: t.id, name: t.name, on: !!s && (s.preferences || []).includes(t.id) })),
      picked: s ? [...(s.preferences || [])] : []
    });
  },

  onField(e) {
    this.setData({ [e.currentTarget.dataset.key]: e.detail.value });
  },

  toggleType(e) {
    const id = e.currentTarget.dataset.id;
    const picked = this.data.picked.includes(id) ? this.data.picked.filter(x => x !== id) : [...this.data.picked, id];
    this.setData({
      picked,
      typeOptions: this.data.typeOptions.map(t => ({ ...t, on: picked.includes(t.id) }))
    });
  },

  save() {
    try {
      const state = get();
      const input = { name: this.data.name, phone: this.data.phone, goal: this.data.goal, notes: this.data.notes, preferences: this.data.picked };
      if (this.data.id) {
        commit(r.updateStudent(state, this.data.id, input));
        ui.toast('学员已保存', 'success');
      } else {
        commit(r.createStudent(state, input, `st-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`));
        ui.toast('学员已添加', 'success');
      }
      setTimeout(() => wx.navigateBack(), 500);
    } catch (e) {
      ui.fail(e);
    }
  },

  noop() {}
});
