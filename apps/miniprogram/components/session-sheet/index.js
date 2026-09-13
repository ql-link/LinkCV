const { getStatusBarHeight } = require('../../utils/system');
const api = require("../../services/career");
const auth = require("../../services/auth");
const c = require("../../utils/career");
Component({
  properties: { sessionId: { type: String, value: "" } },
  data: { brandHeight: getStatusBarHeight() + 50, closing: false, sheetExitStyle: "", maskExitStyle: "",
    loading: true,
    error: "",
    session: null,
    app: null,
    saving: false,
    editing: false,
    recordEditing: false,
    recordDirty: false,
    recordForm: { record: "", review: "", improvement: "" },
  },
  lifetimes: {
    attached() {
      c.sheetMotion.reset(this);
      this.load();
    },
    detached() {
      c.sheetMotion.dispose(this);
    },
  },
  pageLifetimes: {
    show() {
      if (this.data.session && !this.data.recordEditing) this.load();
    },
  },
  methods: {
    noop() {},
    async load() {
      this.setData({ loading: true, error: "" });
      try {
        if (!auth.hasSession()) throw new Error("UNAUTHORIZED");
        const body = await api.getSession(this.properties.sessionId);
        if (this._disposed) return;
        const s = body.session,
          a = body.application;
        const start = c.dateParts(s.start_at), end = c.dateParts(s.end_at);
        const crossDay = start.date !== end.date;
        this.setData({
          session: c.sessionView(s),
          dateLabel: c.shortDate(s.start_at),
          timeLabel: start.time + "–" + (crossDay ? c.shortDate(s.end_at) + " " : "") + end.time,
          crossDay,
          app: a,
          hasRecord: !!(
            s.questions_markdown ||
            s.review_summary ||
            s.improvement_markdown
          ),
          editable:
            !a.archived_at &&
            a.lifecycle_status === "active" &&
            s.status === "scheduled",
        });
      } catch (e) {
        if (!this._disposed) this.setData({ error: c.errorText(e) });
      } finally {
        if (!this._disposed) this.setData({ loading: false });
      }
    },
    async close() {
      if (this.data.saving) return;
      if (this.data.recordDirty && !(await c.confirm('放弃未保存的记录？', '本次填写的内容尚未保存。', '放弃修改'))) return;
      c.sheetMotion.dismiss(this);
    },
    copy(e) {
      const text = this.data.session[e.currentTarget.dataset.field];
      if (text) wx.setClipboardData({ data: text });
    },
    openForm() {
      if (this.data.saving || this.data.loading || !this.data.session) return;
      const s = this.data.session;
      this.setData({recordEditing: true, recordDirty: false, error: '', recordForm: {
        record: s.questions_markdown || '', review: s.review_summary || '', improvement: s.improvement_markdown || '',
      }});
    },
    inputRecord(e) {
      if (this.data.saving) return;
      const field = e.currentTarget.dataset.field;
      if (!['record', 'review', 'improvement'].includes(field)) return;
      const recordForm = {...this.data.recordForm, [field]: e.detail.value};
      const s = this.data.session;
      this.setData({recordForm, recordDirty: recordForm.record !== (s.questions_markdown || '') || recordForm.review !== (s.review_summary || '') || recordForm.improvement !== (s.improvement_markdown || '')});
    },
    async cancelRecord() {
      if (this.data.saving) return;
      if (this.data.recordDirty && !(await c.confirm('放弃未保存的记录？', '本次填写的内容尚未保存。', '放弃修改'))) return;
      this.setData({recordEditing: false, recordDirty: false, error: ''});
    },
    async saveRecord() {
      if (this.data.saving || !this.data.recordEditing || !this.data.session) return;
      this.setData({saving: true, error: ''});
      try {
        const form = this.data.recordForm;
        await api.updateSession(this.properties.sessionId, {
          base_lock_version: this.data.session.lock_version,
          questions_markdown: form.record.trim() || null,
          review_summary: form.review.trim() || null,
          improvement_markdown: form.improvement.trim() || null,
        });
        if (this._disposed) return;
        this.setData({recordEditing: false, recordDirty: false});
        await this.load();
        this.triggerEvent('changed');
        wx.showToast({title: '记录已保存', icon: 'success'});
      } catch (error) {
        if (!this._disposed) this.setData({error: c.errorText(error)});
      } finally {
        if (!this._disposed) this.setData({saving: false});
      }
    },
    edit() {
      if (this.data.editable && !this.data.saving)
        this.setData({ editing: true });
    },
    async editClosed() {
      this.setData({ editing: false });
      await this.load();
      this.triggerEvent("changed");
    },
    async complete() {
      return this.command("complete");
    },
    async cancel() {
      return this.command("cancel");
    },
    async command(kind) {
      if (!this.data.editable || this.data.saving) return;
      const complete = kind === "complete";
      if (
        !(await c.confirm(
          complete ? "标记本场面试结束？" : "取消本场安排？",
          complete
            ? "仅标记本场已结束，不表示面试通过，也不会推进求职阶段。"
            : "取消后从时间表移除，已有记录仍保留，不终止本次求职。",
          complete ? "标记结束" : "取消安排",
        ))
      )
        return;
      this.setData({ saving: true, error: "" });
      try {
        await (complete ? api.completeSession : api.cancelSession)(
          this.properties.sessionId,
          { base_lock_version: this.data.session.lock_version },
        );
        await this.load();
        this.triggerEvent("changed");
      } catch (e) {
        if (!this._disposed) this.setData({ error: c.errorText(e) });
      } finally {
        if (!this._disposed) this.setData({ saving: false });
      }
    },
  },
});
