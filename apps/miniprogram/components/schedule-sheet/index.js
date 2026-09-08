const auth = require("../../services/auth");
const api = require("../../services/career");
const c = require("../../utils/career");
const f = require("../../utils/careerForm");
const time = require("../../utils/careerTime");
const editor = require("../../utils/careerEditor")();
function dateLabel(date) {
  if (!date) return '选择日期';
  const [, month, day] = date.split('-');
  return Number(month) + '月' + Number(day) + '日';
}
function scheduleMode(application) {
  const view = c.applicationView(application);
  if (application.archived_at || application.phase !== "applied" || !application.applied_at || !view.canAdvance) return null;
  if (application.stage_state === "awaiting_result") return "stage";
  return null;
}
Component({
  properties: { date: {type: String, value: ""} },
  data: {
    ...editor.data,
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
    duration: "60", customDuration: false, durationOptions: [30,60,90], deadlineDays: "3",
    pickerDate: "", pickerTime: "", pickerTitle: "选择面试时间",
    startLabel: "选择开始时间",
    endLabel: "选择结束时间",
    rangeLabel: "选择日期与时间",
  },
  lifetimes: {
    attached() { this.loadApplications(); },
    detached() { this._disposed = true; },
  },
  methods: {
    updateButton() {
      const form = this.data.form;
      this.setData({buttonLabel: this.data.submissionStarted ? "重试保存安排" : "保存安排", startLabel: form.startTime ? form.startDate + ' ' + form.startTime : '选择开始时间', endLabel: form.endTime ? dateLabel(form.endDate) + ' ' + form.endTime : '选择结束时间', rangeLabel: form.startTime && form.endTime ? dateLabel(form.startDate) + ' ' + form.startTime + '–' + (form.endDate !== form.startDate ? dateLabel(form.endDate) + ' ' : '') + form.endTime : '选择日期与时间'});
    },
    openTimeEditor(e) {
      if (this.data.saving || this.data.submissionStarted) return;
      const target = e.currentTarget.dataset.target;
      if (!['start', 'end', 'range'].includes(target)) return;
      this.setData({timeEditorOpen: true, timeTarget: target, timeDraft: {...this.data.form}, timeError: ''});
    },
    editTimeDraft(e) {
      const field = e.currentTarget.dataset.field;
      if (!['startDate', 'startTime', 'endDate', 'endTime'].includes(field)) return;
      this.setData({timeDraft: {...this.data.timeDraft, [field]: e.detail.value}, timeError: ''});
    },
    cancelTimeEditor() { this.setData({timeEditorOpen: false, timeError: ''}); },
    confirmTimeEditor() {
      if (this.data.saving || this.data.submissionStarted) return;
      const target = this.data.timeTarget, draft = this.data.timeDraft;
      const fields = target === 'range' ? ['startDate', 'startTime', 'endDate', 'endTime'] : [target + 'Date', target + 'Time'];
      if (fields.some(field => !draft[field])) { this.setData({timeError: '请完整选择日期与时间。'}); return; }
      const form = {...this.data.form};
      fields.forEach(field => { form[field] = draft[field]; });
      try {
        if (form.startTime && form.endTime) f.timeRange(form, true);
      } catch (error) { this.setData({timeError: error.message}); return; }
      this.setData({form, timeEditorOpen: false, timeError: '', error: ''});
      this._dirty = true;
      if (wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({message: '当前填写内容尚未保存，离开后会丢失。'});
      this.updateButton();
    },
    chooseDateTime(e) {
      if (this.data.saving || this.data.submissionStarted) return;
      const target=e.currentTarget.dataset.target;
      this.setData({timeEditorOpen:true,timeTarget:target,pickerDate:this.data.form[target+'Date'] || this.properties.date || c.dateParts().date,pickerTime:this.data.form[target+'Time'],pickerTitle:target==='end'?'选择结束时间':this.data.form.stageType==='interview'?'选择面试时间':'选择开始时间'});
    },
    acceptDateTime(e) {
      if (this.data.saving || this.data.submissionStarted) return;
      let form={...this.data.form,[this.data.timeTarget+'Date']:e.detail.date,[this.data.timeTarget+'Time']:e.detail.time};
      try {
        if(form.stageType==='interview') form=time.withDuration(form,this.data.duration);
        if(form.stageType==='assessment') form=time.withDuration(form,Number(this.data.deadlineDays)*1440);
        if(form.startTime && form.endTime) f.timeRange(form,true);
      } catch(error) { this.setData({error:error.message});return; }
      this.setData({form,timeEditorOpen:false,error:''});this._dirty=true;this.updateButton();
    },
    selectDuration(e) {
      if(this.data.saving || this.data.submissionStarted)return;
      const value=e.currentTarget.dataset.minutes;
      if(value==='custom'){this.setData({customDuration:true});return;}
      this.changeDuration(String(value),false);
    },
    inputDuration(e){this.changeDuration(e.detail.value,true);},
    changeDuration(value,customDuration){
      if(this.data.saving || this.data.submissionStarted)return;
      this.setData({duration:value,customDuration});this._dirty=true;
      try{this.setData({form:time.withDuration(this.data.form,value),error:''});this.updateButton();}
      catch(error){this.setData({error:error.message});}
    },
    inputDeadline(e){
      if(this.data.saving || this.data.submissionStarted)return;
      const value=e.detail.value;this.setData({deadlineDays:value});this._dirty=true;
      try{if(!/^\d+$/.test(value)||Number(value)<=0)throw new Error('请输入大于 0 的整数天数。');this.setData({form:time.withDuration(this.data.form,Number(value)*1440),error:''});this.updateButton();}catch(error){this.setData({error:error.message});}
    },
    createWithConflict: editor.createWithConflict,
    noop() {},
    async loadApplications() {
      this.setData({loading: true, error: ""});
      try {
        if (!auth.hasSession()) throw new Error("UNAUTHORIZED");
        const items = [], seen = new Set();
        let cursor;
        do {
          const result = await api.listApplications({scope: "active", limit: 100, cursor});
          items.push(...result.items.filter(a => scheduleMode(a)).map(a => ({...c.applicationCard(a), scheduleMode: scheduleMode(a)})));
          cursor = result.next_cursor;
          if (cursor && seen.has(cursor)) throw new Error("重复的分页游标");
          seen.add(cursor);
        } while (cursor);
        if (this._disposed) return;
        this.setData({applications: items});
        this.filterApplications();
      } catch (error) {
        if (!this._disposed) this.setData({error: c.errorText(error)});
      } finally {
        if (!this._disposed) this.setData({loading: false});
      }
    },
    search(e) {
      this.setData({keyword: e.detail.value});
      this.filterApplications();
    },
    filterApplications() {
      const term = this.data.keyword.trim().toLowerCase();
      this.setData({filtered: this.data.applications.filter(a => `${a.company_name_snapshot} ${a.job_title_snapshot}`.toLowerCase().includes(term))});
    },
    async selectApplication(e) {
      if (this.data.loading || this.data.saving) return;
      this.setData({loading: true, error: ""});
      try {
        const {application} = await api.getApplication(e.currentTarget.dataset.id);
        if (this._disposed) return;
        const mode = scheduleMode(application);
        if (!mode) throw new Error("INTERVIEW_INVALID_TRANSITION");
        const view = c.applicationView(application);
        const form = f.defaults(mode === "stage" ? "interview" : application.current_stage.stage_type);
        form.startDate = this.properties.date || c.dateParts().date;
        form.startTime = "";
        form.endDate = form.startDate;
        form.endTime = "";
        form.stageLabel = mode === "schedule" ? application.current_stage.stage_label : "";
        this._stageRequest = c.uuid();
        this._sessionRequest = c.uuid();
        this._stageSaved = false;
        this._stagePayload = null;
        this._drafts = {};
        this._dirty = false;
        this.setData({app: application, form, mode, choosing: false, partial: "", conflict: false, stageLocked: false, submissionStarted: false, optionsExpanded: false, timeEditorOpen: false, duration: "60", customDuration:false, deadlineDays:"3", selectedStage: view.stageLabel, selectedLabel: `${application.company_name_snapshot} · ${application.job_title_snapshot}`, stageHint: mode === "stage" ? `${view.stageLabel} · 添加下一阶段及安排` : `${view.stageLabel} · 待安排`, stageTone: mode === "stage" ? "success" : "accent", types: ["assessment", "written_test", "ai_interview", "interview"].map(value => ({value, label: c.stageNames[value]}))});
        this.updateButton();
      } catch (error) {
        if (!this._disposed) this.setData({error: c.errorText(error)});
      } finally {
        if (!this._disposed) this.setData({loading: false});
      }
    },
    input(e) {
      if (this.data.saving || this.data.submissionStarted) return;
      editor.input.call(this, e);
    },
    selectType(e) {
      if (this.data.submissionStarted || this.data.saving) return;
      if (!this.data.types.some(t => t.value === e.currentTarget.dataset.type)) return;
      const dates = {startDate: this.data.form.startDate, startTime: this.data.form.startTime, endDate: this.data.form.endDate, endTime: this.data.form.endTime};
      const hadDraft = this._drafts && this._drafts[e.currentTarget.dataset.type];
      editor.selectType.call(this, e);
      if (!hadDraft) this.setData({form: {...this.data.form, ...dates}});
      try {
        if (this.data.form.stageType === 'interview') this.setData({form:time.withDuration(this.data.form,this.data.duration),error:''});
        if (this.data.form.stageType === 'assessment') this.setData({form:time.withDuration(this.data.form,Number(this.data.deadlineDays)*1440),error:''});
      } catch(error) { this.setData({error:error.message}); }
      this.updateButton();
      this._dirty = true;
    },
    async changeApplication() {
      if (this.data.saving || this.data.submissionStarted) return;
      if (this._dirty && !(await c.confirm("重新选择？", "返回公司和岗位列表后，当前未保存的安排内容将清空。", "重新选择"))) return;
      this._dirty = false;
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      this.setData({choosing: true, error: ""});
    },
    async close() {
      if (this.data.saving) return;
      if ((this._dirty || this.data.submissionStarted) && !(await c.confirm("关闭添加安排？", this.data.submissionStarted ? "请求可能已保存部分内容，关闭后请刷新求职进度再继续。" : "尚未保存的填写内容将丢弃。", "关闭"))) return;
      if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload();
      this.triggerEvent("close", {refresh: this.data.submissionStarted});
    },
    async save() {
      if (this.data.loading || this.data.choosing || this.data.saving || !this.data.app || this.data.conflict) return;
      try {
        if(this.data.form.stageType === "interview") time.withDuration(this.data.form,this.data.duration);
        if(this.data.form.stageType === "assessment" && (!/^\d+$/.test(this.data.deadlineDays) || Number(this.data.deadlineDays)<=0)) throw new Error("请输入大于 0 的整数天数。");
        f.timeRange(this.data.form, true);
        if (this.data.mode === "stage") f.stagePayload(this.data.app, this.data.form, this._stageRequest, []);
      } catch (error) { this.setData({error: error.message}); return; }
      this.setData({submissionStarted: true});
      return editor.save.call(this);
    },
    onSaved() {
      this.triggerEvent("saved", {date: this.data.form.startDate});
    },
  },
});
module.exports.scheduleMode = scheduleMode;
