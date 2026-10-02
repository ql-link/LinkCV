import { t, useLocale, getLocale } from "@/i18n";
// 07.6 语音面试 · 评估报告（含语音表现）与 07.6a 单题详情 · 修正与重新评估。
// 修正、手动修改、重新评估、删除录音都走 mockInterviewApi（假数据）；录音回放需后端读取接口，先做占位。
import { useContentMotion } from "@/components/ui/motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { editorPath, mockInterviewPath, navigateTo } from "@/routing";
import { V3Shell } from "@/v3/Shell";
import { Icon } from "@/v3/Icon";
import { BeTag, ConfirmDialog, Dialog, Toast, PageEyebrow } from "@/v3/primitives";
import { SlideSwap } from "@/v3/SlideSwap";
import {
  DIFFICULTY_LABELS,
  DIMENSION_LABELS,
  INTERVIEW_TYPE_LABELS,
  changeRatio,
  mockInterviewApi,
  mockInterviewErrorMessage,
  type MockInterviewDetail,
  type MockInterviewQuestion,
  type MockInterviewReport,
  type MockQuestionEvaluation,
  type MockVoiceMetrics,
} from "../mockInterviewApi";
import { charCount, dateTimeLabel, groupQuestions, type QuestionGroup } from "../mockShared";
import { EXPECTED_DEPTH, FeatherMark, UserAvatar, formatClock } from "./voiceParts";
import "./voice.css";

type Tone = "good" | "mid" | "bad";
type ReportRow = { group: QuestionGroup; topic: string; evaluation: MockQuestionEvaluation | null };

function tone(score: number): Tone {
  if (score >= 75) return "good";
  if (score >= 60) return "mid";
  return "bad";
}

function grade(score: number) {
  if (score >= 85) return { label: t("优秀"), tone: "good" as Tone };
  if (score >= 70) return { label: t("良好"), tone: "good" as Tone };
  if (score >= 60) return { label: t("合格"), tone: "mid" as Tone };
  return { label: t("待提升"), tone: "bad" as Tone };
}

const VERDICT: Record<"hit" | "partial" | "miss", { label: string; cls: string }> = {
  hit: { get label() { return t("命中"); }, cls: "is-good" },
  partial: { get label() { return t("部分"); }, cls: "is-mid" },
  miss: { get label() { return t("未命中"); }, cls: "is-bad" },
};

function family(group: QuestionGroup) {
  return [group.root, ...group.follows];
}

function familyEdited(group: QuestionGroup) {
  return family(group).some((question) => question.transcript_state === "corrected" || question.transcript_state === "edited");
}

function familyDuration(group: QuestionGroup) {
  return family(group).reduce((sum, question) => sum + (question.audio_duration_ms ?? 0), 0);
}

/* ───────────── 页面 ───────────── */

export function VoiceReportPage({ interview, onChanged }: { interview: MockInterviewDetail; onChanged: () => void }) {
  useLocale();
  const [detail, setDetail] = useState(interview);
  const [filter, setFilter] = useState<"all" | "good" | "weak">("all");
  const listMotionRef = useContentMotion<HTMLUListElement>(filter, { initial: false });
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState<"correct" | "repeat" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [toast, setToast] = useState<{ title: string; message?: string; kind?: "error" | "success" } | null>(null);
  // 重新评估前后的总分（接口一次性返回，报告只保存逐题前后分）
  const [totals, setTotals] = useState<Record<string, { before: number; after: number }>>({});

  useEffect(() => { setDetail(interview); }, [interview]);

  const update = (next: MockInterviewDetail) => {
    setDetail(next);
    onChanged();
  };

  const report = detail.report;
  const groups = useMemo(() => groupQuestions(detail.questions), [detail.questions]);
  const rows: ReportRow[] = useMemo(() => groups.map((group) => {
    const item = report?.questions.find((entry) => entry.sequence_no === group.root.sequence_no);
    return { group, topic: item?.topic ?? group.root.content.slice(0, 12), evaluation: group.root.evaluation ?? item ?? null };
  }), [groups, report]);

  if (!report) {
    return (
      <V3Shell active="mock">
        <div className="v3-page">
          <PageEyebrow segments={[{ label: "MOCK INTERVIEW", href: "/mock-interviews", onClick: () => navigateTo("/mock-interviews"), ariaLabel: t("返回模拟面试") }, t("评估报告")]} />
          <h1 className="v3-page-title">{t("评估报告")}</h1>
          <p className="v3-page-sub">{detail.status === "evaluating" ? t("面试官正在整理评估报告，大约需要 1 分钟，完成后自动显示。") : t("这场面试还没有评估报告。")}</p>
        </div>
      </V3Shell>
    );
  }

  const score = Math.round(report.total_score);
  const answered = groups.filter((group) => group.root.answer_status === "answered").length;
  const followCount = groups.reduce((sum, group) => sum + group.follows.length, 0);
  const goodCount = rows.filter((row) => (row.evaluation?.score ?? 0) >= 75).length;
  const weakCount = rows.length - goodCount;
  const minutes = detail.started_at && detail.finished_at ? Math.max(1, Math.round((new Date(detail.finished_at).getTime() - new Date(detail.started_at).getTime()) / 60_000)) : null;
  const reevaluated = rows.filter((row) => row.group.root.re_evaluate_count > 0);
  const visible = rows.filter((row) => filter === "all" || (filter === "good" ? (row.evaluation?.score ?? 0) >= 75 : (row.evaluation?.score ?? 0) < 75));
  const expected = EXPECTED_DEPTH[detail.difficulty] ?? 3;
  const heading = [detail.company_name, detail.job_title].filter(Boolean).join(" · ") || detail.target_role || detail.resume_title;

  const correct = async () => {
    setBusy("correct");
    try {
      const result = await mockInterviewApi.correctTranscripts(detail.id);
      const changed = result.items.reduce((sum, item) => sum + item.changes.length, 0);
      update(result.mock_interview);
      setToast({ kind: "success", title: changed ? t("已修正 {value0} 处识别错误", { value0: changed }) : t("识别稿没有需要修正的地方"), message: changed ? t("修正后的题目可以重新评估，每道题最多 3 次。") : undefined });
    } catch (error) {
      setToast({ kind: "error", title: t("识别稿没有修正"), message: mockInterviewErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const repeat = async () => {
    setBusy("repeat");
    try {
      const { mock_interview } = await mockInterviewApi.repeat(detail.id);
      onChanged();
      navigateTo(mockInterviewPath(mock_interview.id));
    } catch (error) {
      setToast({ kind: "error", title: t("没有开始新的一场"), message: mockInterviewErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const removeRecordings = async () => {
    setBusy("delete");
    try {
      const { mock_interview } = await mockInterviewApi.deleteRecordings(detail.id);
      update(mock_interview);
      setConfirmDelete(false);
      setToast({ kind: "success", title: t("本场录音已删除"), message: t("识别文字和评估结果都已保留。") });
    } catch (error) {
      setToast({ kind: "error", title: t("录音没有删除"), message: mockInterviewErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const openRow = openIndex === null ? null : rows[openIndex] ?? null;

  return (
    <V3Shell active="mock">
      <div className="vr-page">
        <div className="vr-actions">
          <button type="button" className="v3-btn v3-btn-ghost" onClick={() => navigateTo(mockInterviewPath())}>{t("返回列表")}</button>
          <button type="button" className="v3-btn v3-btn-dark" disabled={busy === "repeat"} onClick={() => void repeat()}>{busy === "repeat" ? t("正在准备…") : t("再练一次")}</button>
        </div>

        <header className="vr-head">
          <PageEyebrow segments={[{ label: "MOCK INTERVIEW", href: "/mock-interviews", onClick: () => navigateTo("/mock-interviews"), ariaLabel: t("返回模拟面试") }, heading]} />
          <h1 className="v3-page-title">{t("评估报告")}</h1>
          <div className="vr-head-meta">
            <span className="vr-tag">{INTERVIEW_TYPE_LABELS[detail.interview_type]}</span>
            <span className="vr-tag">{DIFFICULTY_LABELS[detail.difficulty]}</span>
            <span className="vr-tag">{t("语音面试")}</span>
            <span className="vr-meta-text">
              {answered === groups.length ? t("{value0} 题全部作答", { value0: groups.length }) : t("{value0} / {value1} 题作答", { value0: answered, value1: groups.length })}
              {minutes ? t(" · 用时 {value0} 分钟", { value0: minutes }) : ""}
              {detail.started_at ? ` · ${dateTimeLabel(detail.started_at)}` : ""}
            </span>
          </div>
        </header>

        <Summary report={report} score={score} answered={answered} total={groups.length} followCount={followCount} goodCount={goodCount} weakCount={weakCount} />

        <Dimensions report={report} />

        {report.voice_metrics && <VoicePerformance metrics={report.voice_metrics} questionCount={Math.max(1, answered)} />}

        <section className="vr-section" aria-labelledby="vr-q-title">
          <div className="vr-q-head">
            <h2 id="vr-q-title" className="vr-h2">{t("逐题表现")}</h2>
            <span className="vr-h2-sub">{t("期望深度 L")}{expected}{t(" · 点击题目查看完整问答与分析")}</span>
            <div className="vr-filters" role="group" aria-label={t("筛选题目")}>
              {([["all", t("全部 {value0}", { value0: rows.length })], ["good", t("表现较好 {value0}", { value0: goodCount })], ["weak", t("待提升 {value0}", { value0: weakCount })]] as const).map(([key, label]) => (
                <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
              ))}
            </div>
            <span className="vx-spacer" />
            <span className="vr-q-note">{detail.transcript_corrected_at ? t("已于 {value0} 修正识别稿", { value0: dateTimeLabel(detail.transcript_corrected_at) }) : t("只修正错字、同音字、术语与数字，不改写内容")}</span>
            <button type="button" className="vr-btn-sm" disabled={busy === "correct" || Boolean(detail.transcript_corrected_at)} onClick={() => void correct()}>
              {busy === "correct" ? t("正在修正…") : detail.transcript_corrected_at ? t("已修正识别稿") : t("AI 修正识别稿")}
            </button>
          </div>
          <ul ref={listMotionRef} className="vr-qlist">
            {visible.map((row) => {
              const value = row.evaluation?.score ?? 0;
              const index = rows.indexOf(row);
              const edited = familyEdited(row.group);
              return (
                <li key={row.group.root.id}>
                  <button type="button" className={`vr-qrow${openIndex === index ? " is-open" : ""}`} onClick={() => setOpenIndex(index)}>
                    <span className="vr-qno">Q{row.group.index}</span>
                    <span className="vr-qtopic">{row.topic}</span>
                    {edited && <span className="vr-tag is-good">{row.group.root.re_evaluate_count ? t("已修正 · 已重新评估") : family(row.group).some((q) => q.transcript_state === "edited") ? t("已手动修改") : t("已修正")}</span>}
                    <span className="vr-qfollow">{row.group.follows.length ? t("{value0} 次追问", { value0: row.group.follows.length }) : t("无追问")}</span>
                    <span className="vr-tag">{t("深度 L")}{row.evaluation?.achieved_depth ?? 0}</span>
                    <span className={`vr-qscore is-${row.group.root.answer_status === "skipped" ? "bad" : tone(value)}`}>{row.group.root.answer_status === "skipped" ? t("跳过") : value}</span>
                    <span className="vr-qchev" aria-hidden="true">›</span>
                  </button>
                </li>
              );
            })}
            {!visible.length && <li className="vr-qempty">{t("没有符合条件的题目")}</li>}
          </ul>
        </section>

        {report.improvements.length > 0 && (
          <section className="vr-section" aria-labelledby="vr-imp-title">
            <div className="vr-section-head">
              <h2 id="vr-imp-title" className="vr-h2">{t("改进建议")}</h2>
              <span className="vr-h2-sub">{t("按重要程度排序 · ")}{report.improvements.length}{t(" 条")}</span>
            </div>
            <div className="vr-cards">
              {report.improvements.map((item, index) => (
                <article key={index} className="vr-imp">
                  <div className="vr-imp-title">
                    <span className={`vr-tag ${index < 2 ? "is-mid" : ""}`}>{index < 2 ? t("重要") : t("建议")}</span>
                    <strong>{item}</strong>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {(report.resume_risks.length > 0 || report.fact_check.items.some((item) => item.verdict === "conflict")) && (
          <section className="vr-section" aria-labelledby="vr-risk-title">
            <div className="vr-section-head">
              <h2 id="vr-risk-title" className="vr-h2">{t("简历风险")}</h2>
              <span className="vr-h2-sub">{t("被追问时可能站不住的内容 · ")}{report.resume_risks.length}{t(" 条")}</span>
              <span className="vx-spacer" />
              {detail.resume_id && <button type="button" className="vr-btn-sm is-plain" onClick={() => navigateTo(editorPath(detail.resume_id!))}>{t("打开简历")}</button>}
            </div>
            <div className="vr-cards">
              {report.resume_risks.map((item, index) => (
                <article key={index} className="vr-risk">
                  <p>{item}</p>
                </article>
              ))}
            </div>
          </section>
        )}

        <footer className="vr-foot">
          <p>{t("评分规则 ")}{report.rubric_version}{t(" · 分数由固定规则计算，模型只判断单条标准并给出原文依据")}{reevaluated.length ? t(" · 第 {value0} 题已按修正稿重新评估", { value0: reevaluated.map((row) => row.group.index).join("、") }) : ""}
          </p>
          <p>
            {detail.recordings_deleted ? t("本场录音已删除，识别文字与评估结果仍保留。") : (
              <button type="button" className="vr-danger-link" onClick={() => setConfirmDelete(true)}>{t("删除本场录音")}</button>
            )}
          </p>
        </footer>
      </div>

      {openRow && (
        <QuestionDetail
          interview={detail}
          row={openRow}
          total={rows.length}
          expected={expected}
          totalChange={totals[openRow.group.root.id]}
          onPrev={openIndex! > 0 ? () => setOpenIndex(openIndex! - 1) : undefined}
          onNext={openIndex! < rows.length - 1 ? () => setOpenIndex(openIndex! + 1) : undefined}
          onClose={() => setOpenIndex(null)}
          onUpdated={update}
          onReEvaluated={(questionId, before, after) => setTotals((old) => ({ ...old, [questionId]: { before: old[questionId]?.before ?? before, after } }))}
          onError={(title, error) => setToast({ kind: "error", title, message: mockInterviewErrorMessage(error) })}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t("删除本场录音？")}
          description={t("删除后不能再回放录音，也不能再手动修改识别稿；识别文字、评估结果和报告都会保留。此操作不可撤销。")}
          confirmLabel={t("删除录音")}
          busyLabel={t("正在删除…")}
          busy={busy === "delete"}
          onConfirm={() => void removeRecordings()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {toast && <Toast kind={toast.kind ?? "info"} title={toast.title} message={toast.message} onDismiss={() => setToast(null)} />}
    </V3Shell>
  );
}

/* ───────────── 总分 ───────────── */

function Summary({ report, score, answered, total, followCount, goodCount, weakCount }: { report: MockInterviewReport; score: number; answered: number; total: number; followCount: number; goodCount: number; weakCount: number }) {
  useLocale();
  const g = grade(score);
  return (
    <section className="vr-summary" aria-label={t("总分")}>
      <div className="vr-score">
        <div className="vr-score-top"><span>{t("总分")}</span><span className={`vr-tag is-${g.tone}`}>{g.label}</span></div>
        <div className="vr-score-num"><strong>{score}</strong><span>/ 100</span></div>
        <small>{t("题目 ")}{report.question_average.toFixed(1)}{t(" × 70% + 维度 ")}{report.dimension_score.toFixed(1)} × 30%</small>
      </div>
      <span className="vr-summary-rule" aria-hidden="true" />
      <div className="vr-summary-copy">
        <h2>{report.headline}</h2>
        <p>{report.summary}</p>
        <div className="vr-stats">
          <span>{t("作答")}<b>{answered} / {total}{t(" 题")}</b></span>
          <span>{t("追问")}<b>{followCount}{t(" 次")}</b></span>
          <span>{t("表现较好")}<b>{goodCount}{t(" 题")}</b></span>
          <span>{t("待提升")}<b>{weakCount}{t(" 题")}</b></span>
        </div>
      </div>
      {report.low_confidence && <p className="vr-low">{t("作答题数较少，本次评分仅供参考。")}</p>}
    </section>
  );
}

/* ───────────── 能力维度 ───────────── */

function Radar({ items }: { items: Array<{ label: string; score: number; weak: boolean }> }) {
  useLocale();
  const cx = 120;
  const cy = 118;
  const radius = 76;
  const count = Math.max(3, items.length);
  const point = (index: number, ratio: number) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    return [cx + Math.cos(angle) * radius * ratio, cy + Math.sin(angle) * radius * ratio] as const;
  };
  const ring = (ratio: number) => Array.from({ length: count }, (_, index) => point(index, ratio).join(",")).join(" ");
  return (
    <div className="vr-radar" aria-hidden="true">
      <svg width="240" height="230" viewBox="0 0 240 230">
        {[1, 0.8, 0.6, 0.4, 0.2].map((ratio) => <polygon key={ratio} points={ring(ratio)} fill="none" stroke="#ececea" />)}
        {Array.from({ length: count }, (_, index) => { const [x, y] = point(index, 1); return <line key={index} x1={cx} y1={cy} x2={x} y2={y} stroke="#ececea" />; })}
        <polygon points={items.map((item, index) => point(index, Math.max(0.05, item.score / 5)).join(",")).join(" ")} fill="rgb(29 29 27 / 8%)" stroke="#1d1d1b" />
        {items.map((item, index) => { const [x, y] = point(index, Math.max(0.05, item.score / 5)); return <circle key={item.label} cx={x} cy={y} r="3" fill={item.weak ? "#d9822b" : "#1d1d1b"} />; })}
      </svg>
      {items.map((item, index) => {
        const [x, y] = point(index, 1.2);
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
        const align = Math.abs(Math.cos(angle)) < 0.2 ? "center" : Math.cos(angle) > 0 ? "left" : "right";
        return (
          <span key={item.label} className={`vr-radar-label is-${align}${item.weak ? " is-weak" : ""}`} style={{ left: x, top: y }}>
            {item.label} {item.score}
          </span>
        );
      })}
    </div>
  );
}

function Dimensions({ report }: { report: MockInterviewReport }) {
  useLocale();
  const min = Math.min(...report.dimensions.map((item) => item.score));
  const items = report.dimensions.map((item) => ({ label: DIMENSION_LABELS[item.key], score: item.score, weak: item.score === min && item.score < 4 }));
  return (
    <section className="vr-section" aria-labelledby="vr-dim-title">
      <div className="vr-section-head">
        <h2 id="vr-dim-title" className="vr-h2">{t("能力维度")}</h2>
        <span className="vr-h2-sub">{t("1–5 分 · 权重随面试类型变化")}</span>
      </div>
      <div className="vr-dims">
        <Radar items={items} />
        <ul className="vr-dim-list">
          {report.dimensions.map((item, index) => (
            <li key={item.key}>
              <div className="vr-dim-row">
                <strong>{DIMENSION_LABELS[item.key]}</strong>
                <span className="vr-dim-track"><i className={items[index].weak ? "is-weak" : ""} style={{ width: `${(item.score / 5) * 100}%` }} /></span>
                <b className={items[index].weak ? "is-weak" : ""}>{item.score} / 5</b>
                <small>{t("权重 ")}{Math.round(item.weight * 100)}%</small>
              </div>
              <p>{item.comment}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ───────────── 语音表现 ───────────── */

type MetricSpec = { key: string; label: string; value: string; unit: string; tag: string; warn: boolean; ref: string; range: [number, number]; point: number; max: number };

export function voiceMetricSpecs(metrics: MockVoiceMetrics, questionCount: number): MetricSpec[] {
  const speedRef = metrics.reference.chars_per_minute ?? [180, 240];
  const pauseRef = metrics.reference.long_pauses ?? [0, 3];
  const fillerRef = metrics.reference.filler_ratio ?? [0, 0.05];
  const perQuestion = metrics.answer_duration_ms / questionCount;
  const durationRef: [number, number] = [90_000, 180_000];
  const speed = metrics.chars_per_minute;
  return [
    { key: "speed", label: t("语速"), value: String(Math.round(speed)), unit: t("字/分钟"), tag: speed > speedRef[1] ? t("偏快") : speed < speedRef[0] ? t("偏慢") : t("正常"), warn: speed > speedRef[1] || speed < speedRef[0], ref: t("参考 {value0}–{value1}", { value0: speedRef[0], value1: speedRef[1] }), range: speedRef, point: speed, max: speedRef[1] * 1.4 },
    { key: "pause", label: t("长停顿"), value: String(metrics.long_pauses), unit: t("次 · 超过 3 秒"), tag: metrics.long_pauses > pauseRef[1] ? t("略多") : t("正常"), warn: metrics.long_pauses > pauseRef[1], ref: t("参考 ≤ {value0} 次", { value0: pauseRef[1] }), range: pauseRef, point: metrics.long_pauses, max: Math.max(pauseRef[1] * 2.4, metrics.long_pauses * 1.2) },
    { key: "filler", label: t("口头禅"), value: (metrics.filler_ratio * 100).toFixed(1), unit: "%", tag: metrics.filler_ratio > fillerRef[1] ? t("偏多") : t("正常"), warn: metrics.filler_ratio > fillerRef[1], ref: t("参考 ≤ {value0}%", { value0: Math.round(fillerRef[1] * 100) }), range: fillerRef, point: metrics.filler_ratio, max: Math.max(fillerRef[1] * 2, metrics.filler_ratio * 1.2) },
    { key: "duration", label: t("作答时长"), value: formatClock(perQuestion), unit: t("平均每题"), tag: perQuestion > durationRef[1] ? t("偏长") : perQuestion < durationRef[0] ? t("偏短") : t("正常"), warn: perQuestion > durationRef[1] || perQuestion < durationRef[0], ref: t("参考 1:30–3:00"), range: durationRef, point: perQuestion, max: 360_000 },
  ];
}

function VoicePerformance({ metrics, questionCount }: { metrics: MockVoiceMetrics; questionCount: number }) {
  useLocale();
  const specs = voiceMetricSpecs(metrics, questionCount);
  return (
    <section className="vr-section" aria-labelledby="vr-voice-title">
      <div className="vr-section-head">
        <h2 id="vr-voice-title" className="vr-h2">{t("语音表现")}</h2>
        <span className="vr-h2-sub">{t("根据识别时间戳计算，不单独计分，作为「沟通表现」的依据")}</span>
      </div>
      <div className="vr-metrics">
        {specs.map((spec) => {
          const pct = (value: number) => `${Math.max(0, Math.min(100, (value / spec.max) * 100))}%`;
          return (
            <article key={spec.key} className="vr-metric" aria-label={`${spec.label} ${spec.value}${spec.unit}，${spec.tag}`}>
              <div className="vr-metric-top"><span>{spec.label}</span><span className={`vr-tag ${spec.warn ? "is-mid" : "is-good"}`}>{spec.tag}</span></div>
              <div className="vr-metric-num"><strong>{spec.value}</strong><span>{spec.unit}</span></div>
              <div className="vr-range" aria-hidden="true">
                <i className="vr-range-ok" style={{ left: pct(spec.range[0]), width: `calc(${pct(spec.range[1])} - ${pct(spec.range[0])})` }} />
                <b className={spec.warn ? "is-warn" : ""} style={{ left: pct(spec.point) }} />
              </div>
              <small>{spec.ref}</small>
            </article>
          );
        })}
      </div>
      {metrics.tip && (
        <div className="vr-tip"><strong>{t("建议")}</strong><p>{metrics.tip}</p></div>
      )}
    </section>
  );
}

/* ───────────── 07.6a 单题详情 ───────────── */

function RecordingPlayer({ durationMs, deleted }: { durationMs: number | null; deleted: boolean }) {
  useLocale();
  if (deleted) return <span className="vr-player is-deleted">{t("录音已删除")}</span>;
  const bars = [4, 7, 11, 8, 14, 10, 5, 12, 15, 7, 4, 9, 13, 6, 3, 8, 12, 6, 10, 14, 5, 7, 11, 4, 6, 9, 12, 5, 8, 10, 4, 7, 11, 6, 9, 13, 5, 8, 4, 6];
  return (
    <span className="vr-player">
      <button type="button" className="vr-player-play" disabled aria-label={t("播放录音（需后端）")}><Icon name="play" size={9} /></button>
      <span className="vr-player-wave" aria-hidden="true">{bars.map((height, index) => <i key={index} style={{ height }} />)}</span>
      <span className="vr-player-time">{formatClock(durationMs ?? 0)}</span>
      <span className="vr-player-rate">1×</span>
      <BeTag title={t("录音回放需要后端读取接口（GET /api/mock-interviews/:id/questions/:qid/recording）")} />
    </span>
  );
}

function AnswerBlock({ interview, question, onUpdated, onError }: { interview: MockInterviewDetail; question: MockInterviewQuestion; onUpdated: (next: MockInterviewDetail) => void; onError: (title: string, error: unknown) => void }) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const text = question.answer_text ?? "";
  const long = charCount(text) > 120;
  const raw = question.raw_transcript;
  const ratio = editing && raw ? changeRatio(raw, draft) : 0;
  const changes = question.correction?.changes ?? [];
  const canEdit = Boolean(raw) && !interview.recordings_deleted;

  const save = async () => {
    setSaving(true);
    try {
      const { mock_interview } = await mockInterviewApi.editTranscript(interview.id, question.id, draft);
      onUpdated(mock_interview);
      setEditing(false);
    } catch (error) {
      onError(t("识别稿没有保存"), error);
    } finally {
      setSaving(false);
    }
  };

  if (question.answer_status === "skipped") {
    return <div className="vr-answer is-skipped">{t("本题已跳过")}</div>;
  }

  return (
    <div className="vr-answer">
      <UserAvatar size={22} fontSize={11} className="vr-answer-avatar" />
      <div className="vr-answer-main">
        <div className="vr-answer-meta">
          <span>{t("你的回答")}</span>
          <span className="vx-num">{charCount(text)}{t(" 字")}{question.audio_duration_ms ? t(" · 语音 {value0}", { value0: formatClock(question.audio_duration_ms) }) : ""}</span>
          {question.transcript_state === "corrected" && <span className="vr-tag is-good">{t("AI 已修正 ")}{changes.length}{t(" 处")}</span>}
          {question.transcript_state === "edited" && <span className="vr-tag is-good">{t("已手动修改")}</span>}
          {question.transcript_state === "correction_rejected" && <span className="vr-tag">{t("修正未通过 · 保留原稿")}</span>}
        </div>
        {editing ? (
          <div className="vr-edit">
            <textarea className="v3-textarea" aria-label={t("修改识别稿")} value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} />
            <div className="vr-edit-foot">
              <span className={ratio > 0.15 ? "is-bad" : ""}>{t("改动 ")}{Math.round(ratio * 100)}{t("% / 最多 15% · 只修正错字和术语，不能改写内容")}</span>
              <span className="vx-spacer" />
              <button type="button" className="vr-btn-sm is-plain" disabled={saving} onClick={() => setEditing(false)}>{t("取消")}</button>
              <button type="button" className="vr-btn-sm" disabled={saving || ratio > 0.15 || !draft.trim() || draft.trim() === text.trim()} onClick={() => void save()}>{saving ? t("正在保存…") : t("保存修改")}</button>
            </div>
          </div>
        ) : (
          <>
            <p className={`vr-answer-text${long && !expanded ? " is-clamped" : ""}`}>{text}</p>
            {long && <button type="button" className="vr-link" onClick={() => setExpanded((value) => !value)}>{expanded ? t("收起") : t("展开全文")} <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button>}
          </>
        )}
        {changes.length > 0 && !editing && (
          <div className="vr-corrections">
            <div className="vr-corrections-head">{t("AI 修正记录")}{interview.transcript_corrected_at ? ` · ${dateTimeLabel(interview.transcript_corrected_at)}` : ""}{t(" · 已自动应用")}</div>
            <ul>
              {changes.map((change, index) => (
                <li key={index}>
                  <span className="is-from">{change.original}</span>
                  <span className="is-arrow">→</span>
                  <span className="is-to">{change.corrected}</span>
                  <small>{change.reason}</small>
                </li>
              ))}
            </ul>
          </div>
        )}
        {showRaw && raw && !editing && <p className="vr-raw"><span>{t("原始识别稿")}</span>{raw}</p>}
        {question.answer_source === "voice" && (
          <div className="vr-answer-tools">
            <RecordingPlayer durationMs={question.audio_duration_ms} deleted={interview.recordings_deleted || !question.has_recording} />
            {canEdit && !editing && <button type="button" className="vr-btn-sm is-plain" onClick={() => { setDraft(text); setEditing(true); }}>{t("手动修改")}</button>}
            {raw && raw !== text && !editing && <button type="button" className="vr-link is-faint" onClick={() => setShowRaw((value) => !value)}>{showRaw ? t("收起原始识别稿") : t("查看原始识别稿")}</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionDetail({
  interview,
  row,
  total,
  expected,
  totalChange,
  onPrev,
  onNext,
  onClose,
  onUpdated,
  onReEvaluated,
  onError,
}: {
  interview: MockInterviewDetail;
  row: ReportRow;
  total: number;
  expected: number;
  totalChange?: { before: number; after: number };
  onPrev?: () => void;
  onNext?: () => void;
  onClose: () => void;
  onUpdated: (next: MockInterviewDetail) => void;
  onReEvaluated: (questionId: string, before: number, after: number) => void;
  onError: (title: string, error: unknown) => void;
}) {
  useLocale();
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [allOpen, setAllOpen] = useState(true);
  const { group } = row;
  const root = group.root;
  const evaluation = row.evaluation;
  const score = evaluation?.score ?? 0;
  const history = root.evaluation_history ?? [];
  const firstScore = history[0]?.score;
  const edited = familyEdited(group);
  const remaining = 3 - root.re_evaluate_count;
  const duration = familyDuration(group);
  const mine = interview.report?.re_evaluations?.filter((entry) => entry.question_id === root.id) ?? [];
  const lastAt = mine.length ? mine[mine.length - 1].at : undefined;
  const conflicts = interview.report?.fact_check.items.filter((item) => item.verdict === "conflict") ?? [];

  const reEvaluate = async () => {
    setBusy(true);
    try {
      const result = await mockInterviewApi.reEvaluate(interview.id, root.id);
      onReEvaluated(root.id, result.previous_total_score, result.total_score);
      onUpdated(result.mock_interview);
    } catch (error) {
      onError(t("没有重新评估"), error);
    } finally {
      setBusy(false);
    }
  };

  const rounds = family(group);
  // 上一题 / 下一题：题目内容左右翻页滑动（下一题从右侧进来），换题后回到顶部
  const previousIndex = useRef(group.index);
  const direction: 1 | -1 = group.index >= previousIndex.current ? 1 : -1;
  useEffect(() => { previousIndex.current = group.index; }, [group.index]);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [group.index]);

  return (
    <Dialog width={820} label={t("第 {value0} 题详情", { value0: group.index })} onClose={onClose} className="vr-detail" closable>
      <div className="vr-detail-head">
        <div className="vr-detail-title">
          <SlideSwap itemKey={String(group.index)} direction={direction} distance={16}>
            <div>
              <p>{t("第 ")}{group.index}{t(" 题 / 共 ")}{total}{t(" 题")}</p>
              <h2>{row.topic}</h2>
            </div>
          </SlideSwap>
          <div className="vr-detail-nav">
            <button type="button" className="vr-btn-sm is-plain" disabled={!onPrev} onClick={onPrev}>{t("‹ 上一题")}</button>
            <button type="button" className="vr-btn-sm is-plain" disabled={!onNext} onClick={onNext}>{t("下一题 ›")}</button>
          </div>
        </div>
        <div className="vr-detail-meta">
          <span className={`vr-detail-score is-${tone(score)}`}><strong>{root.answer_status === "skipped" ? "—" : score}</strong><span>/ 100</span></span>
          {firstScore !== undefined && <span className="vr-tag is-good">{t("修正前 ")}{firstScore} → {score}</span>}
          <span className="vr-tag">{t("深度 L")}{evaluation?.achieved_depth ?? 0}{t(" · 期望 L")}{expected}</span>
          <span className="vr-tag">{group.follows.length ? t("{value0} 次追问", { value0: group.follows.length }) : t("无追问")}</span>
          {conflicts.length > 0 && <span className="vr-tag is-mid">{conflicts.length}{t(" 处资料冲突")}</span>}
        </div>
      </div>
      <div ref={bodyRef} className="vr-detail-body">
        <SlideSwap itemKey={String(group.index)} direction={direction} distance={48}>
        <div>
        {root.answer_status !== "skipped" && (
          <div className="vr-reeval">
            {root.re_evaluate_count > 0 ? (
              <>
                <div className="vr-reeval-top">
                  <div>
                    <strong>{t("已按修正稿重新评估")}</strong>
                    <small>{lastAt ? `${dateTimeLabel(lastAt)} · ` : ""}{t("本题剩余 ")}{remaining}{t(" 次重新评估机会 · 维度与总结未重新生成")}</small>
                  </div>
                  <span className="vx-spacer" />
                  <button type="button" className="vr-btn-sm is-plain" onClick={() => setHistoryOpen((value) => !value)}>{historyOpen ? t("收起修正前评估") : t("查看修正前评估")}</button>
                  {edited && remaining > 0 && <button type="button" className="vr-btn-sm" disabled={busy} onClick={() => void reEvaluate()}>{busy ? t("正在评估…") : t("再次评估")}</button>}
                </div>
                <div className="vr-reeval-diff">
                  <span>{t("本题得分 ")}<s>{firstScore ?? score}</s> → <b>{score}</b></span>
                  {totalChange && <span>{t("总分 ")}<s>{totalChange.before.toFixed(1)}</s> → <b>{totalChange.after.toFixed(1)}</b></span>}
                </div>
                {historyOpen && (
                  <ul className="vr-history">
                    {history.map((entry, index) => <li key={index}>{t("第 ")}{index + 1}{t(" 次评估 · ")}{dateTimeLabel(entry.evaluated_at)} · {entry.score}{t(" 分")}</li>)}
                  </ul>
                )}
              </>
            ) : (
              <div className="vr-reeval-top">
                <div>
                  <strong>{edited ? t("识别稿已修正，可以重新评估") : t("识别稿修正后可以重新评估")}</strong>
                  <small>{edited ? t("只重新给本题打分并复算总分，维度与总结不重新生成 · 每道题最多 3 次") : interview.transcript_corrected_at ? t("本题没有需要修正的地方；如仍有错字，可在下方手动修改（最多改动 15%）。") : t("先在报告里点「AI 修正识别稿」，或在下方手动修改错字。")}</small>
                </div>
                <span className="vx-spacer" />
                <button type="button" className="vr-btn-sm" disabled={!edited || busy} onClick={() => void reEvaluate()}>{busy ? t("正在评估…") : t("重新评估")}</button>
              </div>
            )}
          </div>
        )}

        <section className="vr-transcript" aria-label={t("问答记录")}>
          <div className="vr-sub-head">
            <h3>{t("问答记录")}</h3>
            <span>{t("1 道主问题")}{group.follows.length ? t(" · {value0} 次追问", { value0: group.follows.length }) : ""}{duration ? t(" · 语音作答 {value0}", { value0: formatClock(duration) }) : ""}</span>
            <span className="vx-spacer" />
            <button type="button" className="vr-link" onClick={() => setAllOpen((value) => !value)}>{allOpen ? t("只看问题") : t("全部展开")}</button>
          </div>
          {rounds.map((question, index) => (
            <div key={question.id} className="vr-round">
              <div className="vr-rail" aria-hidden="true"><i className={index === 0 ? "is-main" : ""} />{index < rounds.length - 1 && <b />}</div>
              <div className="vr-round-body">
                <div className="vr-round-label"><strong>{index === 0 ? t("主问题") : t("追问 {value0}", { value0: index })}</strong><span>{t("考察深度 L")}{question.depth_level}</span></div>
                <div className="vr-round-q">
                  <FeatherMark size={24} />
                  <div><span>{t("面试官")}</span><p>{question.content}</p></div>
                </div>
                {allOpen && <AnswerBlock interview={interview} question={question} onUpdated={onUpdated} onError={onError} />}
              </div>
            </div>
          ))}
        </section>

        {evaluation && !evaluation.skipped && (
          <section className="vr-analysis" aria-label={t("详细分析")}>
            <div className="vr-sub-head">
              <h3>{t("详细分析")}</h3>
              <span>{t("基于整道题（含追问）的回答评估")}</span>
            </div>
            <div className="vr-signals">
              {evaluation.signals.map((signal) => (
                <div key={signal.signal} className="vr-signal">
                  <span className={`vr-tag ${VERDICT[signal.verdict].cls}`}>{VERDICT[signal.verdict].label}</span>
                  <div>
                    <strong>{signal.signal}</strong>
                    <small>{signal.evidence ? `“${signal.evidence}”` : t("回答中未涉及")}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="vr-hw">
              <div>
                <strong>{t("亮点")}</strong>
                {evaluation.highlights.length ? evaluation.highlights.map((item) => <p key={item}><i className="is-good" />{item}</p>) : <p className="is-empty">{t("暂无")}</p>}
              </div>
              <div>
                <strong>{t("待改进")}</strong>
                {evaluation.weaknesses.length ? evaluation.weaknesses.map((item) => <p key={item}><i className="is-mid" />{item}</p>) : <p className="is-empty">{t("暂无")}</p>}
              </div>
            </div>
            {conflicts.map((item) => (
              <div key={item.claim} className="vr-material">
                <div><strong>{t("资料核验 · 冲突")}</strong><span>{item.file_name}</span></div>
                <p>{t("你提到「")}{item.claim}{t("」，资料原文：「")}{item.quote}」。</p>
              </div>
            ))}
            {evaluation.reference_answer && (
              <div className="vr-reference">
                <strong>{t("参考思路")}</strong>
                <p>{evaluation.reference_answer}</p>
              </div>
            )}
          </section>
        )}
        </div>
        </SlideSwap>
      </div>
    </Dialog>
  );
}
