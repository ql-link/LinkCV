const TZ = "Asia/Shanghai";
const stageNames = {
  screening: "筛选中",
  assessment: "测评",
  written_test: "笔试",
  ai_interview: "AI 面试",
  interview: "普通面试",
  offer: "已收到 Offer",
};
// Solid fills that keep white fallback initials at 4.5:1 or better.
const logoColors = {
  red: "#c43b3b",
  orange: "#b45309",
  yellow: "#8a6a00",
  green: "#267a4d",
  blue: "#145ed6",
  purple: "#6d28d9",
  gray: "#5f6b7d",
};
const chineseCount = { 2: "两", 3: "三", 4: "四", 5: "五" };
function logoBackground(color) {
  return logoColors[color] || logoColors.gray;
}
// Public HTTPS only: the snapshot comes from a user-controlled job page. 服务端还会投影
// 岗位自己托管 Logo 的相对地址，但 `/api/job-descriptions/{id}/logo` 需要 Bearer，而
// `<image>` 带不了凭据，所以这里同样按不可渲染处理，由 company-logo 回落到公司名称首字。
function logoSource(value) {
  return typeof value === "string" && value.startsWith("https://") ? value : "";
}
function logoInitial(name) {
  return (name || "").trim().slice(0, 1) || "企";
}
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
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][
    new Date(date + "T00:00:00Z").getUTCDay()
  ];
  return (
    Number(date.slice(5, 7)) +
    "月" +
    Number(date.slice(8, 10)) +
    "日 · 周" +
    weekday
  );
}
function shortDate(value) {
  if (!value) return "";
  const p = dateParts(value);
  return p.date
    ? Number(p.date.slice(5, 7)) + "月" + Number(p.date.slice(8, 10)) + "日"
    : "";
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
      ? { label: "已完成面试", tone: "success", icon: "check" }
      : session.status === "cancelled"
        ? { label: "已取消", tone: "neutral", icon: "cancel" }
        : new Date(session.end_at).getTime() <= Date.now()
          ? { label: "等待结果", tone: "warning", icon: "clock" }
          : {
              label: (session.stage_label || "").includes("测评")
                ? "待测评"
                : (session.stage_label || "").includes("笔试")
                  ? "待笔试"
                  : "待面试",
              tone: "accent",
              icon: "clock",
            };
  return {
    ...session,
    companyLogo: logoSource(session.company_logo_url),
    statusLabel: status.label,
    tone: status.tone,
    icon: status.icon,
    timeLabel: range(session),
    shortTimeLabel:
      shortDate(session.start_at) +
      " " +
      dateParts(session.start_at).time +
      "–" +
      (dateParts(session.start_at).date === dateParts(session.end_at).date
        ? ""
        : shortDate(session.end_at) + " ") +
      dateParts(session.end_at).time,
    stageIcon:
      session.stage_type === "interview" || session.stage_type === "hr"
        ? "interview"
        : (session.stage_label || "").includes("测评")
          ? "assessment"
          : (session.stage_label || "").includes("AI")
            ? "ai_interview"
            : "written_test",
    shortModeLabel:
      { video: "视频", onsite: "现场", phone: "电话", other: "在线" }[
        session.mode
      ] || "在线",
    modeLabel: (modes.find((m) => m.value === session.mode) || modes[3]).label,
  };
}
// Same state words as the Web projection: a finished application says why it ended.
function terminalStatus(app) {
  if (app.archived_at) return { label: "已归档", tone: "neutral", icon: "cancel" };
  if (app.lifecycle_status === "terminated") {
    if (app.termination_reason === "company_rejected")
      return { label: "未通过", tone: "danger", icon: "cancel" };
    if (
      app.termination_reason === "user_withdrew" ||
      app.termination_reason === "offer_declined"
    )
      return { label: "已主动结束", tone: "neutral", icon: "cancel" };
    return { label: "已终止", tone: "neutral", icon: "cancel" };
  }
  if (app.status === "rejected")
    return { label: "未通过", tone: "danger", icon: "cancel" };
  if (app.status === "withdrawn")
    return { label: "已主动结束", tone: "neutral", icon: "cancel" };
  if (app.status === "closed")
    return app.offer_status === "declined"
      ? { label: "已主动结束", tone: "neutral", icon: "cancel" }
      : { label: "已结束", tone: "neutral", icon: "cancel" };
  return null;
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
  const accepted =
    !app.archived_at &&
    app.status === "closed" &&
    app.offer_status === "accepted";
  const terminal = terminalStatus(app);
  let status = { label: "待投递", tone: "neutral", icon: "file" };
  if (accepted || terminal) {
    status = accepted
      ? { label: "已收到 Offer", tone: "offer", icon: "offer" }
      : terminal;
  } else if (offer)
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
                ? {
                    label:
                      kind === "assessment"
                        ? "待测评"
                        : kind === "written_test"
                          ? "待笔试"
                          : "待面试",
                    tone: "accent",
                    icon: "clock",
                  }
                : { label: "等待安排", tone: "accent", icon: "clock" };
  }
  return {
    ...app,
    companyLogo: logoSource(app.company_logo_url),
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
      "companyLogo",
      "calendar_color",
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
      "companyLogo",
      "calendar_color",
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
// 轴只铺开当天真正有安排的那一段，前后各留 1 小时。原先固定从 08:00 起、到最后一个场次
// 结束为止：一场 20:00 的面试会把轴拖到 13 小时，每小时只剩 36.8px，而块内两行文字本身
// 要 41.4px，文字被压扁。跨度不足时向两侧补到最小跨度，否则单独一场面试会把块撑满整板。
// 每小时保底 56px（112rpx），轴因此跟着当天真实跨度变长：短于可视高度时仍填满看板，
// 长于可视高度时随页面滚动，块不会再被压到文字以下。
const TIMELINE_DEFAULT_FIRST_HOUR = 8;
const TIMELINE_DEFAULT_LAST_HOUR = 18;
const TIMELINE_PAD_HOURS = 1;
const TIMELINE_MIN_SPAN_HOURS = 5;
const TIMELINE_HOUR_RPX = 112;
// 块内两行要 51.4px：上下内边距 4px + 标题行 24px（24px 公司标识比 13px 文字高，撑起标题行）
// + 行距 2px + 时间行 17.4px。按每小时 56px 的底数折算，51.4px 对应 55 分钟；更短的场次放不下
// 时间行，只留公司·阶段，避免两行一起被压扁。改块内标识尺寸、字号或内边距时这个数要跟着重算。
const TIMELINE_TWO_LINE_MINUTES = 55;
// 超过两小时的块（测评这类占一整天的居多）改顶对齐：居中会把标题推到看板中段，
// 滚动条还在顶部时看不到字，整块看起来就是一根没有内容的色带。
const TIMELINE_CENTER_MAX_MINUTES = 120;
// 24px 的公司标识要 30 分钟（28px 块高）才放得下——居中会把 4px 内边距压成 2px，
// 再短的块就会把标识上下切掉，那种情况下只留公司·阶段。
const TIMELINE_LOGO_MIN_MINUTES = 30;
function timelineSpan(items) {
  if (!items.length)
    return {
      first: TIMELINE_DEFAULT_FIRST_HOUR,
      last: TIMELINE_DEFAULT_LAST_HOUR,
    };
  // 跨天的场次在当天这一侧已经裁到 0 / 1440 分钟，所以 from、to 始终落在当天内。
  let first = Math.max(
    0,
    Math.floor(Math.min(...items.map((s) => s.from)) / 60) - TIMELINE_PAD_HOURS,
  );
  // 轴底边最远到 24:00：跨天的测评在当天是一整块，轴只到 23:00 会让它溢出看板。
  // 只有场次真的排进 23 点这一小时（或铺满全天）时才会出现 24:00 刻度。
  let last = Math.min(
    24,
    Math.ceil(Math.max(...items.map((s) => s.to)) / 60) + TIMELINE_PAD_HOURS,
  );
  const grow = TIMELINE_MIN_SPAN_HOURS - (last - first);
  if (grow > 0) {
    first -= Math.ceil(grow / 2);
    last += Math.floor(grow / 2);
    // 顶到 0 点或 24 点就补不动了，把余量挪到另一侧。
    if (first < 0) {
      last = Math.min(24, last - first);
      first = 0;
    }
    if (last > 24) {
      first = Math.max(0, first - (last - 24));
      last = 24;
    }
  }
  return { first, last };
}
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
  const { first, last } = timelineSpan(items);
  let cluster = [],
    ends = [],
    clusterEnd = -1;
  const conflicts = [];
  const finish = () => {
    if (!cluster.length) return;
    for (const item of cluster) item.columns = ends.length;
    if (ends.length > 1)
      conflicts.push({
        count: cluster.length,
        end: Math.max(...cluster.map((item) => item.to)),
      });
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
    minimumHeight: (last - first) * TIMELINE_HOUR_RPX,
    items: items.map((s) => ({
      ...s,
      fluidStyle: `top:${((s.from - first * 60) / ((last - first) * 60)) * 100}%;height:${((s.to - s.from) / ((last - first) * 60)) * 100}%;left:${(s.column / s.columns) * 100}%;width:${100 / s.columns}%;`,
      compactTime: `${dateParts(s.start_at).time}–${dateParts(s.end_at).time}`,
      // 放不下两行就只留标题行，宁可少一行也不要把两行一起压扁。
      showTime: s.to - s.from >= TIMELINE_TWO_LINE_MINUTES,
      // 窄块优先让宽度给公司名和阶段，太短的块放不下标识。
      showLogo: s.columns === 1 && s.to - s.from >= TIMELINE_LOGO_MIN_MINUTES,
      // 常规时长的块内容居中；超过两小时改顶对齐。
      centerContent: s.to - s.from <= TIMELINE_CENTER_MAX_MINUTES,
      // Narrow columns drop the mode so the stage label survives truncation.
      compactStage:
        s.columns > 1
          ? s.stage_label
          : `${s.stage_label} · ${s.shortModeLabel}`,
    })),
    conflicts: conflicts.map((c) => ({
      key: String(c.end),
      label: `${chineseCount[c.count] || c.count}项安排时间重叠，请核对`,
      // Anchored to the cluster's bottom edge; clamped so the hint stays on the board.
      top: Math.min(
        96,
        ((c.end - first * 60) / ((last - first) * 60)) * 100,
      ),
    })),
    hasConflict: conflicts.length > 0,
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
// Keep the overlay mounted until the downward exit animation finishes.
function reset(component) {
  clearTimeout(component._closeTimer);
  component._closeTimer = null;
  component._closing = false;
  component._disposed = false;
  component.setData({ closing: false, sheetExitStyle: "", maskExitStyle: "" });
}

function dismiss(component, detail) {
  if (component._closing || component._disposed) return;
  component._closing = true;
  component.setData({
    closing: true,
    sheetExitStyle: "transform:translateY(100%);transition:transform 240ms ease-in;pointer-events:none;",
    maskExitStyle: "opacity:0;transition:opacity 240ms ease-in;",
  });
  component._closeTimer = setTimeout(() => {
    component._closeTimer = null;
    if (!component._disposed) component.triggerEvent("close", detail);
  }, 240);
}

function dispose(component) {
  component._disposed = true;
  clearTimeout(component._closeTimer);
}


module.exports = {
  sheetMotion: { reset, dismiss, dispose },
  TZ,
  stageNames,
  modes,
  logoBackground,
  logoSource,
  logoInitial,
  dateParts,
  shortDate,
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
