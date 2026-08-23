import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock3,
  ExternalLink,
  FileText,
  FolderOpen,
  Import,
  Link2,
  ListChecks,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trophy,
  UserRound,
  Video,
} from "lucide-react";
import { Button, ExpandableSearch } from "@/components/ui";
import { navigateTo, type InterviewView } from "../../routing";
import "./interviews.css";

type InterviewStatus = "upcoming" | "active" | "completed" | "cancelled";
type CalendarColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";
type Interview = {
  id: string;
  company: string;
  logo: string;
  role: string;
  stage: string;
  date: string;
  weekday: string;
  time: string;
  endTime: string;
  status: InterviewStatus;
  mode: string;
  interviewer: string;
  note: string;
  calendarDay: number;
  calendarStart: number;
  calendarSpan: number;
  tone: string;
};

const CALENDAR_COLORS: Array<{ id: CalendarColor; label: string }> = [
  { id: "red", label: "红色" },
  { id: "orange", label: "橙色" },
  { id: "yellow", label: "黄色" },
  { id: "green", label: "绿色" },
  { id: "blue", label: "蓝色" },
  { id: "purple", label: "紫色" },
  { id: "gray", label: "灰色" },
];
const CALENDAR_COLOR_STORAGE_KEY = "linkcv.interview-calendar-colors.v1";

const INTERVIEWS: Interview[] = [
  { id: "bytedance", company: "字节跳动", logo: "▥", role: "后端开发工程师", stage: "一面", date: "8月18日", weekday: "周二", time: "10:00", endTime: "11:00", status: "completed", mode: "线上面试（飞书会议）", interviewer: "张同学（后端开发工程师）", note: "重点准备高并发系统设计、分布式事务、消息队列，以及过往项目中的性能优化案例。", calendarDay: 1, calendarStart: 2, calendarSpan: 2, tone: "blue" },
  { id: "aliyun", company: "阿里云", logo: "云", role: "后端开发工程师", stage: "二面", date: "8月20日", weekday: "周四", time: "10:00", endTime: "11:30", status: "upcoming", mode: "线上面试（Video）", interviewer: "张益铭（后端技术专家）", note: "重点准备：高并发系统设计、分布式事务、消息队列，以及过往项目中的性能优化案例。", calendarDay: 3, calendarStart: 2, calendarSpan: 3, tone: "blue" },
  { id: "xiaohongshu", company: "小红书", logo: "小", role: "后端开发工程师", stage: "HR 面", date: "8月19日", weekday: "周三", time: "14:00", endTime: "15:00", status: "upcoming", mode: "线上面试", interviewer: "李同学", note: "准备职业规划、团队协作案例和期望薪资。", calendarDay: 2, calendarStart: 10, calendarSpan: 2, tone: "blue" },
  { id: "tencent", company: "腾讯", logo: "T", role: "后端开发工程师", stage: "视频面试", date: "8月20日", weekday: "周四", time: "19:00", endTime: "20:30", status: "upcoming", mode: "线上面试（腾讯会议）", interviewer: "王同学", note: "重点复习算法、缓存一致性与 Redis。", calendarDay: 3, calendarStart: 20, calendarSpan: 3, tone: "blue" },
  { id: "meituan", company: "美团", logo: "美", role: "后端开发工程师", stage: "一面", date: "8月17日", weekday: "周一", time: "15:00", endTime: "16:00", status: "completed", mode: "线上面试", interviewer: "陈同学", note: "已完成。", calendarDay: 0, calendarStart: 12, calendarSpan: 2, tone: "green" },
  { id: "didi", company: "滴滴出行", logo: "D", role: "后端开发工程师", stage: "二面", date: "8月21日", weekday: "周五", time: "10:00", endTime: "11:00", status: "completed", mode: "现场面试", interviewer: "刘同学", note: "已完成。", calendarDay: 4, calendarStart: 2, calendarSpan: 2, tone: "orange" },
  { id: "baidu", company: "百度", logo: "百", role: "后端开发工程师", stage: "HR 面", date: "8月22日", weekday: "周六", time: "11:30", endTime: "12:30", status: "completed", mode: "视频面试", interviewer: "赵同学", note: "已完成。", calendarDay: 5, calendarStart: 5, calendarSpan: 2, tone: "amber" },
  { id: "jd", company: "京东", logo: "JD", role: "后端开发工程师", stage: "HR 面", date: "8月23日", weekday: "周日", time: "15:30", endTime: "16:30", status: "completed", mode: "线上面试", interviewer: "周同学", note: "已完成。", calendarDay: 6, calendarStart: 13, calendarSpan: 2, tone: "red" },
];

function isCalendarColor(value: unknown): value is CalendarColor {
  return CALENDAR_COLORS.some((color) => color.id === value);
}

function loadCompanyCalendarColors(): Record<string, CalendarColor> {
  let stored: Record<string, CalendarColor> = {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CALENDAR_COLOR_STORAGE_KEY) ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      stored = Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, CalendarColor] => isCalendarColor(entry[1])));
    }
  } catch {
    stored = {};
  }

  const next = { ...stored };
  for (const company of new Set(INTERVIEWS.map((interview) => interview.company))) {
    if (!next[company]) {
      next[company] = CALENDAR_COLORS[Math.floor(Math.random() * CALENDAR_COLORS.length)].id;
    }
  }
  try {
    window.localStorage.setItem(CALENDAR_COLOR_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The mock remains usable when browser storage is unavailable.
  }
  return next;
}

const PIPELINE = [
  { label: "筛选中", ids: ["xiaomi", "bytedance", "jd"] },
  { label: "一面", ids: ["meituan", "kuaishou"] },
  { label: "二面", ids: ["tencent", "aliyun", "didi"] },
  { label: "HR 面", ids: ["baidu"] },
  { label: "Offer", ids: ["netease"] },
];

const PIPELINE_CARDS: Record<string, { company: string; logo: string; role: string; metaLeft: string; metaRight: string; tone: string }> = {
  xiaomi: { company: "小米科技", logo: "mi", role: "产品经理", metaLeft: "简历筛选", metaRight: "等待反馈", tone: "orange" },
  bytedance: { company: "字节跳动", logo: "▥", role: "数据产品经理", metaLeft: "简历筛选", metaRight: "等待反馈", tone: "blue" },
  jd: { company: "京东零售", logo: "JD", role: "产品经理", metaLeft: "简历筛选", metaRight: "等待反馈", tone: "red" },
  tencent: { company: "腾讯", logo: "T", role: "产品经理", metaLeft: "待安排", metaRight: "暂未排期", tone: "blue" },
  meituan: { company: "美团", logo: "美", role: "产品经理", metaLeft: "视频面试", metaRight: "08/20 14:00", tone: "amber" },
  kuaishou: { company: "快手", logo: "快", role: "产品经理", metaLeft: "现场面试", metaRight: "08/21 11:00", tone: "orange" },
  aliyun: { company: "阿里巴巴", logo: "云", role: "高级产品经理", metaLeft: "视频面试", metaRight: "08/21 15:00", tone: "orange" },
  didi: { company: "滴滴出行", logo: "D", role: "产品经理", metaLeft: "视频面试", metaRight: "08/22 10:00", tone: "orange" },
  baidu: { company: "百度", logo: "百", role: "产品经理", metaLeft: "视频面试", metaRight: "08/23 16:30", tone: "blue" },
  netease: { company: "网易", logo: "易", role: "产品经理", metaLeft: "Offer", metaRight: "待沟通", tone: "red" },
};

const WEEK_DAYS = ["8/17 周一", "8/18 周二", "8/19 周三", "8/20 周四", "8/21 周五", "8/22 周六", "8/23 周日"];
const HOURS = Array.from({ length: 13 }, (_, index) => `${String(index + 9).padStart(2, "0")}:00`);
const OVERVIEW_HOURS = Array.from({ length: 22 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
const OVERVIEW_HOUR_HEIGHT = 40;
const OVERVIEW_DEFAULT_START_HOUR = 9;
const SCHEDULE_START_HOUR = 9;
const SCHEDULE_SLOT_COUNT = 26;
const SCHEDULE_DATES = ["8月17日", "8月18日", "8月19日", "8月20日", "8月21日", "8月22日", "8月23日"];
const SCHEDULE_WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const MONTH_DAYS = [27, 28, 29, 30, 31, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 1, 2, 3, 4, 5, 6];

export function InterviewCenterPage({ view }: { view: InterviewView }) {
  const [interviews, setInterviews] = useState(INTERVIEWS);
  const [query, setQuery] = useState("");
  const [selectedScheduleId, setSelectedScheduleId] = useState("aliyun");
  const [selectedRecordId, setSelectedRecordId] = useState("bytedance");
  const [scheduleFilter, setScheduleFilter] = useState<"all" | "upcoming" | "completed">("all");
  const [notice, setNotice] = useState<string | null>(null);
  const [companyCalendarColors, setCompanyCalendarColors] = useState(loadCompanyCalendarColors);

  const updateCompanyCalendarColor = (company: string, color: CalendarColor) => {
    setCompanyCalendarColors((current) => {
      const next = { ...current, [company]: color };
      try {
        window.localStorage.setItem(CALENDAR_COLOR_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Keep the current session interactive when browser storage is unavailable.
      }
      return next;
    });
  };

  const visibleInterviews = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return interviews.filter((item) => {
      const matchesQuery = !normalized || `${item.company}${item.role}${item.stage}`.toLowerCase().includes(normalized);
      const matchesStatus = scheduleFilter === "all" || (scheduleFilter === "upcoming" ? item.status === "upcoming" : item.status === "completed");
      return matchesQuery && matchesStatus;
    });
  }, [interviews, query, scheduleFilter]);

  const selectedSchedule = interviews.find((item) => item.id === selectedScheduleId) ?? interviews[1];
  const selectedRecord = interviews.find((item) => item.id === selectedRecordId) ?? interviews[0];
  const moveInterview = (id: string, calendarDay: number, calendarStart: number) => {
    setInterviews((current) => current.map((item) => item.id === id ? {
      ...item,
      calendarDay,
      calendarStart,
      date: SCHEDULE_DATES[calendarDay],
      weekday: SCHEDULE_WEEKDAYS[calendarDay],
      time: formatScheduleTime(calendarStart),
      endTime: formatScheduleTime(calendarStart + item.calendarSpan),
    } : item));
    setSelectedScheduleId(id);
  };

  return (
    <main className="dashboard-content interview-center-content">
      <header className="interview-module-header" aria-labelledby="interview-center-title">
        <div className="interview-module-summary">
          <span className="interview-module-mark" aria-hidden="true"><BriefcaseBusiness /></span>
          <div className="interview-module-copy">
            <h1 id="interview-center-title">面试中心</h1>
            <p>{view === "records" ? "记录每一次面试，复盘每一个细节，持续提升，拿下 Offer。" : "统一管理你的 JD、面试排期、面试记录与复盘，让每一次准备都有迹可循。"}</p>
          </div>
          <div className="interview-module-actions">
            <ExpandableSearch label="搜索面试" name="interview-search" value={query} onValueChange={setQuery} placeholder="搜索公司、职位或阶段…" />
            <Button variant="outline" icon={<Import />} onClick={() => setNotice("素材导入将在后续素材视图中接入，本版保留入口。")}>导入面试素材</Button>
            <Button icon={<Plus />} onClick={() => setNotice("“新建面试”表单将在 CRUD 接口确认后接入，当前展示 mock 数据。")}>新建面试</Button>
          </div>
        </div>
        <InterviewTabs active={view} />
      </header>
      {notice && <div className="interview-demo-notice" role="status"><Sparkles />{notice}<button type="button" onClick={() => setNotice(null)}>知道了</button></div>}

      {view === "overview" && <OverviewView query={query} onNavigate={(nextView) => navigateTo(interviewViewPath(nextView))} />}
      {view === "schedule" && (
        <ScheduleView
          filter={scheduleFilter}
          interviews={visibleInterviews}
          selected={selectedSchedule}
          companyColors={companyCalendarColors}
          onFilter={setScheduleFilter}
          onSelect={setSelectedScheduleId}
          onMove={moveInterview}
        />
      )}
      {view === "records" && (
        <RecordsView
          interviews={visibleInterviews}
          selected={selectedRecord}
          companyColors={companyCalendarColors}
          onSelect={setSelectedRecordId}
          onColorChange={updateCompanyCalendarColor}
        />
      )}
    </main>
  );
}

function InterviewTabs({ active }: { active: InterviewView }) {
  const tabs: Array<{ id: InterviewView; label: string; icon: typeof CalendarDays }> = [
    { id: "overview", label: "总览", icon: BriefcaseBusiness },
    { id: "schedule", label: "排期", icon: CalendarDays },
    { id: "records", label: "记录复盘", icon: ListChecks },
  ];
  return (
    <div className="interview-view-tabs" role="tablist" aria-label="面试中心视图">
      {tabs.map(({ id, label, icon: Icon }) => (
        <a
          key={id}
          role="tab"
          aria-selected={id === active}
          className={id === active ? "is-active" : ""}
          href={interviewViewPath(id)}
          onClick={(event) => {
            if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            event.preventDefault();
            navigateTo(interviewViewPath(id));
          }}
        >
          <Icon />{label}
        </a>
      ))}
    </div>
  );
}

function OverviewView({ query, onNavigate }: { query: string; onNavigate: (view: InterviewView) => void }) {
  const weekTimelineRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (weekTimelineRef.current) {
      weekTimelineRef.current.scrollTop = OVERVIEW_DEFAULT_START_HOUR * OVERVIEW_HOUR_HEIGHT;
    }
  }, []);

  const metrics = [
    { label: "本周面试", value: "4", meta: "较上周 ↑ 33.3%", icon: CalendarDays, tone: "blue" },
    { label: "待面试", value: "6", meta: "未来待参加", icon: Clock3, tone: "orange" },
    { label: "已完成面试", value: "8", meta: "累计完成场次", icon: CircleCheck, tone: "green" },
    { label: "已拿 Offer", value: "1", meta: "较上周持平", icon: Trophy, tone: "amber" },
  ];
  const overviewEvents = [
    { company: "腾讯", stage: "一面", time: "10:30–11:30", day: 1, startSlot: 21, span: 2, tone: "blue" },
    { company: "阿里", stage: "一面", time: "10:30–11:30", day: 2, startSlot: 21, span: 2, tone: "red" },
    { company: "快手", stage: "一面", time: "11:00–12:00", day: 3, startSlot: 22, span: 2, tone: "green" },
    { company: "阿里巴巴", stage: "二面", time: "15:00–16:00", day: 3, startSlot: 30, span: 2, tone: "purple" },
    { company: "滴滴出行", stage: "二面", time: "10:00–11:00", day: 4, startSlot: 20, span: 2, tone: "orange" },
    { company: "百度", stage: "HR 面", time: "15:30–17:30", day: 5, startSlot: 31, span: 4, tone: "amber" },
  ];
  const searchResults = query.trim()
    ? INTERVIEWS.filter((item) => `${item.company}${item.role}${item.stage}`.toLowerCase().includes(query.trim().toLowerCase()))
    : [];
  return (
    <div className="interview-overview-layout">
      <div className="interview-overview-main">
        {query.trim() && (
          <section className="interview-surface overview-search-results" aria-live="polite">
            <SectionHeading title={`搜索结果 · ${searchResults.length}`} action="进入记录复盘" onAction={() => onNavigate("records")} />
            {searchResults.length > 0 ? (
              <div>{searchResults.map((item) => <article key={item.id}><CompanyLogo item={{ company: item.company, logo: item.logo, tone: item.tone }} /><span><strong>{item.company}</strong><small>{item.role} · {item.stage}</small></span><time>{item.date} {item.time}</time><StatusBadge status={item.status} /></article>)}</div>
            ) : <p>没有匹配的面试，试试公司、职位或面试阶段。</p>}
          </section>
        )}
        <section className="interview-metrics" aria-label="面试统计">
          {metrics.map(({ label, value, meta, icon: Icon, tone }) => (
            <article key={label} className="interview-metric-card">
              <span className={`interview-metric-icon tone-${tone}`}><Icon /></span>
              <div><p>{label}</p><strong>{value}</strong><small>{meta}</small></div>
            </article>
          ))}
        </section>
        <section className="interview-surface interview-pipeline">
          <SectionHeading title="面试流程总览" action="查看全部" onAction={() => onNavigate("records")} />
          <div className="interview-pipeline-grid">
            {PIPELINE.map((column) => (
              <div className="interview-pipeline-column" key={column.label}>
                <h3>{column.label}<span>{column.ids.length}</span></h3>
                {column.ids.map((id) => <PipelineCard key={id} item={PIPELINE_CARDS[id]} />)}
                {(column.label === "一面" || column.label === "HR 面" || column.label === "Offer") && (
                  <button type="button" className="interview-add-stage"><Plus />添加 {column.label}</button>
                )}
              </div>
            ))}
          </div>
        </section>
        <section className="interview-surface overview-week-section">
          <SectionHeading title="本周面试安排" action="查看排期" onAction={() => onNavigate("schedule")} />
          <div className="overview-week-content">
            <MiniCalendar selected={19} compact />
            <div className="overview-week-grid">
              <div className="overview-week-head"><span>W33</span>{WEEK_DAYS.map((day) => <span key={day}>{day}</span>)}</div>
              <div
                ref={weekTimelineRef}
                className="overview-week-scroll"
                role="region"
                aria-label="本周面试时间表，可上下滚动查看 00:00 至 21:00"
                tabIndex={0}
              >
                <div className="overview-week-timeline">
                  <div className="overview-week-hours">{OVERVIEW_HOURS.map((hour) => <span key={hour}>{hour}</span>)}</div>
                  <div className="overview-week-events">
                    {overviewEvents.map((event) => (
                      <article
                        key={`${event.company}-${event.day}`}
                        className={`overview-event tone-${event.tone}`}
                        style={{ "--event-day": event.day, "--event-slot": event.startSlot, "--event-span": event.span } as CSSProperties}
                      >
                        <strong>{event.company}</strong><span>{event.stage} · {event.time}</span><small>视频面试</small>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ScheduleView({
  filter,
  interviews,
  selected,
  companyColors,
  onFilter,
  onSelect,
  onMove,
}: {
  filter: "all" | "upcoming" | "completed";
  interviews: Interview[];
  selected: Interview;
  companyColors: Record<string, CalendarColor>;
  onFilter: (filter: "all" | "upcoming" | "completed") => void;
  onSelect: (id: string) => void;
  onMove: (id: string, calendarDay: number, calendarStart: number) => void;
}) {
  return (
    <div className="interview-schedule-layout">
      <aside className="interview-surface schedule-filter-panel">
        <MiniCalendar selected={20} />
        <div className="schedule-filter-group"><h3>面试状态</h3>{(["all", "upcoming", "completed"] as const).map((value) => <button type="button" key={value} className={filter === value ? "is-active" : ""} onClick={() => onFilter(value)}><span className={`status-dot status-${value}`} />{value === "all" ? "全部" : value === "upcoming" ? "待面试" : "已完成"}<b>{value === "all" ? 12 : value === "upcoming" ? 5 : 6}</b></button>)}<button type="button"><span className="status-dot status-cancelled" />已取消<b>1</b></button></div>
        <div className="schedule-filter-group"><h3>其他筛选</h3><button type="button"><BriefcaseBusiness />按公司</button><button type="button"><ListChecks />按职位</button><button type="button"><Trophy />我的关注<b>3</b></button></div>
      </aside>
      <section className="interview-surface schedule-calendar-panel">
        <div className="schedule-calendar-toolbar">
          <div className="schedule-scope-tabs" aria-label="日历状态筛选">{(["all", "upcoming", "completed"] as const).map((value) => <button type="button" key={value} className={filter === value ? "is-active" : ""} onClick={() => onFilter(value)}>{value === "all" ? "全部" : value === "upcoming" ? "待面试" : "已完成"}</button>)}</div>
          <strong>2026年8月17日 – 8月23日</strong>
          <div className="schedule-view-switch"><button type="button">日</button><button className="is-active" type="button">周</button><button type="button">月</button></div>
        </div>
        <p id="schedule-drag-instructions" className="visually-hidden">拖动面试可以调整排期，时间按 30 分钟对齐。键盘聚焦后，上下方向键移动 30 分钟，左右方向键移动一天。</p>
        <WeekCalendar interviews={interviews} companyColors={companyColors} selectedId={selected.id} onSelect={onSelect} onMove={onMove} />
      </section>
      <InterviewContextSidebar className="schedule-detail-aside" interview={selected} calendarColor={companyColors[selected.company]} />
    </div>
  );
}

function RecordsView({
  interviews,
  selected,
  companyColors,
  onSelect,
  onColorChange,
}: {
  interviews: Interview[];
  selected: Interview;
  companyColors: Record<string, CalendarColor>;
  onSelect: (id: string) => void;
  onColorChange: (company: string, color: CalendarColor) => void;
}) {
  return (
    <div className="interview-records-layout">
      <aside className="records-index-column">
        <section className="interview-surface records-list-card">
          <div className="records-list-heading"><h2>面试列表</h2><div><Search /><ListChecks /></div></div>
          <div className="records-table-head"><span>公司</span><span>职位</span><span>阶段</span><span>面试时间</span><span>状态</span></div>
          <div className="records-list">
            {interviews.map((item) => <button type="button" key={item.id} className={item.id === selected.id ? "is-active" : ""} onClick={() => onSelect(item.id)}><CompanyLogo item={{ company: item.company, logo: item.logo, tone: item.tone }} /><span>{item.company}</span><span>{item.role}</span><span>{item.stage}</span><span>{item.date} {item.time}</span><StatusBadge status={item.status} /></button>)}
          </div>
        </section>
        <section className="interview-surface records-calendar-card"><MiniCalendar selected={17} /><div className="records-calendar-legend"><span><i className="orange" />待面试</span><span><i className="blue" />进行中</span><span><i className="green" />已完成</span></div></section>
      </aside>
      <section className="interview-surface record-detail-panel">
        <header className="record-detail-header"><CompanyLogo item={{ company: selected.company, logo: selected.logo, tone: selected.tone }} /><div><h2>{selected.company} · {selected.role}</h2><p><CalendarDays />面试时间：2026年{selected.date} {selected.time}　 <Video />面试形式：{selected.mode}　 <UserRound />负责人：张同学</p></div><div className="record-detail-actions"><Button size="sm" variant="outline" icon={<Pencil />}>编辑</Button><Button size="icon" variant="outline" aria-label="更多操作"><MoreHorizontal /></Button></div></header>
        <StageProgress current={selected.stage} />
        <section className="record-section"><h3><FileText />面试信息</h3><dl><div><dt>职位</dt><dd>{selected.role}</dd></div><div><dt>工作年限</dt><dd>3–5年</dd></div><div><dt>部门</dt><dd>基础架构 – 存储与中间件</dd></div><div><dt>期望薪资</dt><dd>25K – 35K</dd></div><div><dt>面试官</dt><dd>{selected.interviewer}</dd></div><div><dt>面试地点</dt><dd>线上（飞书会议） <ExternalLink /></dd></div><div className="record-color-setting"><dt>日历颜色</dt><dd><CalendarColorPicker company={selected.company} value={companyColors[selected.company]} onChange={(color) => onColorChange(selected.company, color)} /></dd></div></dl></section>
        <section className="record-section questions-section"><h3><ListChecks />题目记录</h3><p>记录面试中遇到的问题、关键思路与参考答案，便于后续复盘。</p><div className="mock-rich-editor"><h4>1. 自我介绍</h4><ul><li>项目亮点：高并发场景、分布式缓存、消息队列，以及这些项目中的性能优化案例。</li><li>技术栈：Java / Go、熟悉 Spring Cloud、MyBatis、Redis、Kafka。</li></ul><h4>2. 设计题：设计一个短链接服务</h4><ul><li>如何生成短链？如何保证唯一性？如何支持高并发？扩展性如何考虑？</li></ul><div className="mock-editor-toolbar"><b>B</b><i>I</i><u>U</u><ListChecks /><Link2 /><FileText /><span>286 字</span></div></div></section>
        <CollapsibleRecord title="复盘总结">整体发挥较好，项目经验匹配度高；在高并发和一致性方案上回答较完整。对短链接服务的设计思路清晰，但数据存储和容灾方案可进一步深入。</CollapsibleRecord>
        <CollapsibleRecord title="需要改进">加强系统设计题的细节深度，尤其是一致性与容错；补充缓存穿透、雪崩场景的应对策略。</CollapsibleRecord>
      </section>
      <InterviewContextSidebar className="record-assets-column" interview={selected} calendarColor={companyColors[selected.company]} />
    </div>
  );
}

function SectionHeading({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return <header className="interview-section-heading"><h2>{title}</h2>{action && <button type="button" onClick={onAction}>{action}<ChevronRight /></button>}</header>;
}

function CompanyLogo({ item }: { item: { company: string; logo: string; tone: string } }) {
  return <span className={`company-logo tone-${item.tone}`} aria-hidden="true">{item.logo}</span>;
}

function PipelineCard({ item }: { item: (typeof PIPELINE_CARDS)[string] }) {
  return <article className="pipeline-card" aria-label={`${item.company} ${item.role}`}><header className="pipeline-card-header"><span className="pipeline-card-company"><CompanyLogo item={item} /><strong>{item.company}</strong></span><small className="pipeline-card-role">{item.role}</small></header><div className="pipeline-card-meta"><span>{item.metaLeft}</span><span className="pipeline-card-time">{item.metaRight}</span></div></article>;
}

function MiniCalendar({ selected, compact = false }: { selected: number; compact?: boolean }) {
  return <div className={`mini-calendar${compact ? " is-compact" : ""}`}><header><strong>2026年8月</strong><span><ChevronLeft /><ChevronRight /></span></header><div className="mini-calendar-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div className="mini-calendar-days">{MONTH_DAYS.map((day, index) => <button type="button" key={`${day}-${index}`} className={`${index < 5 || index > 35 ? "is-muted " : ""}${day === selected && index > 4 && index < 36 ? "is-selected" : ""}`}>{day}{[14, 16, 18].includes(index) && <i />}</button>)}</div></div>;
}

function WeekCalendar({ interviews, companyColors, selectedId, onSelect, onMove }: { interviews: Interview[]; companyColors: Record<string, CalendarColor>; selectedId: string; onSelect: (id: string) => void; onMove: (id: string, calendarDay: number, calendarStart: number) => void }) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ calendarDay: number; calendarStart: number } | null>(null);
  const dragGrabOffset = useRef(0);
  const draggingInterview = interviews.find((item) => item.id === draggingId);

  const resolveDropTarget = (event: ReactDragEvent<HTMLDivElement>, span: number) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const gridLeft = rect.left + 58;
    const gridWidth = Math.max(1, rect.width - 58);
    const calendarDay = Math.min(6, Math.max(0, Math.floor((event.clientX - gridLeft) / (gridWidth / 7))));
    const rawSlot = Math.floor((event.clientY - rect.top) / (rect.height / SCHEDULE_SLOT_COUNT)) - dragGrabOffset.current;
    return { calendarDay, calendarStart: Math.min(SCHEDULE_SLOT_COUNT - span, Math.max(0, rawSlot)) };
  };

  const moveWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>, item: Interview) => {
    const movement = event.key === "ArrowUp" ? { day: 0, slot: -1 } : event.key === "ArrowDown" ? { day: 0, slot: 1 } : event.key === "ArrowLeft" ? { day: -1, slot: 0 } : event.key === "ArrowRight" ? { day: 1, slot: 0 } : null;
    if (!movement) return;
    event.preventDefault();
    const nextDay = Math.min(6, Math.max(0, item.calendarDay + movement.day));
    const nextStart = Math.min(SCHEDULE_SLOT_COUNT - item.calendarSpan, Math.max(0, item.calendarStart + movement.slot));
    onMove(item.id, nextDay, nextStart);
  };

  return <div className="week-calendar"><div className="week-calendar-head"><span>全天</span>{WEEK_DAYS.map((day, index) => <span key={day} className={index === 3 ? "is-today" : ""}>{day}</span>)}</div><div
    className={`week-calendar-body${draggingId ? " is-dragging" : ""}`}
    role="grid"
    aria-label="面试周排期，可拖动并按 30 分钟调整"
    onDragOver={(event) => {
      if (!draggingInterview) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(resolveDropTarget(event, draggingInterview.calendarSpan));
    }}
    onDragLeave={(event) => {
      const relatedTarget = event.relatedTarget;
      if (!(relatedTarget instanceof Node) || !event.currentTarget.contains(relatedTarget)) setDropTarget(null);
    }}
    onDrop={(event) => {
      event.preventDefault();
      const id = event.dataTransfer.getData("text/interview-id") || draggingId;
      const item = interviews.find((interview) => interview.id === id);
      if (id && item) {
        const target = resolveDropTarget(event, item.calendarSpan);
        onMove(id, target.calendarDay, target.calendarStart);
      }
      dragGrabOffset.current = 0;
      setDraggingId(null);
      setDropTarget(null);
    }}
  ><div className="week-hour-labels">{HOURS.map((hour) => <span key={hour}>{hour}</span>)}</div><div className="week-grid-lines" />{dropTarget && draggingInterview && <div className={`week-drop-preview calendar-${companyColors[draggingInterview.company] ?? "gray"}`} style={{ gridColumn: dropTarget.calendarDay + 2, gridRow: `${dropTarget.calendarStart + 1} / span ${draggingInterview.calendarSpan}` }}><span>{formatScheduleTime(dropTarget.calendarStart)} – {formatScheduleTime(dropTarget.calendarStart + draggingInterview.calendarSpan)}</span></div>}{interviews.map((item) => {
    const calendarColor = companyColors[item.company] ?? "gray";
    return <button
      type="button"
      key={item.id}
      draggable
      aria-describedby="schedule-drag-instructions"
      className={`week-event calendar-${calendarColor}${selectedId === item.id ? " is-selected" : ""}${draggingId === item.id ? " is-dragging" : ""}`}
      style={{ gridColumn: item.calendarDay + 2, gridRow: `${item.calendarStart + 1} / span ${item.calendarSpan}` }}
      onClick={() => onSelect(item.id)}
      onKeyDown={(event) => moveWithKeyboard(event, item)}
      onDragStart={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const pointerOffset = Number.isFinite(event.clientY) && rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
        dragGrabOffset.current = Math.min(item.calendarSpan - 1, Math.max(0, Math.floor(pointerOffset * item.calendarSpan)));
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/interview-id", item.id);
        setDraggingId(item.id);
        onSelect(item.id);
      }}
      onDragEnd={() => { dragGrabOffset.current = 0; setDraggingId(null); setDropTarget(null); }}
    ><span className="week-event-time"><Clock3 />{item.time} – {item.endTime}</span><strong>{item.company} · {item.stage}</strong><small>{item.role}</small></button>;
  })}<div className="current-time-line"><span>15:38</span></div></div></div>;
}

function formatScheduleTime(slot: number) {
  const totalMinutes = SCHEDULE_START_HOUR * 60 + slot * 30;
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function CalendarColorPicker({ company, value = "gray", onChange }: { company: string; value?: CalendarColor; onChange: (color: CalendarColor) => void }) {
  const currentLabel = CALENDAR_COLORS.find((color) => color.id === value)?.label ?? "灰色";
  return <div className="calendar-color-picker" role="group" aria-label={`${company}日历颜色，当前${currentLabel}`}><span>{currentLabel}</span>{CALENDAR_COLORS.map((color) => <button key={color.id} type="button" className={`calendar-color-swatch calendar-${color.id}`} aria-label={`将${company}的日历颜色设为${color.label}`} aria-pressed={color.id === value} title={color.label} onClick={() => onChange(color.id)} />)}</div>;
}

function InterviewContextSidebar({ className, interview, calendarColor = "gray", onViewRecord }: { className: string; interview: Interview; calendarColor?: CalendarColor; onViewRecord?: () => void }) {
  return <aside className={`${className} interview-context-sidebar`} aria-label={`${interview.company}面试上下文`}>
    <section className="interview-surface context-primary-card">
      <header className="context-company-header">
        <span className={`context-company-mark calendar-${calendarColor}`}>{interview.logo}</span>
        <strong>{interview.company}</strong>
        <StatusBadge status={interview.status} />
      </header>
      <h2>{interview.stage}（技术面试）</h2>
      <p className="context-role">{interview.role}</p>
      <dl className="context-detail-list">
        <DetailRow icon={<Clock3 />} label="时间" value={`2026年${interview.date}（${interview.weekday}） ${interview.time} – ${interview.endTime}`} />
        <DetailRow icon={<Link2 />} label="面试方式" value={interview.mode} />
        <DetailRow icon={<UserRound />} label="面试官" value={interview.interviewer} />
        <DetailRow icon={<CircleCheck />} label="状态" value={interview.status === "completed" ? "已完成" : "待面试"} />
        <DetailRow icon={<Bell />} label="备注" value={interview.note} />
      </dl>
      <div className="context-related-materials">
        <h3>相关资料</h3>
        <button type="button"><FileText /><span><strong>{interview.company}后端开发 JD</strong><small>更新于 2026/07/28</small></span><ChevronDown /></button>
        <button type="button"><FileText /><span><strong>我的简历 · 后端方向</strong><small>更新于 2026/08/10</small></span></button>
      </div>
    </section>
    <section className="interview-surface context-recent-card">
      <header><h2>最近记录</h2>{onViewRecord && <button type="button" onClick={onViewRecord}>查看全部<ChevronRight /></button>}</header>
      <ol><li>介绍一下你负责过的高并发系统设计思路？</li><li>如何保证接口的幂等性？</li><li>你如何进行 SQL 调优？</li></ol>
      <div className="context-improvement"><Lightbulb /><div><strong>需要改进</strong><p>对分布式事务的理解还不够深入，建议复习 TCC 与消息队列方案，并补充极端场景的处理策略。</p></div></div>
    </section>
    <button type="button" className="interview-surface context-job-archive-card" onClick={() => navigateTo("/jobs")}>
      <span>查看对应岗位档案</span><div><FolderOpen /><p><strong>{interview.company} · {interview.role}</strong><small>更新于 2026/07/28</small></p><ChevronRight /></div>
    </button>
  </aside>;
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div><dt>{icon}{label}</dt><dd>{value}</dd></div>;
}

function StatusBadge({ status }: { status: InterviewStatus }) {
  const label = status === "completed" ? "已完成" : status === "active" ? "进行中" : status === "cancelled" ? "已取消" : "待面试";
  return <span className={`interview-status-badge status-${status}`}>{label}</span>;
}

function StageProgress({ current }: { current: string }) {
  const stages = ["筛选中", "一面", "二面", "HR 面", "Offer"];
  const currentIndex = Math.max(1, stages.indexOf(current));
  return <div className="stage-progress" aria-label={`当前阶段：${current}`}><div className="stage-progress-line" />{stages.map((stage, index) => <div key={stage} className={index < currentIndex ? "is-done" : index === currentIndex ? "is-current" : ""}><span>{index < currentIndex ? <Check /> : null}</span><strong>{stage}</strong></div>)}</div>;
}

function CollapsibleRecord({ title, children }: { title: string; children: ReactNode }) {
  return <section className="record-section compact-record-section"><header><h3><CircleCheck />{title}</h3><Button size="sm" variant="outline">编辑</Button><ChevronDown /></header><p>{children}</p></section>;
}

function interviewViewPath(view: InterviewView) {
  const params = new URLSearchParams();
  if (view !== "overview") params.set("view", view);
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("mock") === "1") {
    params.set("mock", "1");
  }
  const search = params.toString();
  return search ? `/interviews?${search}` : "/interviews";
}
