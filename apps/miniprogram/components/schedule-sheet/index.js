const { getStatusBarHeight } = require('../../utils/system');
const auth = require("../../services/auth");
const api = require("../../services/career");
const c = require("../../utils/career");
const f = require("../../utils/careerForm");
const time = require("../../utils/careerTime");
const editor = require("../../utils/careerEditor")();
const usesDuration = (type) => ["interview", "written_test", "ai_interview"].includes(type);
function dateLabel(date) {
  if (!date) return "选择日期";
  const [, month, day] = date.split("-");
  return Number(month) + "月" + Number(day) + "日";
}
function scheduleMode(application) {
  const view = c.applicationView(application);
  if (
    application.archived_at ||
    application.phase !== "applied" ||
    !application.applied_at ||
    !view.canAdvance
  )
    return null;
  if (application.stage_state === "awaiting_result") return "stage";
  return null;
}
Component({
  properties: {
    date: { type: String, value: "" },
    applicationId: { type: String, value: "" },
    sessionId: { type: String, value: "" },
  },
  data: { brandHeight: getStatusBarHeight() + 50, closing: false, sheetExitStyle: "", maskExitStyle: "",
    ...editor.data,
    currencyOptions: ["CNY", "USD", "HKD", "EUR"].map((label) => ({ label })),
    periodOptions: ["每月", "每年", "每天", "每小时"].map((label) => ({
      label,
    })),
    loading: true,
    choosing: true,
    applications: [],
    filtered: [],
    keyword: "",
    requireSchedule: true,
    submissionStarted: false,
    selectedLabel: "",
    timeEditorOpen: false,
    timeDraft: {},
    duration: "60",
    customDuration: false,
    durationOptions: [30, 60, 90],
    durationEditorOpen: false,
    durationDraft: "",
    durationError: "",
    durationKeys: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "清空", "0", "删除"],
    deadlineDays: "3",
    pickerDate: "",
    pickerTime: "",
    pickerTitle: "选择面试时间",
    startLabel: "选择开始时间",
    endLabel: "选择结束时间",
    rangeLabel: "选择日期与时间",
  },
  lifetimes: {
    attached() {
      c.sheetMotion.reset(this);
      if (this.properties.applicationId || this.properties.sessionId)
        this.loadDirect();
      else this.loadApplications();
    },
    detached() {
      c.sheetMotion.dispose(this);
    },
  },
  methods: {
    retryResumes: editor.retryResumes,
    async loadDirect() {
      this._stageRequest = c.uuid();
      this._sessionRequest = c.uuid();
      this._drafts = {};
      this._stageSaved = false;
      this._dirty = false;
      this.setData({
        applicationId: this.properties.applicationId,
        sessionId: this.properties.sessionId,
        choosing: false,
        mode: this.properties.sessionId ? "schedule" : "stage",
      });
      await editor.load.call(this);
      if (!this.data.app) return;
      const view = c.applicationView(this.data.app);
      if (this.properties.sessionId) {
        if (this.data.session.status !== "scheduled" || !view.canAdvance) {
          this.setData({ error: "当前场次不可修改", conflict: true });
          return;
        }
        const minutes = Math.round(
          (new Date(this.data.session.end_at) -
            new Date(this.data.session.start_at)) /
            60000,
        );
        this.setData({
          duration: String(minutes),
          customDuration: ![30, 60, 90].includes(minutes),
          deadlineDays: String(Math.max(1, Math.round(minutes / 1440))),
        });
      } else if (view.canSchedule) {
        this.setData({
          mode: "schedule",
          form: { ...f.defaults(view.stageType), stageLabel: view.stageLabel },
        });
      } else if (
        !view.canAdvance ||
        this.data.app.stage_state === "scheduled"
      ) {
        this.setData({
          error: "请先处理当前面试安排，再推进阶段。",
          conflict: true,
        });
        return;
      }
      this.setData({ direct: true });
      this.updateButton();
    },
    returnToDetail() {
      c.sheetMotion.dismiss(this, { refresh: true });
    },
    updateButton() {
      const form = this.data.form;
      const timed = !["screening", "offer"].includes(form.stageType);
      this.setData({
        requireSchedule: timed,
        sheetTitle: this.data.sessionId
          ? "修改安排"
          : this.properties.applicationId
            ? "推进流程"
            : "安排新阶段",
      });
      this.setData({
        buttonLabel: this.data.submissionStarted
          ? "重试保存"
          : form.stageType === "offer"
            ? "保存 Offer"
            : form.stageType === "screening"
              ? "确认推进"
              : "保存安排",
        startLabel: form.startTime
          ? form.startDate + " " + form.startTime
          : "选择开始时间",
        endLabel: form.endTime
          ? dateLabel(form.endDate) + " " + form.endTime
          : "选择结束时间",
        rangeLabel:
          form.startTime && form.endTime
            ? dateLabel(form.startDate) +
              " " +
              form.startTime +
              "–" +
              (form.endDate !== form.startDate
                ? dateLabel(form.endDate) + " "
                : "") +
              form.endTime
            : "选择日期与时间",
      });
    },
    openTimeEditor(e) {
      if (this.data.saving || this.data.submissionStarted) return;
      const target = e.currentTarget.dataset.target;
      if (!["start", "end", "range"].includes(target)) return;
      this.setData({
        timeEditorOpen: true,
        timeTarget: target,
        timeDraft: { ...this.data.form },
        timeError: "",
      });
    },
    editTimeDraft(e) {
      const field = e.currentTarget.dataset.field;
      if (!["startDate", "startTime", "endDate", "endTime"].includes(field))
        return;
      this.setData({
        timeDraft: { ...this.data.timeDraft, [field]: e.detail.value },
        timeError: "",
      });
    },
    cancelTimeEditor() {
      this.setData({ timeEditorOpen: false, timeError: "" });
    },
    confirmTimeEditor() {
      if (this.data.saving || this.data.submissionStarted) return;
      const target = this.data.timeTarget,
        draft = this.data.timeDraft;
      const fields =
        target === "range"
          ? ["startDate", "startTime", "endDate", "endTime"]
          : [target + "Date", target + "Time"];
      if (fields.some((field) => !draft[field])) {
        this.setData({ timeError: "请完整选择日期与时间。" });
        return;
      }
      const form = { ...this.data.form };
      fields.forEach((field) => {
        form[field] = draft[field];
      });
      try {
        if (form.startTime && form.endTime) f.timeRange(form, true);
      } catch (error) {
        this.setData({ timeError: error.message });
        return;
      }
      this.setData({ form, timeEditorOpen: false, timeError: "", error: "" });
      this._dirty = true;
      if (wx.enableAlertBeforeUnload)
        wx.enableAlertBeforeUnload({
          message: "当前填写内容尚未保存，离开后会丢失。",
        });
      this.updateButton();
    },
    chooseDateTime(e) {
      if (this.data.saving || this.data.submissionStarted) return;
      const target = e.currentTarget.dataset.target;
      this.setData({
        timeEditorOpen: true,
        timeTarget: target,
        pickerDate:
          this.data.form[target + "Date"] ||
          this.properties.date ||
          c.dateParts().date,
        pickerTime: this.data.form[target + "Time"],
        pickerTitle:
          target === "end"
            ? "选择结束时间"
            : this.data.form.stageType === "written_test"
              ? "选择笔试时间"
              : usesDuration(this.data.form.stageType)
              ? "选择面试时间"
              : "选择开始时间",
      });
    },
    acceptDateTime(e) {
      if (this.data.saving || this.data.submissionStarted) return;
      const duration = e.detail.duration === undefined ? this.data.duration : String(e.detail.duration);
      let form = {
        ...this.data.form,
        [this.data.timeTarget + "Date"]: e.detail.date,
        [this.data.timeTarget + "Time"]: e.detail.time,
      };
      try {
        if (usesDuration(form.stageType))
          form = time.withDuration(form, duration);
        if (form.stageType === "assessment")
          form = time.withDuration(form, Number(this.data.deadlineDays) * 1440);
        if (form.startTime && form.endTime) f.timeRange(form, true);
      } catch (error) {
        this.setData({ error: error.message });
        return;
      }
      this.setData({ form, duration, customDuration: !["30", "60", "90"].includes(duration), timeEditorOpen: false, error: "" });
      this._dirty = true;
      this.updateButton();
    },
    selectDuration(e) {
      if (this.data.saving || this.data.submissionStarted) return;
      const value = e.currentTarget.dataset.minutes;
      if (value === "custom") {
        this.setData({ durationEditorOpen: true, durationDraft: this.data.customDuration ? this.data.duration : "", durationError: "" });
        return;
      }
      this.setData({ durationEditorOpen: false });
      this.changeDuration(String(value), false);
    },
    pressDurationKey(e) {
      if (this.data.saving || this.data.submissionStarted || !this.data.durationEditorOpen) return;
      const key = e.currentTarget.dataset.key;
      let draft = this.data.durationDraft;
      if (key === "清空") draft = "";
      else if (key === "删除") draft = draft.slice(0, -1);
      else if (/^[0-9]$/.test(key) && draft.length < 5) draft = (draft === "0" ? "" : draft) + key;
      this.setData({ durationDraft: draft, durationError: "" });
    },
    cancelDuration() {
      this.setData({ durationEditorOpen: false, durationError: "" });
    },
    confirmDuration() {
      if (this.data.saving || this.data.submissionStarted) return;
      try { time.withDuration(this.data.form, this.data.durationDraft); }
      catch (error) { this.setData({ durationError: error.message }); return; }
      this.changeDuration(String(Number(this.data.durationDraft)), true);
      this.setData({ durationEditorOpen: false, durationError: "" });
    },
    inputDuration(e) {
      this.changeDuration(e.detail.value, true);
    },
    changeDuration(value, customDuration) {
      if (this.data.saving || this.data.submissionStarted) return;
      this.setData({ duration: value, customDuration });
      this._dirty = true;
      try {
        this.setData({
          form: time.withDuration(this.data.form, value),
          error: "",
        });
        this.updateButton();
      } catch (error) {
        this.setData({ error: error.message });
      }
    },
    inputDeadline(e) {
      if (this.data.saving || this.data.submissionStarted) return;
      const value = e.detail.value;
      this.setData({ deadlineDays: value });
      this._dirty = true;
      try {
        if (!/^\d+$/.test(value) || Number(value) <= 0)
          throw new Error("请输入大于 0 的整数天数。");
        this.setData({
          form: time.withDuration(this.data.form, Number(value) * 1440),
          error: "",
        });
        this.updateButton();
      } catch (error) {
        this.setData({ error: error.message });
      }
    },
    createWithConflict: editor.createWithConflict,
    toggleOptions: editor.toggleOptions,
    noop() {},
    async loadApplications() {
      this.setData({ loading: true, error: "" });
      try {
        if (!auth.hasSession()) throw new Error("UNAUTHORIZED");
        const items = [],
          seen = new Set();
        let cursor;
        do {
          const result = await api.listApplications({
            scope: "active",
            limit: 100,
            cursor,
          });
          items.push(
            ...result.items
              .filter((a) => scheduleMode(a))
              .map((a) => ({
                ...c.applicationCard(a),
                scheduleMode: scheduleMode(a),
              })),
          );
          cursor = result.next_cursor;
          if (cursor && seen.has(cursor)) throw new Error("重复的分页游标");
          seen.add(cursor);
        } while (cursor);
        if (this._disposed) return;
        this.setData({ applications: items });
        this.filterApplications();
      } catch (error) {
        if (!this._disposed) this.setData({ error: c.errorText(error) });
      } finally {
        if (!this._disposed) this.setData({ loading: false });
      }
    },
    search(e) {
      this.setData({ keyword: e.detail.value });
      this.filterApplications();
    },
    filterApplications() {
      const term = this.data.keyword.trim().toLowerCase();
      this.setData({
        filtered: this.data.applications.filter((a) =>
          `${a.company_name_snapshot} ${a.job_title_snapshot}`
            .toLowerCase()
            .includes(term),
        ),
      });
    },
    async selectApplication(e) {
      if (this.data.loading || this.data.saving) return;
      this.setData({ loading: true, error: "" });
      try {
        const { application } = await api.getApplication(
          e.currentTarget.dataset.id,
        );
        if (this._disposed) return;
        const mode = scheduleMode(application);
        if (!mode) throw new Error("INTERVIEW_INVALID_TRANSITION");
        const view = c.applicationView(application);
        const form = f.defaults(
          mode === "stage" ? "interview" : application.current_stage.stage_type,
        );
        form.startDate = this.properties.date || c.dateParts().date;
        form.startTime = "";
        form.endDate = form.startDate;
        form.endTime = "";
        form.stageLabel =
          mode === "schedule" ? application.current_stage.stage_label : "";
        this._stageRequest = c.uuid();
        this._sessionRequest = c.uuid();
        this._stageSaved = false;
        this._stagePayload = null;
        this._drafts = {};
        this._dirty = false;
        this.setData({
          app: application,
          form,
          mode,
          choosing: false,
          partial: "",
          conflict: false,
          stageLocked: false,
          submissionStarted: false,
          optionsExpanded: false,
          timeEditorOpen: false,
          duration: "60",
          customDuration: false,
          deadlineDays: "3",
          selectedStage: view.stageLabel,
          selectedLabel: `${application.company_name_snapshot} · ${application.job_title_snapshot}`,
          stageHint:
            mode === "stage"
              ? `${view.stageLabel} · 添加下一阶段及安排`
              : `${view.stageLabel} · 待安排`,
          stageTone: mode === "stage" ? "success" : "accent",
          types: [
            "assessment",
            "written_test",
            "ai_interview",
            "interview",
          ].map((value) => ({ value, label: c.stageNames[value] })),
        });
        this.updateButton();
      } catch (error) {
        if (!this._disposed) this.setData({ error: c.errorText(error) });
      } finally {
        if (!this._disposed) this.setData({ loading: false });
      }
    },
    input(e) {
      if (this.data.saving || this.data.submissionStarted) return;
      editor.input.call(this, e);
    },
    selectType(e) {
      if (this.data.submissionStarted || this.data.saving) return;
      if (
        !this.data.types.some((t) => t.value === e.currentTarget.dataset.type)
      )
        return;
      const dates = {
        startDate: this.data.form.startDate,
        startTime: this.data.form.startTime,
        endDate: this.data.form.endDate,
        endTime: this.data.form.endTime,
      };
      const hadDraft =
        this._drafts && this._drafts[e.currentTarget.dataset.type];
      editor.selectType.call(this, e);
      if (!hadDraft) this.setData({ form: { ...this.data.form, ...dates } });
      try {
        if (usesDuration(this.data.form.stageType))
          this.setData({
            form: time.withDuration(this.data.form, this.data.duration),
            error: "",
          });
        if (this.data.form.stageType === "assessment")
          this.setData({
            form: time.withDuration(
              this.data.form,
              Number(this.data.deadlineDays) * 1440,
            ),
            error: "",
          });
      } catch (error) {
        this.setData({ error: error.message });
      }
      this.updateButton();
      this._dirty = true;
    },
    async changeApplication() {
      if (this.data.saving || this.data.submissionStarted) return;
      if (
        this._dirty &&
        !(await c.confirm(
          "重新选择？",
          "返回公司和岗位列表后，当前未保存的安排内容将清空。",
          "重新选择",
        ))
      )
        return;
      this._dirty = false;
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      this.setData({ choosing: true, error: "" });
    },
    async close() {
      if (this.data.saving || this._closing) return;
      if (
        (this._dirty || this.data.submissionStarted) &&
        !(await c.confirm(
          "关闭添加安排？",
          this.data.submissionStarted
            ? "请求可能已保存部分内容，关闭后请刷新求职进度再继续。"
            : "尚未保存的填写内容将丢弃。",
          "关闭",
        ))
      )
        return;
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      c.sheetMotion.dismiss(this, { refresh: this.data.submissionStarted });
    },
    async save() {
      if (
        this.data.durationEditorOpen ||
        this.data.loading ||
        this.data.choosing ||
        this.data.saving ||
        !this.data.app ||
        this.data.conflict
      )
        return;
      try {
        if (usesDuration(this.data.form.stageType))
          time.withDuration(this.data.form, this.data.duration);
        if (
          this.data.form.stageType === "assessment" &&
          (!/^\d+$/.test(this.data.deadlineDays) ||
            Number(this.data.deadlineDays) <= 0)
        )
          throw new Error("请输入大于 0 的整数天数。");
        if (this.data.requireSchedule) f.timeRange(this.data.form, true);
        if (this.data.mode === "stage")
          f.stagePayload(
            this.data.app,
            this.data.form,
            this._stageRequest,
            this.data.resumes,
          );
        if (this.data.form.stageType === "offer")
          f.offerPayload(this.data.app, this.data.form);
      } catch (error) {
        this.setData({ error: error.message });
        return;
      }
      this.setData({ submissionStarted: true });
      return editor.save.call(this);
    },
    onSaved() {
      this.triggerEvent("saved", { date: this.data.form.startDate });
    },
  },
});
module.exports.scheduleMode = scheduleMode;
