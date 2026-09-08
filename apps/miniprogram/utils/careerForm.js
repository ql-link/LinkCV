const c = require("./career");
function defaults(type = "interview") {
  return {
    stageType: type,
    stageLabel: "",
    round: "",
    startDate: type === "assessment" ? c.dateParts().date : "",
    startTime: type === "assessment" ? "09:00" : "",
    endDate: "",
    endTime: "",
    modeIndex: type === "interview" ? 0 : 3,
    meetingUrl: "",
    location: "",
    interviewer: "",
    preparation: "",
    notes: "",
    appliedDate: "",
    resumeIndex: 0,
    baseLocation: "",
    salary: "",
    currencyIndex: 0,
    periodIndex: 0,
    benefits: "",
    reasonIndex: 0,
    record: "",
  };
}
function timeRange(form, required = false) {
  const hasStart = !!(form.startDate || form.startTime),
    hasEnd = !!(form.endDate || form.endTime);
  if (form.stageType === "assessment" && (!form.startDate || !form.startTime))
    throw new Error("请填写测评开始时间。");
  if (!hasStart && !hasEnd && !required) return null;
  if (form.stageType === "assessment" && !hasEnd && !required) return null;
  if (!form.startDate || !form.startTime || !form.endDate || !form.endTime)
    throw new Error("请完整填写开始和结束日期、时间。");
  const start_at = c.iso(form.startDate, form.startTime),
    end_at = c.iso(form.endDate, form.endTime);
  if (new Date(end_at) <= new Date(start_at))
    throw new Error("结束时间必须晚于开始时间。");
  return { start_at, end_at, timezone: c.TZ };
}
function stagePayload(app, form, requestId, resumes) {
  if (form.stageType === "interview" && !form.stageLabel.trim())
    throw new Error("请填写面试阶段名称，例如技术二面、HR 面。");
  const round = form.round ? Number(form.round) : null;
  if (
    round !== null &&
    (!Number.isInteger(round) || round < 1 || round > 65535)
  )
    throw new Error("面试轮次须为 1–65535 的整数。");
  return {
    client_request_id: requestId,
    base_lock_version: app.lock_version,
    stage_type: form.stageType,
    ...(form.stageType === "interview"
      ? { stage_label: form.stageLabel.trim(), interview_round_no: round }
      : {}),
    ...(app.phase === "pending" && form.appliedDate
      ? { applied_at: c.iso(form.appliedDate, "00:00") }
      : {}),
    ...(app.phase === "pending" && Number(form.resumeIndex) > 0
      ? { resume_id: resumes[Number(form.resumeIndex)].id }
      : {}),
  };
}
function offerPayload(app, form) {
  const salary = form.salary.trim();
  if (
    salary &&
    (!/^\d+(\.\d{1,2})?$/.test(salary) || Number(salary) > 9999999999.99)
  )
    throw new Error("请填写有效薪资，最多保留两位小数。");
  return {
    base_lock_version: app.lock_version,
    base_location: form.baseLocation.trim() || null,
    salary: salary || null,
    salary_currency: salary
      ? ["CNY", "USD", "HKD", "EUR"][Number(form.currencyIndex)]
      : null,
    salary_period: salary
      ? ["month", "year", "day", "hour"][Number(form.periodIndex)]
      : null,
    benefits_description: form.benefits.trim() || null,
  };
}
function schedulePayload(app, form, requestId, required) {
  const times = timeRange(form, required);
  if (!times) return null;
  const stage = app.current_stage;
  if (!stage) throw new Error("当前阶段不可安排，请刷新求职详情。");
  return {
    ...times,
    client_request_id: requestId,
    application_stage_id: stage.id,
    stage_type: stage.stage_type === "interview" ? "interview" : "other",
    stage_label: stage.stage_label,
    round_no:
      stage.stage_type === "interview" ? stage.interview_round_no || 1 : null,
    mode: c.modes[Number(form.modeIndex)].value,
    meeting_url: form.meetingUrl.trim() || null,
    location: form.location.trim() || null,
    interviewer_name: form.interviewer.trim() || null,
    preparation_note: form.preparation.trim() || null,
  };
}
module.exports = {
  defaults,
  timeRange,
  stagePayload,
  offerPayload,
  schedulePayload,
};
