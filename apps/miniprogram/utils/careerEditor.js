// Shared editor behavior for standalone forms and the schedule sheet.
module.exports = function createCareerEditor() {
  const auth = require("../services/auth");
  const api = require("../services/career");
  const resumeApi = require("../services/resumes");
  const c = require("./career");
  const f = require("./careerForm");
  const titles = {
    stage: "添加下一阶段",
    schedule: "添加安排",
    record: "填写面试记录",
    prepare: "编辑准备内容",
    terminate: "终止求职",
    offer: "编辑 Offer 信息",
  };
  return {
    data: {
      loading: true,
      saving: false,
      error: "",
      partial: "",
      stageLocked: false,
      optionsExpanded: false,
      applicationId: "",
      sessionId: "",
      mode: "stage",
      app: null,
      session: null,
      form: f.defaults(),
      types: [],
      resumes: [{ title: "暂不关联简历", id: "" }],
      modes: c.modes,
      currencies: ["CNY", "USD", "HKD", "EUR"],
      periods: ["每月", "每年", "每天", "每小时"],
      reasons: ["公司未通过", "主动放弃", "放弃 Offer", "求职已结束", "其他原因"],
      buttonLabel: "保存阶段",
    },
    onLoad(options) {
      this.setData({
        applicationId: options.applicationId || "",
        sessionId: options.sessionId || "",
        mode: titles[options.mode] ? options.mode : "stage",
      });
      this._stageRequest = c.uuid();
      this._sessionRequest = c.uuid();
      this._terminateRequest = c.uuid();
      wx.setNavigationBarTitle({
        title:
          options.sessionId && options.mode === "schedule"
            ? "修改安排"
            : titles[this.data.mode],
      });
      return this.load();
    },
    async load() {
      if (!auth.hasSession()) {
        this.setData({
          loading: false,
          error: "登录已失效，请返回求职页重新登录。",
          app: null,
        });
        return;
      }
      this.setData({ loading: true, error: "" });
      try {
        const body = this.data.sessionId
          ? await api.getSession(this.data.sessionId)
          : await api.getApplication(this.data.applicationId);
        const app = body.application,
          session = body.session;
        const type =
          this.data.mode === "stage"
            ? app.phase === "pending"
              ? "screening"
              : "interview"
            : app.current_stage
              ? app.current_stage.stage_type
              : "interview";
        const form = f.defaults(type);
        if (session) {
          Object.assign(form, {
            stageLabel: session.stage_label,
            startDate: c.dateParts(session.start_at).date,
            startTime: c.dateParts(session.start_at).time,
            endDate: c.dateParts(session.end_at).date,
            endTime: c.dateParts(session.end_at).time,
            modeIndex: Math.max(
              0,
              c.modes.findIndex((m) => m.value === session.mode),
            ),
            meetingUrl: session.meeting_url || "",
            location: session.location || "",
            interviewer: session.interviewer_name || "",
            preparation: session.preparation_note || "",
            record: session.questions_markdown || "",
          });
        }
        if (this.data.mode === "offer")
          Object.assign(form, {
            baseLocation: app.offer_base_location || "",
            salary: app.offer_salary == null ? "" : String(app.offer_salary),
            currencyIndex: Math.max(
              0,
              this.data.currencies.indexOf(app.offer_salary_currency),
            ),
            periodIndex: Math.max(
              0,
              ["month", "year", "day", "hour"].indexOf(app.offer_salary_period),
            ),
            benefits: app.offer_benefits_description || "",
          });
        const types = Object.keys(c.stageNames)
          .filter((key) => app.phase === "pending" || key !== "screening")
          .map((value) => ({
            value,
            label: value === "offer" ? "Offer" : c.stageNames[value],
          }));
        this.setData({ app, session: session || null, form, types });
        if (app.phase === "pending" && this.data.mode === "stage") {
          wx.setNavigationBarTitle({ title: "记录投递信息" });
          try {
            const resumes = await resumeApi.listResumes();
            this.setData({
              resumes: [{ id: "", title: "暂不关联简历" }, ...resumes],
            });
          } catch (_) {
            this.setData({
              resumeError: "简历列表加载失败，可暂不关联简历或重试。",
            });
          }
        }
        this.updateButton();
      } catch (e) {
        this.setData({ error: c.errorText(e) });
      } finally {
        this.setData({ loading: false });
      }
    },
    async retryResumes() {
      try {
        this.setData({
          resumes: [
            { id: "", title: "暂不关联简历" },
            ...(await resumeApi.listResumes()),
          ],
          resumeError: "",
        });
      } catch (_) {
        this.setData({ resumeError: "简历列表加载失败，请重试。" });
      }
    },
    input(e) {
      if (this.data.saving) return;
      const field = e.currentTarget.dataset.field;
      this.setData({ form: { ...this.data.form, [field]: e.detail.value } });
      this._dirty = true;
      if (wx.enableAlertBeforeUnload)
        wx.enableAlertBeforeUnload({
          message: "当前填写内容尚未保存，离开后会丢失。",
        });
      this.updateButton();
    },
    selectType(e) {
      if (this.data.stageLocked || this.data.saving) return;
      this._drafts = this._drafts || {};
      this._drafts[this.data.form.stageType] = { ...this.data.form };
      const type = e.currentTarget.dataset.type;
      this.setData({
        form: this._drafts[type] || {
          ...f.defaults(type),
          appliedDate: this.data.form.appliedDate,
          resumeIndex: this.data.form.resumeIndex,
        },
        error: "",
      });
      this.updateButton();
    },
    async returnToDetail() {
      if (
        !(await c.confirm(
          "返回详情重新加载？",
          "未保存的表单内容会丢弃；已经保存的阶段和安排仍会保留。",
          "返回详情",
        ))
      )
        return;
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      wx.navigateBack({
        fail: () => wx.switchTab({ url: "/pages/career/index" }),
      });
    },
    toggleOptions() { this.setData({optionsExpanded: !this.data.optionsExpanded}); },
    cancelEdit() {
      if (this.data.saving) return;
      wx.navigateBack({fail: () => wx.switchTab({url: "/pages/career/index"})});
    },
    clearTimes() {
      if (!this.data.saving)
        this.setData({
          form: {
            ...this.data.form,
            startDate:
              this.data.form.stageType === "assessment" ? c.dateParts().date : "",
            startTime: this.data.form.stageType === "assessment" ? "09:00" : "",
            endDate: "",
            endTime: "",
          },
        });
    },
    updateButton() {
      const { mode, form, sessionId, app, partial } = this.data;
      const label = partial
        ? mode === "schedule"
          ? "重试保存安排信息"
          : form.stageType === "offer"
            ? "重试保存 Offer 信息"
            : "重试添加安排"
        : {
            record: "保存面试记录",
            prepare: "保存准备内容",
            terminate: "确认终止本次求职",
            schedule: sessionId ? "保存安排修改" : "保存安排",
            offer: "保存 Offer 信息",
          }[mode] ||
          (form.stageType === "offer"
            ? "保存 Offer 信息"
            : app && app.phase === "pending"
              ? "保存投递信息"
              : `保存${c.stageNames[form.stageType]}阶段`);
      this.setData({ buttonLabel: label });
    },
    async save() {
      if (this.data.saving || !this.data.app) return;
      let { app, form, session, mode } = this.data;
      try {
        if (this.data.requireSchedule) f.timeRange(form, true);
        if (mode === "stage") {
          f.stagePayload(app, form, this._stageRequest, this.data.resumes);
          if (!["offer", "screening"].includes(form.stageType)) f.timeRange(form);
          if (form.stageType === "offer") f.offerPayload(app, form);
        }
        if (mode === "schedule") f.timeRange(form, true);
        if (mode === "offer") f.offerPayload(app, form);
      } catch (e) {
        this.setData({ error: e.message });
        return;
      }
      if (
        mode === "terminate" &&
        !(await c.confirm(
          "确认终止这次求职？",
          "将停止跟进这次求职，已有阶段和面试记录仍会保留。",
          "终止求职",
        ))
      )
        return;
      this.setData({ saving: true, error: "" });
      try {
        if (mode === "stage") {
          if (!this._stageSaved) {
            this._stagePayload =
              this._stagePayload ||
              f.stagePayload(app, form, this._stageRequest, this.data.resumes);
            this.setData({ stageLocked: true });
            const result = await api.addStage(app.id, this._stagePayload);
            app = result.application;
            this._stageSaved = true;
            this.setData({ app });
          }
          if (form.stageType === "offer") {
            await api.saveOffer(app.id, f.offerPayload(app, form));
          } else if (form.stageType !== "screening") {
            const payload = f.schedulePayload(
              app,
              form,
              this._sessionRequest,
              false,
            );
            if (payload) await this.createWithConflict(app.id, payload);
          }
        } else if (mode === "offer") {
          await api.saveOffer(app.id, f.offerPayload(app, form));
        } else if (mode === "schedule") {
          if (!session) {
            await this.createWithConflict(
              app.id,
              f.schedulePayload(app, form, this._sessionRequest, true),
            );
          } else {
            const times = f.timeRange(form, true);
            if (
              new Date(times.start_at).getTime() !==
                new Date(session.start_at).getTime() ||
              new Date(times.end_at).getTime() !==
                new Date(session.end_at).getTime()
            ) {
              const payload = {
                ...times,
                base_lock_version: session.lock_version,
              };
              let result;
              try {
                result = await api.rescheduleSession(session.id, payload);
              } catch (e) {
                if (
                  e.message !== "INTERVIEW_TIME_CONFLICT" ||
                  !(await c.confirm(
                    "安排时间重叠",
                    "这段时间已有其他安排，仍要保存吗？",
                    "仍然保存",
                  ))
                )
                  throw e;
                result = await api.rescheduleSession(session.id, {
                  ...payload,
                  allow_conflict: true,
                });
              }
              session = result.session;
              this._timeSaved = true;
              this.setData({ session });
            }
            await api.updateSession(session.id, {
              base_lock_version: session.lock_version,
              mode: c.modes[Number(form.modeIndex)].value,
              meeting_url: form.meetingUrl.trim() || null,
              location: form.location.trim() || null,
              interviewer_name: form.interviewer.trim() || null,
              preparation_note: form.preparation.trim() || null,
            });
          }
        } else if (mode === "record" || mode === "prepare") {
          await api.updateSession(session.id, {
            base_lock_version: session.lock_version,
            [mode === "record" ? "questions_markdown" : "preparation_note"]:
              (mode === "record" ? form.record : form.preparation).trim() || null,
          });
        } else if (mode === "terminate") {
          await api.terminateApplication(app.id, {
            base_lock_version: app.lock_version,
            client_request_id: this._terminateRequest,
            reason: [
              "company_rejected",
              "user_withdrew",
              "offer_declined",
              "completed",
              "other",
            ][Number(form.reasonIndex)],
          });
        }
        this._dirty = false;
        if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
        wx.showToast({ title: "已保存", icon: "success" });
        this.onSaved();
      } catch (e) {
        const partial =
          mode === "stage" && this._stageSaved
            ? form.stageType === "offer"
              ? "Offer 阶段已保存，但待遇信息未保存成功。请在此重试，无需重复添加阶段。"
              : "求职阶段已保存，但安排未保存成功。请在此重试，无需重复添加阶段。"
            : mode === "schedule" && this._timeSaved
              ? "时间修改已保存，其余安排信息未保存成功。请重试保存。"
              : "";
        this.setData({
          error: c.errorText(e),
          partial,
          conflict: [
            "INTERVIEW_EDIT_CONFLICT",
            "INTERVIEW_INVALID_TRANSITION",
          ].includes(e.message),
        });
        this.updateButton();
      } finally {
        this.setData({ saving: false });
      }
    },
    onSaved() {
      wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/career/index" }) });
    },
    async createWithConflict(id, payload) {
      try {
        return await api.createSession(id, payload);
      } catch (e) {
        if (
          e.message !== "INTERVIEW_TIME_CONFLICT" ||
          !(await c.confirm(
            "安排时间重叠",
            "这段时间已有其他安排，仍要保存吗？",
            "仍然保存",
          ))
        )
          throw e;
        return api.createSession(id, { ...payload, allow_conflict: true });
      }
    },
  };
};
