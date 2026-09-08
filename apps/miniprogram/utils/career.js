const TZ = "Asia/Shanghai";
const stageNames = {
  screening: "筛选中",
  assessment: "测评",
  written_test: "笔试",
  ai_interview: "AI 面试",
  interview: "普通面试",
  offer: "已收到 Offer",
};
const modes = [
  { value: "video", label: "视频面试" },
  { value: "onsite", label: "现场面试" },
  { value: "phone", label: "电话面试" },
  { value: "other", label: "其他 / 在线测评" },
];
function dateParts(value = new Date()) {
  const date = new Date(new Date(value).getTime() + 8 * 3600000);
  if (!Number.isFinite(date.getTime())) return { date: "", time: "" };
  return {
    date: date.toISOString().slice(0, 10),
    time: date.toISOString().slice(11, 16),
  };
}
function dayLabel(value) {
  const date = dateParts(value).date;
  if (!date) return "";
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][new Date(date + "T00:00:00Z").getUTCDay()];
  return Number(date.slice(5, 7)) + "月" + Number(date.slice(8, 10)) + "日 · 周" + weekday;
}
function shortDate(value) {
  const p = dateParts(value);
  return p.date ? Number(p.date.slice(5, 7)) + "月" + Number(p.date.slice(8, 10)) + "日" : "";
}
function iso(date, time) {
  return date && time ? `${date}T${time}:00+08:00` : null;
}
function shiftDate(date, amount) {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
function range(session) {
  const a = dateParts(session.start_at);
  const b = dateParts(session.end_at);
  return `${a.date} ${a.time}–${a.date === b.date ? "" : b.date + " "}${b.time}`;
}
function sessionView(session) {
  const status =
    session.status === "completed"
      ? { label: "已完成", tone: "success", icon: "check" }
      : session.status === "cancelled"
        ? { label: "已取消", tone: "neutral", icon: "cancel" }
        : new Date(session.end_at).getTime() <= Date.now()
          ? { label: "等待结果", tone: "warning", icon: "clock" }
          : { label: "待进行", tone: "accent", icon: "clock" };
  return {
    ...session,
    statusLabel: status.label,
    tone: status.tone,
    icon: status.icon,
    timeLabel: range(session),
    shortTimeLabel: shortDate(session.start_at) + " " + dateParts(session.start_at).time + "–" + (dateParts(session.start_at).date === dateParts(session.end_at).date ? "" : shortDate(session.end_at) + " ") + dateParts(session.end_at).time,
    stageIcon: session.stage_type === "interview" || session.stage_type === "hr" ? "interview" : (session.stage_label || "").includes("测评") ? "assessment" : (session.stage_label || "").includes("AI") ? "ai_interview" : "written_test",
    shortModeLabel: {video:"视频",onsite:"现场",phone:"电话",other:"在线"}[session.mode] || "在线",
    modeLabel: (modes.find((m) => m.value === session.mode) || modes[3]).label,
  };
}
function applicationView(app, sessions = []) {
  const stage = app.current_stage;
  const kind = stage && stage.stage_type;
  const currentSessions = sessions.filter(
    (s) => s.application_stage_id === (stage && stage.id),
  );
  const scheduled = currentSessions.find((s) => s.status === "scheduled");
  const completed =
    currentSessions.some((s) => s.status === "completed") ||
    app.current_session_status === "completed";
  const ended =
    app.lifecycle_status === "terminated" ||
    app.status !== "active" ||
    !!app.archived_at;
  const offer =
    kind === "offer" ||
    app.offer_status === "received" ||
    app.offer_status === "accepted";
  let status = { label: "待投递", tone: "neutral", icon: "file" };
  if (ended) status = { label: "已终止", tone: "neutral", icon: "cancel" };
  else if (offer)
    status = { label: "已收到 Offer", tone: "offer", icon: "offer" };
  else if (app.phase === "applied") {
    status =
      kind === "screening"
        ? { label: "筛选中", tone: "neutral", icon: "screening" }
        : completed && !scheduled
          ? { label: "已完成", tone: "success", icon: "check" }
          : scheduled
            ? {
                label: sessionView(scheduled).statusLabel,
                tone: sessionView(scheduled).tone,
                icon: "clock",
              }
            : app.stage_state === "awaiting_result"
              ? { label: "等待结果", tone: "warning", icon: "clock" }
              : app.stage_state === "scheduled"
                ? { label: "待进行", tone: "accent", icon: "clock" }
                : { label: "待安排", tone: "accent", icon: "clock" };
  }
  return {
    ...app,
    stageLabel: stage
      ? stage.stage_label
      : app.phase === "pending"
        ? "待投递"
        : app.current_stage_label,
    stageType: kind,
    offerPeriodLabel:
      { month: "月", year: "年", day: "日", hour: "小时" }[
        app.offer_salary_period
      ] || "",
    statusLabel: status.label,
    tone: status.tone,
    icon: status.icon,
    canAdvance: !ended && !offer,
    canTerminate: !ended,
    canSchedule:
      !ended &&
      !offer &&
      ["assessment", "written_test", "ai_interview", "interview"].includes(
        kind,
      ) &&
      app.stage_state === "awaiting_schedule",
    appliedLabel: app.applied_at ? dateParts(app.applied_at).date : "尚未投递",
    nextLabel: app.next_session_start_at
      ? `${dateParts(app.next_session_start_at).date} ${dateParts(app.next_session_start_at).time}`
      : "",
    employmentLabel:
      { internship: "实习", campus: "校招", full_time: "正式" }[
        (app.job_snapshot || {}).employment_type
      ] || "未分类",
  };
}
// List setData payloads must not carry large JD snapshots or interview notes.
function applicationCard(app) {
  const view = applicationView(app);
  return Object.fromEntries(
    [
      "id",
      "company_name_snapshot",
      "job_title_snapshot",
      "phase",
      "stageLabel",
      "statusLabel",
      "tone",
      "icon",
      "canAdvance",
      "canTerminate",
      "canSchedule",
      "appliedLabel",
      "nextLabel",
      "employmentLabel",
    ].map((key) => [key, view[key] === undefined ? null : view[key]]),
  );
}
function sessionCard(session) {
  const view = sessionView(session);
  return Object.fromEntries(
    [
      "id",
      "application_stage_id",
      "company_name",
      "stage_label",
      "start_at",
      "end_at",
      "status",
      "statusLabel",
      "tone",
      "icon",
      "timeLabel",
      "modeLabel",
      "shortModeLabel",
      "shortTimeLabel",
      "stageIcon",
    ].map((key) => [key, view[key] === undefined ? null : view[key]]),
  );
}
// Interval partitioning keeps simultaneous interviews visible, including overnight events.
function timeline(sessions, date) {
  const start = new Date(iso(date, "00:00")).getTime();
  const end = start + 86400000;
  const items = sessions
    .filter(
      (s) =>
        s.status !== "cancelled" &&
        new Date(s.end_at) > start &&
        new Date(s.start_at) < end,
    )
    .map((s) => ({
      ...sessionCard(s),
      from: Math.max(0, (new Date(s.start_at) - start) / 60000),
      to: Math.min(1440, (new Date(s.end_at) - start) / 60000),
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const first = Math.min(8, ...items.map((s) => Math.floor(s.from / 60)));
  const last = Math.max(18, ...items.map((s) => Math.ceil(s.to / 60)));
  let cluster = [],
    ends = [],
    clusterEnd = -1;
  const finish = () => {
    for (const item of cluster) item.columns = ends.length;
  };
  for (const item of items) {
    if (item.from >= clusterEnd) {
      finish();
      cluster = [];
      ends = [];
    }
    let column = ends.findIndex((value) => value <= item.from);
    if (column < 0) column = ends.length;
    ends[column] = item.to;
    item.column = column;
    cluster.push(item);
    clusterEnd = Math.max(...ends);
  }
  finish();
  return {
    hours: Array.from(
      { length: last - first + 1 },
      (_, i) => `${String(first + i).padStart(2, "0")}:00`,
    ),
    height: (last - first) * 88 + 40,
    minimumHeight: (last - first) * 60,
    items: items.map((s) => ({
      ...s,
      fluidStyle: `top:${((s.from - first * 60) / ((last - first) * 60)) * 100}%;height:${((s.to - s.from) / ((last - first) * 60)) * 100}%;left:${(s.column / s.columns) * 100}%;width:${100 / s.columns}%;`,
      style: `top:${((s.from - first * 60) / 60) * 88}rpx;height:${Math.max(16, ((s.to - s.from) / 60) * 88 - 6)}rpx;left:${(s.column / s.columns) * 100}%;width:${100 / s.columns}%;`,
      compactTime: `${dateParts(s.start_at).time}–${dateParts(s.end_at).time}`,
    })),
    hasConflict: items.some((s) => s.columns > 1),
  };
}
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = Math.floor(Math.random() * 16);
    return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
}
function errorText(error) {
  return (
    {
      INTERVIEW_EDIT_CONFLICT: "这条记录已在其他设备更新，请刷新后再操作。",
      INTERVIEW_INVALID_TRANSITION:
        "当前阶段或场次状态已变化，请刷新后再操作。",
      INTERVIEW_TIME_CONFLICT: "这段时间已有其他安排。",
      INTERVIEW_NOT_FOUND: "记录不存在或已被删除。",
      INTERVIEW_RESUME_VERSION_REQUIRED:
        "所选简历没有可用的正式版本，请重新选择。",
      INVALID_INTERVIEW_TIME: "请检查开始和结束时间。",
      UNAUTHORIZED: "登录已失效，请重新登录。",
      RESUME_VERSION_UNAVAILABLE: "投递时的简历版本已不可用。",
    }[error.message] || "操作未完成，请检查网络后重试。"
  );
}
const confirm = (title, content, confirmText = "确定") =>
  new Promise((resolve) =>
    wx.showModal({
      title,
      content,
      confirmText,
      success: (r) => resolve(r.confirm),
      fail: () => resolve(false),
    }),
  );
module.exports = {
  TZ,
  stageNames,
  modes,
  dateParts,
  dayLabel,
  iso,
  shiftDate,
  range,
  sessionView,
  applicationView,
  applicationCard,
  sessionCard,
  timeline,
  uuid,
  errorText,
  confirm,
};
