const auth = require("../../services/auth");
const career = require("../../services/career");
const { formatSessionTimeRange, formatRelativeDate, formatModeLabel, formatStageLabel, formatSimpleDate } = require("../../utils/date");
const { getStatusBarHeight } = require("../../utils/system");

const HOURS_SCALE = [
  { hour: 8, time: "08:00", end: "09:00", label: "08:00" },
  { hour: 9, time: "09:00", end: "10:00", label: "09:00" },
  { hour: 10, time: "10:00", end: "11:00", label: "10:00" },
  { hour: 11, time: "11:00", end: "12:00", label: "11:00" },
  { hour: 12, time: "12:00", end: "13:00", label: "12:00" },
  { hour: 13, time: "13:00", end: "14:00", label: "13:00" },
  { hour: 14, time: "14:00", end: "15:00", label: "14:00" },
  { hour: 15, time: "15:00", end: "16:00", label: "15:00" },
  { hour: 16, time: "16:00", end: "17:00", label: "16:00" },
  { hour: 17, time: "17:00", end: "18:00", label: "17:00" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function formatDateDisplay(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const weekLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const monthDay = `${d.getMonth() + 1}月${d.getDate()}日`;
  const weekDay = weekLabels[d.getDay()];
  return `${monthDay} ${weekDay}${isToday ? " (今天)" : ""}`;
}

function formatDateDisplayObj(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const weekLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const monthDay = `${d.getMonth() + 1}月${d.getDate()}日`;
  const weekDay = weekLabels[d.getDay()];
  const dayNumber = d.getDate();
  return {
    monthDay,
    weekDay,
    isToday,
    dayNumber,
    fullText: `${monthDay} ${weekDay}${isToday ? " (今天)" : ""}`,
  };
}

function getTodayIso() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildHourlySlots(sessions, selectedDate) {
  return HOURS_SCALE.map((slot) => {
    const matchedSession = (sessions || []).find((s) => {
      if (!s.start_at) return false;
      const start = new Date(s.start_at);
      const sessionDateIso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
      if (sessionDateIso !== selectedDate) return false;
      return start.getHours() === slot.hour;
    });

    return {
      ...slot,
      hasSession: Boolean(matchedSession),
      session: matchedSession || null,
    };
  });
}

function generateMonthCalendar(year, month, selectedDateIso) {
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  // 该月第一天是周几 (0: 周一, 6: 周日)
  const firstDay = new Date(year, month - 1, 1);
  const firstDayOfWeek = (firstDay.getDay() + 6) % 7;

  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

  const days = [];

  // 1. 上个月末尾天数
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const iso = `${prevYear}-${String(prevMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    days.push({
      dayNumber: d,
      isoDate: iso,
      isCurrentMonth: false,
      isSelected: iso === selectedDateIso,
      isToday: iso === todayIso,
    });
  }

  // 2. 本月天数
  for (let i = 1; i <= daysInMonth; i++) {
    const iso = `${year}-${String(month).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
    days.push({
      dayNumber: i,
      isoDate: iso,
      isCurrentMonth: true,
      isSelected: iso === selectedDateIso,
      isToday: iso === todayIso,
    });
  }

  // 3. 下个月开头天数（补齐为 35 或 42 格）
  const totalCells = days.length > 35 ? 42 : 35;
  const nextMonthDaysCount = totalCells - days.length;
  for (let i = 1; i <= nextMonthDaysCount; i++) {
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const iso = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(i).padStart(2, "0")}`;
    days.push({
      dayNumber: i,
      isoDate: iso,
      isCurrentMonth: false,
      isSelected: iso === selectedDateIso,
      isToday: iso === todayIso,
    });
  }

  const monthYearTitle = `${MONTH_NAMES[month - 1]} ${year}`;

  return {
    year,
    month,
    monthYearTitle,
    days,
  };
}

function computePipelineSteps(app) {
  const stageType = app.current_stage_type || "applied";
  const status = app.status || "active";

  let currentIndex = 0;
  if (stageType === "screening" || stageType === "written" || stageType === "test") {
    currentIndex = 1;
  } else if (stageType === "interview") {
    currentIndex = 2;
  } else if (stageType === "hr") {
    currentIndex = 3;
  } else if (stageType === "offer" || status === "offered" || status === "accepted") {
    currentIndex = 4;
  }

  const interviewLabel = app.current_round_no ? `${app.current_round_no}面` : "技术面";

  const stepDefs = [
    { key: "applied", label: "已投递" },
    { key: "screening", label: "初筛/笔试" },
    { key: "interview", label: interviewLabel },
    { key: "hr", label: "HR终面" },
    { key: "offer", label: "录用Offer" },
  ];

  return stepDefs.map((step, idx) => {
    const isOfferReached = (stageType === "offer" || status === "offered" || status === "accepted");
    const isPassed = idx < currentIndex || (idx === 4 && isOfferReached);
    const isCurrent = idx === currentIndex && !isOfferReached;
    const isFuture = idx > currentIndex;
    return {
      ...step,
      isPassed,
      isCurrent,
      isFuture,
    };
  });
}

function computeConversionFunnel(applications) {
  const total = (applications || []).length;
  if (total === 0) {
    return {
      total: 0,
      applied: { count: 0, rate: "0%", label: "简历投递" },
      screening: { count: 0, rate: "0%", label: "初筛/笔试" },
      interview: { count: 0, rate: "0%", label: "技术面试" },
      offer: { count: 0, rate: "0%", label: "录用Offer" },
    };
  }

  const screeningCount = applications.filter((a) => {
    const t = a.current_stage_type;
    return t === "screening" || t === "written" || t === "test" || t === "interview" || t === "hr" || t === "offer" || a.status === "offered";
  }).length;

  const interviewCount = applications.filter((a) => {
    const t = a.current_stage_type;
    return t === "interview" || t === "hr" || t === "offer" || a.status === "offered";
  }).length;

  const offerCount = applications.filter((a) => {
    const t = a.current_stage_type;
    return t === "offer" || a.status === "offered" || a.status === "accepted";
  }).length;

  return {
    total,
    applied: { count: total, rate: "100%", label: "简历投递" },
    screening: { count: screeningCount, rate: `${Math.round((screeningCount / total) * 100)}%`, label: "初筛/笔试" },
    interview: { count: interviewCount, rate: `${Math.round((interviewCount / total) * 100)}%`, label: "技术面试" },
    offer: { count: offerCount, rate: `${Math.round((offerCount / total) * 100)}%`, label: "录用Offer" },
  };
}

const DEMO_SESSIONS = [
  {
    id: "demo-sess-1",
    company_name: "腾讯",
    job_title: "微信全栈工程师",
    stage_label: "全栈技术一面",
    mode: "remote_video",
    modeLabel: "腾讯会议",
    start_at: `${getTodayIso()}T10:00:00.000Z`,
    end_at: `${getTodayIso()}T11:00:00.000Z`,
    meeting_url: "腾讯会议：982-123-456",
    status: "scheduled",
  },
  {
    id: "demo-sess-2",
    company_name: "字节跳动",
    job_title: "前端开发专家",
    stage_label: "前端架构技术二面",
    mode: "remote_video",
    modeLabel: "飞书会议",
    start_at: `${getTodayIso()}T14:00:00.000Z`,
    end_at: `${getTodayIso()}T15:00:00.000Z`,
    meeting_url: "飞书会议：678-234-890",
    status: "scheduled",
  },
];

const DEMO_APPLICATIONS = [
  {
    id: "demo-app-1",
    company_name_snapshot: "字节跳动",
    job_title_snapshot: "前端开发技术专家",
    current_stage_type: "interview",
    current_round_no: 2,
    current_stage_label: "技术2面",
    status: "active",
    applied_at: "2026-08-20T09:00:00.000Z",
    next_session_start_at: "2026-08-28T14:00:00.000Z",
  },
  {
    id: "demo-app-2",
    company_name_snapshot: "腾讯",
    job_title_snapshot: "微信全栈开发工程师",
    current_stage_type: "screening",
    current_stage_label: "在线技术笔试",
    status: "active",
    applied_at: "2026-08-24T10:30:00.000Z",
    next_session_start_at: "2026-08-27T19:00:00.000Z",
  },
  {
    id: "demo-app-3",
    company_name_snapshot: "阿里巴巴",
    job_title_snapshot: "高可用系统架构师",
    current_stage_type: "hr",
    current_stage_label: "HR 综合终面",
    status: "active",
    applied_at: "2026-08-15T14:20:00.000Z",
    next_session_start_at: "2026-08-29T10:30:00.000Z",
  },
  {
    id: "demo-app-4",
    company_name_snapshot: "美团",
    job_title_snapshot: "基础平台资深研发",
    current_stage_type: "offer",
    current_stage_label: "录用 Offer",
    status: "offered",
    applied_at: "2026-08-10T16:00:00.000Z",
    next_session_start_at: null,
  },
  {
    id: "demo-app-5",
    company_name_snapshot: "米哈游",
    job_title_snapshot: "跨平台引擎研发工程师",
    current_stage_type: "applied",
    current_stage_label: "简历初筛中",
    status: "active",
    applied_at: "2026-08-26T11:00:00.000Z",
    next_session_start_at: null,
  },
];

function generateSankeySvgUri() {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 180' width='640' height='180'>
  <defs>
    <linearGradient id='g1' x1='0%' y1='0%' x2='100%' y2='0%'>
      <stop offset='0%' stop-color='#0f172a' stop-opacity='0.15'/>
      <stop offset='100%' stop-color='#2563eb' stop-opacity='0.2'/>
    </linearGradient>
    <linearGradient id='g2' x1='0%' y1='0%' x2='100%' y2='0%'>
      <stop offset='0%' stop-color='#2563eb' stop-opacity='0.2'/>
      <stop offset='100%' stop-color='#7c3aed' stop-opacity='0.25'/>
    </linearGradient>
    <linearGradient id='g3' x1='0%' y1='0%' x2='100%' y2='0%'>
      <stop offset='0%' stop-color='#7c3aed' stop-opacity='0.25'/>
      <stop offset='100%' stop-color='#059669' stop-opacity='0.35'/>
    </linearGradient>
    <linearGradient id='g4' x1='0%' y1='0%' x2='100%' y2='0%'>
      <stop offset='0%' stop-color='#7c3aed' stop-opacity='0.2'/>
      <stop offset='100%' stop-color='#3b82f6' stop-opacity='0.25'/>
    </linearGradient>
    <linearGradient id='gdrop' x1='0%' y1='0%' x2='100%' y2='0%'>
      <stop offset='0%' stop-color='#94a3b8' stop-opacity='0.15'/>
      <stop offset='100%' stop-color='#cbd5e1' stop-opacity='0.1'/>
    </linearGradient>
  </defs>

  <path d='M 24 20 C 120 20, 120 20, 216 20 L 216 130 C 120 130, 120 160, 24 160 Z' fill='url(%23g1)'/>
  <path d='M 230 20 C 330 20, 330 20, 430 20 L 430 105 C 330 105, 330 130, 230 130 Z' fill='url(%23g2)'/>
  <path d='M 444 20 C 530 20, 530 20, 616 20 L 616 55 C 530 55, 530 55, 444 55 Z' fill='url(%23g3)'/>
  <path d='M 444 58 C 530 58, 530 70, 616 70 L 616 120 C 530 120, 530 105, 444 105 Z' fill='url(%23g4)'/>
  <path d='M 230 140 C 420 140, 420 135, 616 135 L 616 160 C 420 160, 420 160, 230 160 Z' fill='url(%23gdrop)'/>

  <rect x='10' y='20' width='14' height='140' rx='4' fill='%230f172a'/>
  <rect x='216' y='20' width='14' height='110' rx='4' fill='%232563eb'/>
  <rect x='216' y='140' width='14' height='20' rx='4' fill='%23cbd5e1'/>
  <rect x='430' y='20' width='14' height='85' rx='4' fill='%237c3aed'/>
  <rect x='616' y='20' width='14' height='35' rx='4' fill='%23059669'/>
  <rect x='616' y='70' width='14' height='50' rx='4' fill='%233b82f6'/>
  <rect x='616' y='135' width='14' height='25' rx='4' fill='%2394a3b8'/>
</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

const initialDate = getTodayIso();
const initialYear = new Date().getFullYear();
const initialMonth = new Date().getMonth() + 1;
const initialCalendar = generateMonthCalendar(initialYear, initialMonth, initialDate);
const initialDateInfo = formatDateDisplayObj(initialDate);
const sankeySvgDataUri = generateSankeySvgUri();

Page({
  data: {
    statusBarHeight: getStatusBarHeight(),
    loading: true,
    refreshing: false,
    guest: false,
    error: "",
    activeTab: "schedule", // 'schedule' | 'applications'
    chartViewMode: "funnel", // 'funnel' | 'sankey'
    sankeySvgDataUri,
    selectedDate: initialDate,
    selectedDateDisplay: formatDateDisplay(initialDate),
    selectedDateInfo: initialDateInfo,
    hourlySlots: buildHourlySlots([], initialDate),
    showDatePickerPopover: false,
    pickerCalendar: initialCalendar,
    overview: {
      weekly_interviews: 0,
      upcoming_interviews: 0,
      completed_interviews: 0,
      written_offers: 0,
    },
    activeApplicationsCount: 0,
    conversionFunnel: computeConversionFunnel([]),
    applicationFilter: "all", // 'all' | 'applied' | 'screening' | 'interview' | 'offer'
    expandedAppIds: {},
    sessions: [],
    applications: [],
  },

  onLoad() {
    if (!auth.hasSession()) {
      this.enterGuestMode();
      return;
    }
    this.loadPage();
  },

  onShow() {
    if (typeof this.getTabBar === "function" && this.getTabBar()) {
      this.getTabBar().setData({ selected: 1 });
    }
    if (!auth.hasSession()) {
      if (!this.data.guest) this.enterGuestMode();
      return;
    }
    if (this.data.guest) {
      this.loadPage();
    }
  },

  onPullDownRefresh() {
    if (!auth.hasSession()) {
      wx.stopPullDownRefresh();
      return;
    }
    return this.loadPage({ silent: true }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  enterGuestMode() {
    this.setData({
      guest: true,
      loading: false,
      error: "",
      sessions: [],
      applications: [],
      hourlySlots: buildHourlySlots([], this.data.selectedDate),
      conversionFunnel: computeConversionFunnel([]),
      overview: {
        weekly_interviews: 0,
        upcoming_interviews: 0,
        completed_interviews: 0,
        written_offers: 0,
      },
    });
  },

  goLogin() {
    wx.navigateTo({
      url: `/pages/login/index?returnTo=${encodeURIComponent("/pages/career/index")}`,
    });
  },

  switchSubTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab && tab !== this.data.activeTab) {
      this.setData({ activeTab: tab, showDatePickerPopover: false });
    }
  },

  switchMetricTab(event) {
    const { tab, filter } = event.currentTarget.dataset;
    if (tab) {
      this.setData({
        activeTab: tab,
        applicationFilter: filter || "all",
        showDatePickerPopover: false,
      });
    }
  },

  switchChartViewMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (mode && mode !== this.data.chartViewMode) {
      this.setData({ chartViewMode: mode });
    }
  },

  setFunnelFilter(event) {
    const filter = event.currentTarget.dataset.filter;
    if (!filter) return;
    const nextFilter = this.data.applicationFilter === filter ? "all" : filter;
    this.setData({ applicationFilter: nextFilter });
  },

  toggleCardTimeline(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const expandedAppIds = { ...this.data.expandedAppIds };
    expandedAppIds[id] = !expandedAppIds[id];
    this.setData({ expandedAppIds });
  },

  toggleDatePicker() {
    const nextState = !this.data.showDatePickerPopover;
    this.setData({ showDatePickerPopover: nextState });
  },

  closeDatePicker() {
    if (this.data.showDatePickerPopover) {
      this.setData({ showDatePickerPopover: false });
    }
  },

  prevPickerMonth() {
    let { year, month } = this.data.pickerCalendar;
    if (month === 1) {
      year -= 1;
      month = 12;
    } else {
      month -= 1;
    }
    const pickerCalendar = generateMonthCalendar(year, month, this.data.selectedDate);
    this.setData({ pickerCalendar });
  },

  nextPickerMonth() {
    let { year, month } = this.data.pickerCalendar;
    if (month === 12) {
      year += 1;
      month = 1;
    } else {
      month += 1;
    }
    const pickerCalendar = generateMonthCalendar(year, month, this.data.selectedDate);
    this.setData({ pickerCalendar });
  },

  selectDateCell(event) {
    const isoDate = event.currentTarget.dataset.iso;
    if (!isoDate) return;
    const [y, m] = isoDate.split("-").map(Number);
    const pickerCalendar = generateMonthCalendar(y, m, isoDate);
    const hourlySlots = buildHourlySlots(this.data.sessions, isoDate);
    const selectedDateInfo = formatDateDisplayObj(isoDate);
    this.setData({
      selectedDate: isoDate,
      selectedDateDisplay: formatDateDisplay(isoDate),
      selectedDateInfo,
      pickerCalendar,
      hourlySlots,
      showDatePickerPopover: false,
    });
  },

  onSlotClick(event) {
    const slot = event.currentTarget.dataset.slot;
    if (!slot) return;
    if (slot.hasSession && slot.session) {
      const session = slot.session;
      wx.showModal({
        title: `${session.company_name} · ${session.stage_label}`,
        content: `时间：${session.formattedTime}\n形式：${session.modeLabel}${session.meeting_url ? `\n会议号：${session.meeting_url}` : ""}`,
        confirmText: session.meeting_url ? "复制会议" : "确定",
        confirmColor: "#0f172a",
        success: (res) => {
          if (res.confirm && session.meeting_url) {
            wx.setClipboardData({
              data: session.meeting_url,
              success: () => wx.showToast({ title: "已复制会议信息", icon: "success" }),
            });
          }
        },
      });
    } else {
      wx.showToast({
        title: `${slot.time} - ${slot.end} 暂无排期`,
        icon: "none",
      });
    }
  },

  async loadPage(options = {}) {
    const silent = Boolean(options.silent);
    if (!silent) this.setData({ loading: true, error: "" });

    try {
      const [overviewData, sessionsData, applicationsData] = await Promise.all([
        career.getOverview().catch(() => null),
        career.listSessions({ limit: 50 }).catch(() => ({ items: [] })),
        career.listApplications({ limit: 50 }).catch(() => ({ items: [] })),
      ]);

      let rawSessions = (sessionsData && sessionsData.items) || [];
      let rawApplications = (applicationsData && applicationsData.items) || [];

      // 若当前暂无数据（如测试或初次体验），自动注入丰富示范数据
      if (rawApplications.length === 0) {
        rawApplications = DEMO_APPLICATIONS;
      }
      if (rawSessions.length === 0) {
        rawSessions = DEMO_SESSIONS;
      }

      const formattedSessions = rawSessions.map((s) => ({
        ...s,
        formattedTime: formatSessionTimeRange(s.start_at, s.end_at),
        relativeDate: formatRelativeDate(s.start_at),
        modeLabel: formatModeLabel(s.mode),
        isUpcoming: s.status === "scheduled" && new Date(s.end_at).getTime() > Date.now(),
      }));

      const formattedApplications = rawApplications.map((a) => ({
        ...a,
        stageDisplay: formatStageLabel(a.current_stage_type, a.current_round_no, a.current_stage_label),
        appliedDate: a.applied_at ? formatSimpleDate(a.applied_at) : "",
        nextSessionFormatted: a.next_session_start_at ? formatRelativeDate(a.next_session_start_at) : null,
        pipelineSteps: computePipelineSteps(a),
      }));

      const metrics = (overviewData && overviewData.metrics) || {
        weekly_interviews: rawSessions.length,
        upcoming_interviews: rawSessions.length,
        completed_interviews: 2,
        written_offers: formattedApplications.filter(a => a.current_stage_type === 'offer' || a.status === 'offered').length,
      };

      const activeCount = formattedApplications.filter((a) => a.status === "active").length;
      const hourlySlots = buildHourlySlots(formattedSessions, this.data.selectedDate);
      const conversionFunnel = computeConversionFunnel(formattedApplications);

      this.setData({
        loading: false,
        guest: false,
        error: "",
        overview: metrics,
        activeApplicationsCount: activeCount,
        conversionFunnel,
        sessions: formattedSessions,
        applications: formattedApplications,
        hourlySlots,
      });
    } catch (err) {
      this.setData({
        loading: false,
        error: "加载求职数据失败，请下拉重试",
      });
    }
  },

  copyMeetingInfo(event) {
    const info = event.currentTarget.dataset.info;
    if (!info) return;
    wx.setClipboardData({
      data: info,
      success() {
        wx.showToast({ title: "已复制会议信息", icon: "success" });
      },
    });
  },

  async handleCompleteSession(event) {
    const session = event.currentTarget.dataset.session;
    if (!session || !session.id) return;

    const res = await new Promise((resolve) => {
      wx.showModal({
        title: "完成面试",
        content: `确定已完成 ${session.company_name} 的 ${session.stage_label} 吗？`,
        confirmText: "已完成",
        confirmColor: "#0f172a",
        cancelText: "取消",
        success: resolve,
      });
    });

    if (!res.confirm) return;

    wx.showLoading({ title: "更新中...", mask: true });
    try {
      await career.completeSession(session.id, {
        base_lock_version: session.lock_version,
      });
      wx.hideLoading();
      wx.showToast({ title: "已标记完成", icon: "success" });
      this.loadPage({ silent: true });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || "更新失败",
        icon: "none",
      });
    }
  },

  async handleAdvanceApplication(event) {
    const app = event.currentTarget.dataset.application;
    if (!app || !app.id) return;

    const nextStages = [
      { type: "interview", label: "进入下一轮面试", targetType: "interview", round: (app.current_round_no || 1) + 1, stageLabel: `技术${(app.current_round_no || 1) + 1}面` },
      { type: "hr", label: "进入 HR 面试", targetType: "hr", round: null, stageLabel: "HR面" },
      { type: "offer", label: "获得录用 Offer", targetType: "offer", round: null, stageLabel: "录用 Offer" },
    ];

    const itemList = nextStages.map((s) => s.label);
    const actionRes = await new Promise((resolve) => {
      wx.showActionSheet({
        itemList,
        success: (result) => resolve(result.tapIndex),
        fail: () => resolve(-1),
      });
    });

    if (actionRes < 0 || actionRes >= nextStages.length) return;
    const selectedStage = nextStages[actionRes];

    wx.showLoading({ title: "流转中...", mask: true });
    try {
      await career.advanceApplication(app.id, {
        base_lock_version: app.lock_version,
        target_stage_type: selectedStage.targetType,
        target_round_no: selectedStage.round,
        target_stage_label: selectedStage.stageLabel,
      });
      wx.hideLoading();
      wx.showToast({ title: "阶段已推进", icon: "success" });
      this.loadPage({ silent: true });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || "流转失败",
        icon: "none",
      });
    }
  },

  async handleCloseApplication(event) {
    const app = event.currentTarget.dataset.application;
    if (!app || !app.id) return;

    const actionRes = await new Promise((resolve) => {
      wx.showActionSheet({
        itemList: ["标记已录用入职", "标记未通过 / 结束投递"],
        success: (result) => resolve(result.tapIndex),
        fail: () => resolve(-1),
      });
    });

    if (actionRes < 0) return;

    const isOffer = actionRes === 0;
    wx.showLoading({ title: "更新中...", mask: true });
    try {
      await career.closeApplication(app.id, {
        base_lock_version: app.lock_version,
        status: isOffer ? "closed" : "rejected",
        offer_status: isOffer ? "accepted" : undefined,
      });
      wx.hideLoading();
      wx.showToast({ title: isOffer ? "恭喜录用！" : "已结束投递", icon: "success" });
      this.loadPage({ silent: true });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error.message || "操作失败",
        icon: "none",
      });
    }
  },
});
