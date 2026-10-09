import { t, useLocale, getLocale } from "@/i18n";
// 07.1 模拟面试首页（Figma 241:2 有安排 / 251:2 未练习 / 252:2 新用户）与练习记录（253:2）。
// 求职记录与面试安排来自真实接口 api.*；模拟面试场次来自 mockInterviewApi（真实 /api/mock-interviews，测试用假数据）。
import { useContentMotion } from "@/components/ui/motion";
import { Reveal, SkeletonCards, SkeletonHead, SkeletonRows } from "@/v3/skeletons";
import { readPageCache, writePageCache } from "@/v3/pageCache";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api, type InterviewSessionSummary, type JobApplicationSummary } from "@/api/client";
import { mockInterviewPath, navigateTo, newMockInterviewPath } from "@/routing";
import { Icon } from "@/v3/Icon";
import { ConfirmDialog, Segmented, Select, Toast, PageEyebrow } from "@/v3/primitives";
import {
  ACTIVE_STATUSES,
  DIMENSION_LABELS,
  INTERVIEW_TYPE_LABELS,
  mockInterviewApi,
  mockInterviewErrorMessage,
  subscribeMockInterviews,
  type MockCompetencyKey,
  type MockInterviewDetail,
  type MockInterviewSummary,
  type MockInterviewType,
} from "./mockInterviewApi";
import { STATUS_LABELS, countdown, dateTimeLabel, dayBand, hhmm, interviewTitle, mmdd, timeAgo, typeDifficulty, weekday } from "./mockShared";

const MOCK_HOME_CACHE_KEY = "mock-interview-home";

/* ───────────── 数据 ───────────── */

type HomeData = {
  interviews: MockInterviewSummary[];
  // 报告详情（算维度平均用），只取已完成场次
  details: MockInterviewDetail[];
  active: MockInterviewDetail | null;
  applications: JobApplicationSummary[];
  upcoming: InterviewSessionSummary | null;
};

// 能力表现按最近这些已完成场次的能力项求平均
const DIMENSION_SAMPLE = 10;

function useMockList() {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeMockInterviews(() => setVersion((value) => value + 1)), []);
  return version;
}

function useHomeData() {
  const version = useMockList();
  // 回到模拟面试首页时先用上一次的数据直接显示，同时在后台刷新（假数据层很快，这里主要省掉骨架）
  const [data, setData] = useState<HomeData | null>(() => readPageCache<HomeData>(MOCK_HOME_CACHE_KEY)?.value ?? null);
  const [error, setError] = useState(false);
  const [careerFailed, setCareerFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { items } = await mockInterviewApi.list();
        const completed = items.filter((item) => item.status === "completed");
        const activeSummary = items.find((item) => ACTIVE_STATUSES.includes(item.status)) ?? null;
        const [details, active] = await Promise.all([
          // 能力维度只需要报告详情：取最近 DIMENSION_SAMPLE 场，避免场次多时逐场请求
          Promise.all(completed.slice(0, DIMENSION_SAMPLE).map((item) => mockInterviewApi.get(item.id).then((result) => result.mock_interview))),
          activeSummary ? mockInterviewApi.get(activeSummary.id).then((result) => result.mock_interview) : Promise.resolve(null),
        ]);
        // 求职记录 / 面试安排失败不影响模拟面试本身，只隐藏对应区块
        let applications: JobApplicationSummary[] = [];
        let upcoming: InterviewSessionSummary | null = null;
        try {
          const now = new Date().toISOString();
          const [apps, sessions] = await Promise.all([
            api.listJobApplications({ scope: "active" }),
            api.listInterviewSessions({ status: "scheduled", start_at: now }),
          ]);
          applications = apps.items.filter((item) => item.status === "active" && item.lifecycle_status !== "terminated");
          upcoming = sessions.items
            .filter((session) => session.status === "scheduled" && new Date(session.start_at).getTime() >= Date.now())
            .sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ?? null;
          if (alive) setCareerFailed(false);
        } catch {
          if (alive) setCareerFailed(true);
        }
        if (alive) {
          const next = { interviews: items, details, active, applications, upcoming };
          setData(next);
          writePageCache(MOCK_HOME_CACHE_KEY, next);
          setError(false);
        }
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => { alive = false; };
  }, [version, reload]);

  return { data, error, careerFailed, retry: () => setReload((value) => value + 1) };
}

// 练习记录视图用 ?view=records 标记（路由层只识别 /mock-interviews，查询参数由本页自己读）
function subscribeLocation(listener: () => void) {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
}
function useRecordsView() {
  return useSyncExternalStore(subscribeLocation, () => new URLSearchParams(window.location.search).get("view") === "records", () => false);
}
export const recordsPath = "/mock-interviews?view=records";

/* ───────────── 统计（练习时长、题型覆盖等前端从场次推算） ───────────── */

// 设计稿「系统设计」不是后端的面试类型；这里用真实的四种类型做覆盖，HR 阶段换成 HR 面
function coverageTypes(stageLabel: string | null | undefined): MockInterviewType[] {
  return stageLabel?.trim().toUpperCase().startsWith("HR") ? ["hr", "comprehensive", "project_deep_dive"] : ["technical", "project_deep_dive", "comprehensive"];
}

// 每题约 4 分钟 + 5 分钟开场（仅用于提示文案）
const MINUTES_PER_QUESTION = 4;
function estimateMinutes(count = 5) {
  return count * MINUTES_PER_QUESTION + 5;
}

// 累计练习时长：优先用开始到结束的真实时长；时间戳缺失或相同（假数据）时按题数估算
function practiceHours(items: MockInterviewSummary[]) {
  const ms = items.reduce((sum, item) => {
    const real = item.started_at && item.finished_at ? new Date(item.finished_at).getTime() - new Date(item.started_at).getTime() : 0;
    return sum + (real > 0 ? real : estimateMinutes(item.question_count) * 60_000);
  }, 0);
  return ms / 3_600_000;
}

function appPractice(applicationId: string, interviews: MockInterviewSummary[]) {
  const mine = interviews.filter((item) => item.job_application_id === applicationId);
  const done = mine.filter((item) => item.status === "completed");
  const abandoned = mine.filter((item) => item.status === "abandoned");
  if (done.length) return t("{value0} 场 · {value1} 分", { value0: done.length, value1: Math.round(Math.max(...done.map((item) => item.total_score ?? 0))) });
  if (abandoned.length) return t("{value0} 场已放弃", { value0: abandoned.length });
  return t("未练习");
}

const STAGE_STATE_LABELS: Record<string, string> = { get awaiting_schedule() { return t("待约面"); }, get scheduled() { return t("已约面"); }, get awaiting_result() { return t("等结果"); }, get negotiating() { return t("谈薪中"); } };

/* ───────────── 页面 ───────────── */

// 数据到达前画骨架，到达后由 Reveal 交接（内容直接出现在最终位置，骨架残影淡出），不闪白
export function MockInterviewHome() {
  useLocale();
  const records = useRecordsView();
  const home = useHomeData();
  const skeleton = <div className="mi-page">{records ? <><SkeletonHead sub /><SkeletonRows rows={5} label={t("正在加载练习记录…")} /></> : <><SkeletonHead /><SkeletonCards cards={[196, 150, 120]} label={t("正在加载模拟面试…")} /></>}</div>;
  return <Reveal loading={!home.data && !home.error} placeholder={skeleton}><MockInterviewHomeBody records={records} home={home} /></Reveal>;
}

function MockInterviewHomeBody({ records, home }: { records: boolean; home: ReturnType<typeof useHomeData> }) {
  useLocale();
  const { data, error, careerFailed, retry } = home;
  const [abandonTarget, setAbandonTarget] = useState<MockInterviewDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  if (error) {
    return (
      <div className="mi-page">
        <HomeHeader count={0} hasUpcoming={false} newUser={false} />
        <div className="mi-load-error" role="alert">
          <strong>{t("模拟面试没有加载出来")}</strong>
          <span>{t("你的练习记录都还在，刷新一下试试。")}</span>
          <button type="button" className="v3-btn v3-btn-ghost" onClick={retry}><Icon name="refresh" size={13} />{t("重新加载")}</button>
        </div>
      </div>
    );
  }
  if (!data) return null;
  if (records) return <RecordsView interviews={data.interviews} />;

  const completed = data.interviews.filter((item) => item.status === "completed");
  const abandonedCount = data.interviews.filter((item) => item.status === "abandoned").length;
  const focus = focusTarget(data.upcoming, data.applications, data.interviews);
  const newUser = !focus && data.interviews.length === 0;

  const abandon = async () => {
    if (!abandonTarget) return;
    setBusy(true);
    try {
      await mockInterviewApi.abandon(abandonTarget.id);
      setAbandonTarget(null);
    } catch (reason) {
      setToast(mockInterviewErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mi-page">
      <HomeHeader count={data.interviews.length} hasUpcoming={Boolean(focus)} newUser={newUser} />
      {focus ? (
        <UpcomingCard focus={focus} interviews={data.interviews} active={data.active} onAbandon={setAbandonTarget} />
      ) : newUser ? (
        <StartCard />
      ) : data.active ? (
        <section className="mi-card mi-resume-only"><ResumeStrip active={data.active} onAbandon={setAbandonTarget} /></section>
      ) : null}
      {completed.length ? <StatsCard completed={completed} details={data.details} abandoned={abandonedCount} /> : <StatsEmpty abandoned={abandonedCount} />}
      <OtherJobs
        title={newUser ? t("从在投岗位开始") : t("其他在投岗位")}
        applications={data.applications.filter((app) => app.id !== focus?.applicationId)}
        interviews={data.interviews}
        failed={careerFailed}
      />
      {abandonTarget && (
        <ConfirmDialog
          title={t("放弃这场模拟面试？")}
          description={t("已作答的内容不会生成评估报告，放弃后可以重新开始一场。")}
          confirmLabel={t("放弃本场")}
          busyLabel={t("正在放弃…")}
          busy={busy}
          onConfirm={abandon}
          onCancel={() => setAbandonTarget(null)}
        />
      )}
      {toast && <Toast kind="error" title={t("操作没有完成")} message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function HomeHeader({ count, hasUpcoming, newUser }: { count: number; hasUpcoming: boolean; newUser: boolean }) {
  useLocale();
  return (
    <header className="mi-home-head">
      <div>
        <PageEyebrow segments={["MOCK INTERVIEW", count ? t("{value0} 场练习", { value0: count }) : t("AI 练习")]} />
        <h1 className="v3-page-title mi-home-title">{t("模拟面试")}</h1>
        <p className="mi-home-sub">{newUser ? t("从一个在投岗位开始，AI 会按岗位 JD 和你的简历出题。") : t("按你在投的岗位组织练习，离面试越近越靠前。")}</p>
      </div>
      <div className="mi-home-actions">
        <button type="button" className="v3-btn v3-btn-ghost mi-records-btn" disabled={count === 0} onClick={() => navigateTo(recordsPath)}>
          <Icon name="clock" size={14} />{t("练习记录")}<span className="mi-count">{count}</span>
        </button>
        {/* 每页只有一个黑色主按钮：主卡里已有黑色按钮时，这里降为描边 */}
        <button type="button" className={`v3-btn ${hasUpcoming ? "v3-btn-ghost" : "v3-btn-dark"}`} onClick={() => navigateTo(newMockInterviewPath())}>{t("开始新面试")}</button>
      </div>
    </header>
  );
}

// 主卡对象：有面试安排时用最近一场；没有安排时用在投岗位里最该练的一个（下次面试最近，其次最近练过），保证首页始终有主卡
type FocusTarget = {
  applicationId: string;
  application: JobApplicationSummary | null;
  company: string;
  jobTitle: string;
  stageLabel: string;
  startAt: string | null;
  stateLabel: string;
};

function focusTarget(upcoming: InterviewSessionSummary | null, applications: JobApplicationSummary[], interviews: MockInterviewSummary[]): FocusTarget | null {
  if (upcoming) {
    const application = applications.find((app) => app.id === upcoming.application_id) ?? null;
    return { applicationId: upcoming.application_id, application, company: upcoming.company_name, jobTitle: upcoming.job_title, stageLabel: upcoming.stage_label, startAt: upcoming.start_at, stateLabel: "" };
  }
  if (!applications.length) return null;
  const lastPractice = (id: string) => interviews.filter((item) => item.job_application_id === id).map((item) => item.created_at).sort().pop() ?? "";
  const [app] = [...applications].sort((a, b) =>
    (a.next_session_start_at ?? "9999").localeCompare(b.next_session_start_at ?? "9999") || lastPractice(b.id).localeCompare(lastPractice(a.id)));
  return {
    applicationId: app.id,
    application: app,
    company: app.company_name_snapshot,
    jobTitle: app.job_title_snapshot,
    stageLabel: app.current_stage_label,
    startAt: null,
    stateLabel: STAGE_STATE_LABELS[app.stage_state] ?? t("进行中"),
  };
}

function UpcomingCard({
  focus,
  interviews,
  active,
  onAbandon,
}: {
  focus: FocusTarget;
  interviews: MockInterviewSummary[];
  active: MockInterviewDetail | null;
  onAbandon: (item: MockInterviewDetail) => void;
}) {
  useLocale();
  const { application } = focus;
  const types = coverageTypes(focus.stageLabel);
  const mine = interviews.filter((item) => item.job_application_id === focus.applicationId && item.status === "completed");
  const coverage = types.map((type) => {
    const done = mine.filter((item) => item.interview_type === type);
    const latest = [...done].sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)))[0];
    return { type, count: done.length, latest: latest ? Math.round(latest.total_score ?? 0) : null };
  });
  const practiced = coverage.filter((item) => item.count > 0).length;
  const next = coverage.find((item) => item.count === 0) ?? null;
  const recommended = next?.type ?? types[0];
  const startPath = `${newMockInterviewPath({ applicationId: focus.applicationId })}&type=${recommended}`;
  const buttonLabel = practiced === 0 ? t("针对这场练一次") : next ? t("练{value0}", { value0: INTERVIEW_TYPE_LABELS[next.type] }) : t("再练一场");
  const note = practiced === 0 ? t("先练{value0} · 约 {value1} 分钟", { value0: INTERVIEW_TYPE_LABELS[recommended], value1: estimateMinutes() }) : t("{value0}常考 · 约 {value1} 分钟", { value0: focus.stageLabel, value1: estimateMinutes() });
  const today = focus.startAt ? dayBand(focus.startAt) === t("今天") : false;

  return (
    <section className="mi-card mi-upcoming" aria-label={focus.startAt ? t("最近的面试安排") : t("在投岗位练习")}>
      <div className="mi-up-main">
        {focus.startAt ? (
          <div className="mi-date-card">
            <div className={`mi-date-band${today ? " is-today" : ""}`}><b>{dayBand(focus.startAt)}</b><span>{weekday(focus.startAt)}</span></div>
            <div className="mi-date-body">
              <strong>{hhmm(focus.startAt)}</strong>
              <span><i className={today ? "is-today" : ""} />{countdown(focus.startAt)}</span>
            </div>
          </div>
        ) : (
          // 还没约面试时间：日期卡改为显示当前阶段，点击去面试日程添加时间
          <button type="button" className="mi-date-card is-unscheduled" onClick={() => navigateTo("/career/schedule")} aria-label={t("添加面试时间")}>
            <div className="mi-date-band"><b>{focus.stateLabel}</b></div>
            <div className="mi-date-body">
              <strong>{focus.stageLabel}</strong>
              <span>{t("添加时间 ›")}</span>
            </div>
          </button>
        )}
        <div className="mi-up-info">
          <div className="mi-up-title">
            <h2>{focus.company} · {focus.jobTitle}</h2>
            <span className="mi-tag">{focus.stageLabel} · {INTERVIEW_TYPE_LABELS[recommended]}</span>
          </div>
          <div className="mi-prep">
            <span className="mi-prep-label">{t("准备度")}</span>
            <b>{practiced} / {types.length}</b>
            <span className="mi-prep-label">{t("题型已练")}</span>
            <span className="mi-prep-bar" aria-hidden="true">
              {coverage.map((item, index) => <i key={item.type} className={item.count ? "is-done" : practiced > 0 && index === coverage.indexOf(next!) ? "is-next" : ""} />)}
            </span>
          </div>
          <div className="mi-coverage">
            {coverage.map((item) => (
              <span key={item.type} className={`mi-cover-chip${item.count ? " is-done" : practiced > 0 && item === next ? " is-next" : ""}`}>
                {item.count ? <Icon name="ccheck" size={12} /> : <span className="mi-dash-ring" aria-hidden="true" />}
                <b>{INTERVIEW_TYPE_LABELS[item.type]}</b>
                <small>{item.count ? t("{value0} 场 · 最近 {value1}", { value0: item.count, value1: item.latest }) : t("还没练")}</small>
              </span>
            ))}
          </div>
        </div>
        <div className="mi-up-actions">
          <button type="button" className="mi-link" onClick={() => navigateTo(application?.job_description_id ? `/career/jobs/${encodeURIComponent(application.job_description_id)}` : `/career/applications/${encodeURIComponent(focus.applicationId)}`)}>{t("查看岗位 ›")}</button>
          <button type="button" className="v3-btn v3-btn-dark mi-up-primary" onClick={() => navigateTo(startPath)}>{buttonLabel}</button>
          <small>{note}</small>
        </div>
      </div>
      {active && <ResumeStrip active={active} onAbandon={onAbandon} />}
    </section>
  );
}

// 「有一场未完成」条：进行中 / 准备中 / 评估中的场次
function ResumeStrip({ active, onAbandon }: { active: MockInterviewDetail; onAbandon: (item: MockInterviewDetail) => void }) {
  useLocale();
  const current = Math.min(active.question_count, active.answered_main_questions + (active.status === "in_progress" ? 1 : 0));
  const detail = active.status === "in_progress"
    ? t("{value0} · 第 {value1} / {value2} 题 · {value3}", { value0: INTERVIEW_TYPE_LABELS[active.interview_type], value1: current, value2: active.question_count, value3: timeAgo(latestActivity(active)) })
    : `${INTERVIEW_TYPE_LABELS[active.interview_type]} · ${STATUS_LABELS[active.status]}`;
  const ratio = active.status === "evaluating" ? 1 : active.answered_main_questions / active.question_count;
  return (
    <div className="mi-resume">
      <i className="mi-resume-dot" aria-hidden="true" />
      <strong>{active.status === "evaluating" ? t("有一场正在评估") : t("有一场未完成")}</strong>
      <span>{detail}</span>
      <span className="mi-resume-bar" aria-hidden="true"><i style={{ width: `${Math.round(ratio * 100)}%` }} /></span>
      {active.status !== "evaluating" && <button type="button" className="mi-text-btn" onClick={() => onAbandon(active)}>{t("放弃")}</button>}
      <button type="button" className="v3-btn v3-btn-ghost is-sm" onClick={() => navigateTo(mockInterviewPath(active.id))}>{active.status === "evaluating" ? t("查看进度") : t("继续上次")}</button>
    </div>
  );
}

function latestActivity(item: MockInterviewDetail) {
  return item.questions.map((question) => question.answered_at).filter(Boolean).sort().pop() ?? item.started_at ?? item.created_at;
}

// 252:2 新用户：没有安排、也没有记录
function StartCard() {
  useLocale();
  return (
    <section className="mi-start" aria-label={t("开始第一场")}>
      <span className="mi-start-illus" aria-hidden="true"><Icon name="chat" size={28} /></span>
      <div className="mi-start-text">
        <h2>{t("还没有面试安排，也还没练过")}</h2>
        <p>{t("选一个下面的在投岗位做第一场练习；在求职记录里添加面试时间后，最近的一场会出现在这里。")}</p>
        <ol>
          <li><b>1</b>{t("选岗位")}</li>
          <li><b>2</b>{t("答 5 道题 · 约 ")}{estimateMinutes()}{t(" 分钟")}</li>
          <li><b>3</b>{t("拿到评估报告")}</li>
        </ol>
      </div>
      <button type="button" className="v3-btn v3-btn-ghost mi-start-btn" onClick={() => navigateTo("/career/schedule")}>{t("添加面试时间")}</button>
    </section>
  );
}

// 得分变化只比较同类型、同难度的场次；默认选最近一场所在的组合
const TREND_LIMIT = 8;
const VERDICT_TONE: Record<string, string> = { meets: "is-good", borderline: "is-mid", below: "is-bad" };
const VERDICT_SHORT: Record<string, string> = { get meets() { return t("达到"); }, get borderline() { return t("接近"); }, get below() { return t("有差距"); } };
const WEAK_COMPETENCY = 55;

function finishedAt(item: MockInterviewSummary) {
  return item.finished_at ?? item.created_at;
}

function scopeKey(item: Pick<MockInterviewSummary, "interview_type" | "difficulty">) {
  return `${item.interview_type}:${item.difficulty}`;
}

type AbilityRow = { key: string; label: string; value: number; ratio: number; text: string };
type Abilities = { legacy: boolean; samples: number; rows: AbilityRow[]; weakKey: string | null };

const LEGACY_DIMENSION_KEYS = ["professional_depth", "structure", "job_fit", "resume_consistency", "communication"] as const;
// 旧版维度是 1–5 分；低于 3.5 分（约等于新版 62 分）才提示待加强
const WEAK_LEGACY_DIMENSION = 3.5;

function average(values: number[]) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// 优先汇总最近 10 场 v4 报告的能力项（0–100）；还没有 v4 报告时退回旧报告的五个维度（1–5），不把两种分制混在一起
function abilityAverages(details: MockInterviewDetail[]): Abilities | null {
  const current = details.filter((item) => item.report?.verdict && item.report.competencies);
  if (current.length) {
    const pool = new Map<MockCompetencyKey, number[]>();
    for (const item of current) {
      for (const competency of item.report!.competencies!) {
        if (!competency.assessed || competency.score === null) continue;
        pool.set(competency.key, [...(pool.get(competency.key) ?? []), competency.score]);
      }
    }
    const rows = [...pool.entries()].map(([key, values]) => {
      const value = Math.round(average(values));
      return { key, label: DIMENSION_LABELS[key], value, ratio: value / 100, text: String(value) };
    });
    const weakest = rows.length ? rows.reduce((min, item) => (item.value < min.value ? item : min), rows[0]) : null;
    if (rows.length) return { legacy: false, samples: current.length, rows, weakKey: weakest && weakest.value < WEAK_COMPETENCY ? weakest.key : null };
  }
  const legacy = details.filter((item) => item.report && !item.report.verdict);
  const rows = LEGACY_DIMENSION_KEYS.flatMap((key) => {
    const values = legacy.flatMap((item) => item.report!.dimensions.filter((dimension) => dimension.key === key).map((dimension) => dimension.score));
    if (!values.length) return [];
    const value = average(values);
    return [{ key, label: DIMENSION_LABELS[key], value, ratio: Math.max(0, Math.min(1, (value - 1) / 4)), text: value.toFixed(1) }];
  });
  if (!rows.length) return null;
  const weakest = rows.reduce((min, item) => (item.value < min.value ? item : min), rows[0]);
  return { legacy: true, samples: legacy.length, rows, weakKey: weakest.value < WEAK_LEGACY_DIMENSION ? weakest.key : null };
}

function StatsCard({ completed, details, abandoned }: { completed: MockInterviewSummary[]; details: MockInterviewDetail[]; abandoned: number }) {
  useLocale();
  const ordered = useMemo(() => [...completed].sort((a, b) => finishedAt(a).localeCompare(finishedAt(b))), [completed]);
  const scopes = useMemo(() => {
    const seen = new Map<string, MockInterviewSummary>();
    for (const item of [...ordered].reverse()) if (!seen.has(scopeKey(item))) seen.set(scopeKey(item), item);
    return [...seen.entries()].map(([value, item]) => ({ value, label: typeDifficulty(item) }));
  }, [ordered]);
  const [scope, setScope] = useState(scopes[0]?.value ?? "");
  const current = scopes.some((item) => item.value === scope) ? scope : scopes[0]?.value ?? "";
  const trend = ordered.filter((item) => scopeKey(item) === current).slice(-TREND_LIMIT);
  const last = trend[trend.length - 1];
  const previous = trend[trend.length - 2];
  const delta = last && previous ? Math.round((last.total_score ?? 0) - (previous.total_score ?? 0)) : null;
  const hours = practiceHours(completed);
  const abilities = abilityAverages(details);

  return (
    <section className="mi-card mi-stats is-v4" aria-label={t("练习数据")}>
      <div className="mi-stat-col mi-trend">
        <div className="mi-stat-head">
          <h3>{t("得分变化")}</h3>
          {scopes.length > 1 ? (
            <div className="mi-trend-scope"><Select size="sm" label={t("比较的面试类型与难度")} value={current} options={scopes} onChange={setScope} /></div>
          ) : last ? <span className="mi-trend-scope-label">{typeDifficulty(last)}</span> : null}
        </div>
        {last && (
          <div className="mi-trend-kpi">
            <b>{Math.round(last.total_score ?? 0)}</b>
            {last.verdict && VERDICT_TONE[last.verdict] && <span className={`mi-grade ${VERDICT_TONE[last.verdict]}`}>{VERDICT_SHORT[last.verdict]}</span>}
            {delta !== null && delta !== 0 && <em className={delta > 0 ? "is-up" : "is-down"}>{t("比上一场 ")}{delta > 0 ? `↑${delta}` : `↓${-delta}`}</em>}
          </div>
        )}
        {trend.length > 0 && <TrendChart items={trend} />}
        {trend.length === 1 && <p className="mi-trend-single">{t("同类型、同难度再练 1 场后显示变化")}</p>}
        <div className="mi-overall-nums is-inline">
          <span><b>{completed.length}</b>{t("已完成")}</span>
          <span><b>{abandoned}</b>{t("已放弃")}</span>
          <span><b>{hours.toFixed(1)}h</b>{t("累计练习")}</span>
        </div>
      </div>
      <i className="mi-vdiv" aria-hidden="true" />
      <div className="mi-stat-col mi-ability-col">
        <div className="mi-stat-head">
          <h3>{t("能力表现")}</h3>
          {abilities && <small>{abilities.legacy ? t("旧版评分 · 1–5 分 · 最近 {value0} 场", { value0: abilities.samples }) : t("最近 {value0} 场平均", { value0: abilities.samples })}</small>}
        </div>
        {abilities ? (
          <ul className="mi-ability-list">
            {abilities.rows.map((item) => {
              const weak = item.key === abilities.weakKey;
              return (
                <li key={item.key} className={weak ? "is-weak" : ""}>
                  <span>{item.label}</span>
                  <i aria-hidden="true"><i style={{ width: `${item.ratio * 100}%` }} /></i>
                  <b>{item.text}</b>
                  {weak && <em className="mi-weak">{t("待加强")}</em>}
                </li>
              );
            })}
          </ul>
        ) : <p className="mi-stat-empty">{t("完成第一份评估报告后显示")}</p>}
      </div>
    </section>
  );
}

// 趋势列在统计卡里撑满剩余宽度，图表按实际宽度重新布点；背景按「有差距 / 接近 / 达到」分区
function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => { if (node.clientWidth > 0) setWidth(node.clientWidth); };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const TREND_LO = 30;
const TREND_HI = 90;
const ZONE_LABEL_WIDTH = 34;

function TrendChart({ items }: { items: MockInterviewSummary[] }) {
  useLocale();
  const [chartRef, width] = useElementWidth<HTMLDivElement>(400);
  const plot = Math.max(120, width - ZONE_LABEL_WIDTH);
  const clamp = (score: number) => Math.max(TREND_LO, Math.min(TREND_HI, score));
  const y = (score: number) => 8 + ((TREND_HI - clamp(score)) / (TREND_HI - TREND_LO)) * 112;
  // 只有一场时把点放在中间，图表结构与多场时保持一致
  const x = (index: number) => (items.length === 1 ? plot / 2 : 14 + (index * (plot - 28)) / (items.length - 1));
  const scores = items.map((item) => item.total_score ?? 0);
  const line = scores.map((score, index) => `${x(index)},${y(score)}`).join(" ");
  return (
    <div className="mi-trend-chart is-zoned" ref={chartRef}>
      <svg width={width} height="140" viewBox={`0 0 ${width} 140`} role="img" aria-label={t("得分变化：{value0}", { value0: scores.map((score) => Math.round(score)).join("、") })}>
        <rect x="0" y={y(TREND_HI)} width={plot} height={y(75) - y(TREND_HI)} fill="#f2f7f3" />
        <rect x="0" y={y(75)} width={plot} height={y(60) - y(75)} fill="#fcf6ee" />
        <line x1="0" x2={plot} y1="120" y2="120" stroke="var(--v3-line)" />
        <text x={plot + 6} y={(y(TREND_HI) + y(75)) / 2 + 4} className="is-good">{t("达到")}</text>
        <text x={plot + 6} y={(y(75) + y(60)) / 2 + 4} className="is-mid">{t("接近")}</text>
        <text x={plot + 6} y={(y(60) + 120) / 2 + 4}>{t("差距")}</text>
        <polyline points={line} fill="none" stroke="#bdbdb6" strokeWidth="1.5" />
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return <circle key={item.id} cx={x(index)} cy={y(scores[index])} r={isLast ? 5.5 : 4} className={`mi-trend-dot ${VERDICT_TONE[item.verdict ?? ""] ?? "is-none"}`} stroke="#fff" strokeWidth="2" />;
        })}
      </svg>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={item.id}>
            <b className={`mi-trend-score${isLast ? " is-last" : ""}`} style={{ left: x(index) - 8, top: y(scores[index]) - 20 }}>{Math.round(scores[index])}</b>
            <small className="mi-trend-date is-zoned" style={{ left: x(index) - 20 }}>{mmdd(finishedAt(item))}</small>
          </span>
        );
      })}
    </div>
  );
}

// 还没有完成场次：沿用统计卡的两栏结构，图表和能力条画成空态，避免首页在有无数据时换一套布局
const EMPTY_ABILITY_KEYS: MockCompetencyKey[] = ["knowledge", "problem_solving", "ownership", "communication", "job_fit"];

function StatsEmpty({ abandoned }: { abandoned: number }) {
  useLocale();
  return (
    <section className="mi-card mi-stats is-v4 is-empty" aria-label={t("练习数据")}>
      <div className="mi-stat-col mi-trend">
        <div className="mi-stat-head"><h3>{t("得分变化")}</h3><small>{t("完成第 1 场面试后生成")}</small></div>
        <div className="mi-trend-kpi"><b>—</b></div>
        <div className="mi-trend-chart is-zoned is-ghost" aria-hidden="true">
          <svg width="100%" height="140" preserveAspectRatio="none" viewBox="0 0 400 140">
            <rect x="0" y="8" width="366" height="28" fill="#f2f7f3" />
            <rect x="0" y="36" width="366" height="28" fill="#fcf6ee" />
            <line x1="0" x2="366" y1="120" y2="120" stroke="var(--v3-line)" />
            <polyline points="14,96 130,78 246,84 352,52" fill="none" stroke="#cfcfca" strokeDasharray="4 3" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="mi-overall-nums is-inline">
          <span><b>0</b>{t("已完成")}</span>
          <span><b>{abandoned}</b>{t("已放弃")}</span>
          <span><b>0.0h</b>{t("累计练习")}</span>
        </div>
      </div>
      <i className="mi-vdiv" aria-hidden="true" />
      <div className="mi-stat-col mi-ability-col">
        <div className="mi-stat-head"><h3>{t("能力表现")}</h3><small>{t("找出最需要加强的能力")}</small></div>
        <ul className="mi-ability-list is-ghost">
          {EMPTY_ABILITY_KEYS.map((key) => (
            <li key={key}><span>{DIMENSION_LABELS[key]}</span><i aria-hidden="true" /><b>—</b></li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function OtherJobs({ title, applications, interviews, failed }: { title: string; applications: JobApplicationSummary[]; interviews: MockInterviewSummary[]; failed: boolean }) {
  useLocale();
  const sorted = [...applications].sort((a, b) => (a.next_session_start_at ?? "9999").localeCompare(b.next_session_start_at ?? "9999")).slice(0, 3);
  const soon = (iso: string | null) => Boolean(iso && new Date(iso).getTime() - Date.now() < 14 * 86_400_000);
  return (
    <section className="mi-others" aria-label={title}>
      <div className="mi-section-head">
        <h2>{title}</h2>
        <i aria-hidden="true" />
        <span>{failed ? t("岗位看板暂时没有加载出来") : t("来自岗位看板 · {value0} 个", { value0: applications.length })}</span>
      </div>
      {sorted.length > 0 && (
        <div className="mi-jobs v3-stagger">
          {sorted.map((app) => (
            <article key={app.id} className="mi-job">
              <h3>{app.company_name_snapshot} · {app.job_title_snapshot}</h3>
              <p className="mi-job-stage">
                <i className={soon(app.next_session_start_at) ? "is-soon" : ""} aria-hidden="true" />
                {app.next_session_start_at ? `${mmdd(app.next_session_start_at)} ${app.current_stage_label}` : `${app.current_stage_label} · ${STAGE_STATE_LABELS[app.stage_state] ?? t("进行中")}`}
              </p>
              <p className="mi-job-practice">{appPractice(app.id, interviews)}</p>
              <button type="button" className="v3-btn v3-btn-ghost" onClick={() => navigateTo(newMockInterviewPath({ applicationId: app.id }))}>{t("针对这个岗位练习")}</button>
            </article>
          ))}
        </div>
      )}
      <div className="mi-general">
        <div>
          <strong>{t("没有具体岗位？做一场通用练习")}</strong>
          <small>{t("只根据你的简历出题，适合日常保持手感")}</small>
        </div>
        <button type="button" className="v3-btn v3-btn-ghost" onClick={() => navigateTo(`${newMockInterviewPath()}?general=1`)}>{t("开始通用练习")}</button>
      </div>
    </section>
  );
}

/* ───────────── 253:2 练习记录 ───────────── */

type StatusFilter = "all" | "completed" | "abandoned";
type SortKey = "latest" | "oldest" | "score";

function RecordsView({ interviews }: { interviews: MockInterviewSummary[] }) {
  useLocale();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [job, setJob] = useState<string>("all");
  const [type, setType] = useState<string>("all");
  const [sort, setSort] = useState<SortKey>("latest");
  // 切换状态 / 岗位 / 类型 / 排序时，列表行浮上淡入
  const listMotionRef = useContentMotion<HTMLDivElement>(`${status}:${job}:${type}:${sort}`, { initial: false });
  const done = interviews.filter((item) => item.status === "completed");
  const abandoned = interviews.filter((item) => item.status === "abandoned");
  const hours = practiceHours(done);

  const jobOptions = useMemo(() => {
    const titles = Array.from(new Set(interviews.map((item) => interviewTitle(item))));
    return [{ value: "all", label: t("岗位：全部") }, ...titles.map((title) => ({ value: title, label: title }))];
  }, [interviews, getLocale()]);
  const typeOptions = [{ value: "all", label: t("类型：全部") }, ...(Object.keys(INTERVIEW_TYPE_LABELS) as MockInterviewType[]).map((key) => ({ value: key, label: INTERVIEW_TYPE_LABELS[key] }))];

  const visible = interviews
    .filter((item) => status === "all" || item.status === status)
    .filter((item) => job === "all" || interviewTitle(item) === job)
    .filter((item) => type === "all" || item.interview_type === type)
    .sort((a, b) => sort === "score" ? (b.total_score ?? -1) - (a.total_score ?? -1) : sort === "oldest" ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at));

  // 与同一岗位上一场已完成的得分比较
  const delta = (item: MockInterviewSummary) => {
    if (item.status !== "completed" || item.total_score === null) return null;
    const previous = done.filter((other) => interviewTitle(other) === interviewTitle(item) && other.created_at < item.created_at).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return previous?.total_score != null ? Math.round(item.total_score - previous.total_score) : null;
  };
  const source = (item: MockInterviewSummary) => {
    if (item.repeat_of_id) {
      const origin = interviews.find((other) => other.id === item.repeat_of_id);
      return origin ? t("再练一次 · 来自 {value0} 场次", { value0: mmdd(origin.created_at) }) : t("再练一次");
    }
    if (item.source_type === "job_application") return t("来自求职记录{value0}", { value0: item.stage_label ? ` · ${item.stage_label}` : "" });
    return t("来自简历「{value0}」", { value0: item.resume_title });
  };
  const open = (item: MockInterviewSummary) => navigateTo(mockInterviewPath(item.id, item.status === "completed"));

  return (
    <div className="mi-page mi-records">
      <header className="mi-records-head">
        <PageEyebrow segments={[{ label: "MOCK INTERVIEW", href: "/mock-interviews", onClick: () => navigateTo("/mock-interviews"), ariaLabel: t("返回模拟面试") }, t("练习记录")]} />
        <div className="mi-records-title">
          <h1 className="v3-page-title">{t("练习记录")}</h1>
          <button type="button" className="v3-btn v3-btn-dark" onClick={() => navigateTo(newMockInterviewPath())}>{t("开始新面试")}</button>
        </div>
        <p>{t("共 ")}{interviews.length}{t(" 场 · 已完成 ")}{done.length}{t(" · 已放弃 ")}{abandoned.length}{t(" · 累计 ")}{hours.toFixed(1)}{t(" 小时")}</p>
      </header>
      <div className="mi-toolbar">
        <Segmented<StatusFilter>
          label={t("按状态筛选")}
          value={status}
          onChange={setStatus}
          options={[{ value: "all", label: t("全部 {value0}", { value0: interviews.length }) }, { value: "completed", label: t("已完成 {value0}", { value0: done.length }) }, { value: "abandoned", label: t("已放弃 {value0}", { value0: abandoned.length }) }]}
        />
        <div className="mi-toolbar-select is-job"><Select size="sm" label={t("按岗位筛选")} value={job} options={jobOptions} onChange={setJob} /></div>
        <div className="mi-toolbar-select"><Select size="sm" label={t("按类型筛选")} value={type} options={typeOptions} onChange={setType} /></div>
        <span className="mi-spacer" />
        <div className="mi-toolbar-select is-sort">
          <Select<SortKey> size="sm" label={t("排序")} value={sort} onChange={setSort} options={[{ value: "latest", label: t("按时间 · 最新") }, { value: "oldest", label: t("按时间 · 最早") }, { value: "score", label: t("按得分 · 最高") }]} />
        </div>
      </div>
      <div className="mi-list" role="table" aria-label={t("练习记录")}>
        <div className="mi-list-head" role="row">
          <span role="columnheader">{t("场次")}</span><span role="columnheader">{t("类型 · 难度")}</span><span role="columnheader">{t("题数")}</span><span role="columnheader">{t("得分")}</span><span role="columnheader">{t("状态")}</span><span role="columnheader">{t("时间")}</span>
        </div>
        <div ref={listMotionRef} className="mi-list-scroll" role="rowgroup">
        {visible.map((item, index) => {
          const change = delta(item);
          const score = item.total_score;
          return (
            <button key={item.id} type="button" role="row" className={`mi-list-row${index === 0 && sort === "latest" && status === "all" ? " is-latest" : ""}`} onClick={() => open(item)} aria-label={`${interviewTitle(item)}，${STATUS_LABELS[item.status]}`}>
              <span role="cell" className="mi-cell-title"><strong>{interviewTitle(item)}</strong><small>{source(item)}</small></span>
              <span role="cell">{typeDifficulty(item)}</span>
              <span role="cell">{item.question_count}{t(" 题")}</span>
              <span role="cell" className="mi-cell-score">
                {score !== null && item.status === "completed" ? (
                  <>
                    <b>{Math.round(score)}</b>
                    <i className="mi-mini-bar"><span className={score >= 80 ? "is-good" : score >= 70 ? "is-ok" : "is-mid"} style={{ width: `${Math.round(score)}%` }} /></i>
                    {change !== null && change !== 0 && <em className={change > 0 ? "is-up" : "is-down"}>{change > 0 ? `+${change}` : `−${-change}`}</em>}
                  </>
                ) : <span className="mi-dash">—</span>}
              </span>
              <span role="cell"><span className={`mi-status is-${item.status}`}>{STATUS_LABELS[item.status]}</span></span>
              <span role="cell" className="mi-cell-time">{dateTimeLabel(item.created_at)}</span>
            </button>
          );
        })}
        </div>
        <div className="mi-list-foot">
          {visible.length ? t("已显示全部 {value0} 场 · 点击任意一行查看评估报告", { value0: visible.length }) : t("没有符合条件的练习记录")}
        </div>
      </div>
    </div>
  );
}
