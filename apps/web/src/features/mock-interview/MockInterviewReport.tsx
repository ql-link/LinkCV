import { t, useLocale, getLocale } from "@/i18n";
// 07.3 模拟面试 · 评估报告（Figma 182:2）与 07.3a 单题详情弹窗（184:7）。数据来自 mockInterviewApi（/api/mock-interviews）。
import { useContentMotion } from "@/components/ui/motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { navigateTo, mockInterviewPath, editorPath } from "@/routing";
import { Dialog, Toast, PageEyebrow } from "@/v3/primitives";
import { SlideSwap } from "@/v3/SlideSwap";
import { useResumeStore } from "@/store/resumeStore";
import {
  DIFFICULTY_LABELS,
  DIMENSION_LABELS,
  INTERVIEW_TYPE_LABELS,
  mockInterviewApi,
  mockInterviewErrorMessage,
  type MockFactCheckItem,
  type MockInterviewDetail,
  type MockInterviewReport,
  type MockSignalVerdict,
} from "./mockInterviewApi";
import { InterviewerMark, RadarChart, charCount, dateTimeLabel, groupQuestions, interviewTitle, scoreGrade, scoreTone, type QuestionGroup } from "./mockShared";

const EXPECTED_DEPTH: Record<string, number> = { junior: 2, intermediate: 3, senior: 4 };
const GOOD_SCORE = 75;

type ReportQuestion = MockInterviewReport["questions"][number];
type Row = { group: QuestionGroup; evaluation: ReportQuestion; conflicts: MockFactCheckItem[] };

const FACT_LABELS: Record<MockFactCheckItem["verdict"], string> = { get consistent() { return t("一致"); }, get conflict() { return t("冲突"); }, get material_stronger() { return t("资料更强"); }, get unsupported() { return t("无据可查"); } };

export function MockInterviewReportView({ interview }: { interview: MockInterviewDetail }) {
  useLocale();
  const report = interview.report;
  const [filter, setFilter] = useState<"all" | "good" | "weak">("all");
  const listMotionRef = useContentMotion<HTMLDivElement>(filter, { initial: false });
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const rows = useMemo<Row[]>(() => {
    if (!report) return [];
    const groups = groupQuestions(interview.questions);
    return groups.map((group, index) => {
      const evaluation = report.questions.find((item) => item.sequence_no === group.root.sequence_no) ?? report.questions[index];
      const conflicts = report.fact_check.items.filter((item) => item.verdict === "conflict" && [group.root, ...group.follows].some((question) => question.answer_text?.includes(item.claim.slice(0, 6))));
      return { group, evaluation, conflicts };
    }).filter((row) => row.evaluation);
  }, [interview.questions, report]);

  if (!report) {
    return (
      <div className="mi-page mi-report">
        <PageEyebrow segments={[{ label: "MOCK INTERVIEW", href: "/mock-interviews", onClick: () => navigateTo("/mock-interviews"), ariaLabel: t("返回模拟面试") }, t("评估报告")]} />
        <h1 className="mi-serif-title">{t("评估报告")}</h1>
        <p className="mi-report-missing">{t("这场模拟面试还没有评估报告。")}<button type="button" className="mi-inline-link" onClick={() => navigateTo(mockInterviewPath(interview.id))}>{t("查看场次")}</button></p>
      </div>
    );
  }

  const expected = EXPECTED_DEPTH[interview.difficulty] ?? 3;
  // 自我介绍只给反馈，不计入题量与得分统计
  const scoredRows = rows.filter((row) => !row.evaluation.is_intro);
  const answered = scoredRows.filter((row) => !row.evaluation.skipped).length;
  // 分母用配置的主问题数：提前结束时未出的题也算「未作答」
  const total = Math.max(interview.question_count, scoredRows.length);
  const followCount = rows.reduce((sum, row) => sum + row.group.follows.length, 0);
  const good = scoredRows.filter((row) => row.evaluation.score >= GOOD_SCORE);
  const weak = scoredRows.filter((row) => row.evaluation.score < GOOD_SCORE);
  const visible = filter === "good" ? good : filter === "weak" ? weak : rows;
  const minutes = interview.started_at && interview.finished_at ? Math.max(1, Math.round((new Date(interview.finished_at).getTime() - new Date(interview.started_at).getTime()) / 60_000)) : null;
  const dims = report.dimensions;
  const weakDim = dims.length ? dims.reduce((min, item) => (item.score < min.score ? item : min), dims[0]) : null;
  const improvements = improvementCards(report, rows, weakDim?.key);
  const risks = riskCards(report, rows);

  const repeat = async () => {
    setBusy(true);
    try {
      const { mock_interview } = await mockInterviewApi.repeat(interview.id);
      navigateTo(mockInterviewPath(mock_interview.id));
    } catch (reason) {
      setToast(mockInterviewErrorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <div className="mi-page mi-report">
      <div className="mi-report-actions">
        <button type="button" className="v3-btn v3-btn-ghost" onClick={() => navigateTo("/mock-interviews?view=records")}>{t("返回列表")}</button>
        <button type="button" className="v3-btn v3-btn-dark" disabled={busy} onClick={repeat}>{busy ? t("正在创建…") : t("再练一次")}</button>
      </div>
      <header className="mi-report-head">
        <PageEyebrow segments={[{ label: "MOCK INTERVIEW", href: "/mock-interviews", onClick: () => navigateTo("/mock-interviews"), ariaLabel: t("返回模拟面试") }, interviewTitle(interview)]} />
        <h1 className="mi-serif-title">{t("评估报告")}</h1>
        <div className="mi-report-meta">
          <span className="mi-tag-sq">{INTERVIEW_TYPE_LABELS[interview.interview_type]}</span>
          <span className="mi-tag-sq">{DIFFICULTY_LABELS[interview.difficulty]}</span>
          <span>{answered >= total ? t("{value0} 题全部作答", { value0: total }) : t("作答 {value0} / {value1} 题", { value0: answered, value1: total })}{minutes ? t(" · 用时 {value0} 分钟", { value0: minutes }) : ""} · {dateTimeLabel(interview.finished_at ?? interview.created_at)}</span>
        </div>
      </header>

      {report.low_confidence && (
        <div className="mi-low-confidence" role="note">{t("作答不足 2 道主问题或跳过超过一半，本报告仅供参考。")}</div>
      )}

      <section className="mi-summary" aria-label={t("总分")}>
        <div className="mi-total">
          <div className="mi-total-label">{t("总分")}<span className={`mi-grade ${scoreTone(report.total_score)}`}>{scoreGrade(report.total_score)}</span></div>
          <div className="mi-total-num"><b>{Math.round(report.total_score)}</b><small>/ 100</small></div>
          <p>{report.verdict ? t("总分为逐题平均分 · 评分规则 v4") : <>{t("题目 ")}{report.question_average.toFixed(1)}{t(" × 70% + 维度 ")}{report.dimension_score.toFixed(1)} × 30%</>}</p>
        </div>
        <i className="mi-summary-div" aria-hidden="true" />
        <div className="mi-summary-copy">
          <h2>{report.headline}</h2>
          <p>{report.summary}</p>
          <div className="mi-summary-stats">
            <span>{t("作答")}<b>{answered} / {total}{t(" 题")}</b></span>
            <span>{t("追问")}<b>{followCount}{t(" 次")}</b></span>
            <span>{t("表现较好")}<b>{good.length}{t(" 题")}</b></span>
            <span>{t("待提升")}<b>{weak.length}{t(" 题")}</b></span>
          </div>
        </div>
      </section>

      <section className="mi-report-section" aria-label={t("能力维度")}>
        <div className="mi-section-head is-report"><h2>{t("能力维度")}</h2><span>{t("1–5 分 · 权重随面试类型变化")}</span><i aria-hidden="true" /></div>
        <div className="mi-dims">
          <div className="mi-dim-radar">
            <RadarChart items={dims.map((item) => ({ label: DIMENSION_LABELS[item.key], value: item.score }))} width={240} height={230} radius={70} cy={112} weakIndex={weakDim ? dims.indexOf(weakDim) : undefined} showRings={false} />
            {dims.map((item, index) => {
              const angle = -Math.PI / 2 + (index * 2 * Math.PI) / dims.length;
              const x = 120 + Math.cos(angle) * 96;
              const y = 112 + Math.sin(angle) * 88;
              return <span key={item.key} className={`mi-dim-label${item === weakDim ? " is-weak" : ""}`} style={{ left: x, top: y }}>{DIMENSION_LABELS[item.key]} {item.score}</span>;
            })}
          </div>
          <ul className="mi-dim-list">
            {dims.map((item) => (
              <li key={item.key}>
                <div className="mi-dim-row">
                  <b>{DIMENSION_LABELS[item.key]}</b>
                  <span className="mi-dim-bar"><i className={item === weakDim ? "is-weak" : ""} style={{ width: `${(item.score / 5) * 100}%` }} /></span>
                  <strong className={item === weakDim ? "is-weak" : ""}>{item.score} / 5</strong>
                  <small>{t("权重 ")}{Math.round(item.weight * 100)}%</small>
                </div>
                <p>{item.comment}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mi-report-section" aria-label={t("逐题表现")}>
        <div className="mi-section-head is-report">
          <h2>{t("逐题表现")}</h2>
          <span>{t("期望深度 L")}{expected}{t(" · 点击题目查看完整问答与分析")}</span>
          <i aria-hidden="true" />
          <div className="mi-filter" role="group" aria-label={t("按表现筛选")}>
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("全部 ")}{rows.length}</button>
            <button type="button" aria-pressed={filter === "good"} onClick={() => setFilter("good")}>{t("表现较好 ")}{good.length}</button>
            <button type="button" aria-pressed={filter === "weak"} onClick={() => setFilter("weak")}>{t("待提升 ")}{weak.length}</button>
          </div>
        </div>
        <div ref={listMotionRef} className="mi-qlist">
          {visible.map((row) => {
            const index = rows.indexOf(row);
            return (
              <button key={row.group.root.id} type="button" className={`mi-qrow${row.conflicts.length ? " has-conflict" : ""}`} onClick={() => setOpenIndex(index)} aria-label={t("Q{value0} {value1}，{value2} 分", { value0: index + 1, value1: row.evaluation.topic, value2: row.evaluation.score })}>
                <span className="mi-qno">Q{index + 1}</span>
                <span className="mi-qtopic">{row.evaluation.topic}</span>
                {row.conflicts.length > 0 && <span className="mi-tag-sq is-warn">{row.conflicts.length}{t(" 处资料冲突")}</span>}
                <span className="mi-qfollow">{row.evaluation.skipped ? t("已跳过") : row.group.follows.length ? t("{value0} 次追问", { value0: row.group.follows.length }) : t("无追问")}</span>
                <span className="mi-tag-sq">{t("深度 L")}{row.evaluation.achieved_depth || "—"}</span>
                <b className={`mi-qscore ${scoreTone(row.evaluation.score)}`}>{row.evaluation.score}</b>
                <span className="mi-qchev" aria-hidden="true">›</span>
              </button>
            );
          })}
          {visible.length === 0 && <p className="mi-qempty">{t("没有符合条件的题目")}</p>}
        </div>
      </section>

      {((report.practice_focus?.length ?? 0) > 0 || report.consistency_basis === "model_only") && (
        <section className="mi-report-section" aria-label={t("下一步练习")}>
          <div className="mi-section-head is-report"><h2>{t("下一步练习")}</h2><i aria-hidden="true" /></div>
          <div className="mi-cards">
            {report.practice_focus?.map((item) => (
              <article key={item.sequence_no} className="mi-improve">
                <h3>{item.topic}<button type="button" className="mi-qref" onClick={() => setOpenIndex(item.sequence_no - 1)}>Q{item.sequence_no}</button></h3>
                {item.reason && <p>{item.reason}</p>}
              </article>
            ))}
            {report.consistency_basis === "model_only" && (
              <article className="mi-improve"><p>{t("简历一致性来自对话中的判断，没有选择参考资料可供核验；选择项目资料后再练一次会更可靠。")}</p></article>
            )}
          </div>
        </section>
      )}

      {improvements.length > 0 && (
        <section className="mi-report-section" aria-label={t("改进建议")}>
          <div className="mi-section-head is-report"><h2>{t("改进建议")}</h2><span>{t("按重要程度排序 · ")}{improvements.length}{t(" 条")}</span><i aria-hidden="true" /></div>
          <div className="mi-cards">
            {improvements.map((item) => (
              <article key={item.title} className="mi-improve">
                <h3><span className={`mi-tag-sq${item.important ? " is-warn" : ""}`}>{item.important ? t("重要") : t("建议")}</span>{item.title}</h3>
                {item.body && <p>{item.body}</p>}
                <div className="mi-sources">
                  {item.questions.length > 0 && <><small>{t("来源")}</small>{item.questions.map((q) => <button key={q} type="button" className="mi-qref" onClick={() => setOpenIndex(q - 1)}>Q{q}</button>)}</>}
                  {item.questions.length > 0 && item.dimensions.length > 0 && <i aria-hidden="true" />}
                  {item.dimensions.length > 0 && <><small>{t("维度")}</small>{item.dimensions.map((d) => <span key={d} className="mi-tag-sq">{d}</span>)}</>}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {risks.length > 0 && (
        <section className="mi-report-section" aria-label={t("简历风险")}>
          <div className="mi-section-head is-report">
            <h2>{t("简历风险")}</h2><span>{t("被追问时可能站不住的内容 · ")}{risks.length}{t(" 条")}</span><i aria-hidden="true" />
            {interview.resume_id && <OpenResumeButton resumeId={interview.resume_id} />}
          </div>
          <div className="mi-cards">
            {risks.map((item, index) => (
              <article key={index} className="mi-risk">
                <div className="mi-risk-head">
                  {item.quote && <><small>{t("简历原文")}</small><b>「{item.quote}」</b></>}
                  {!item.quote && <b>{item.text}</b>}
                  {item.question && <button type="button" className="mi-qref" onClick={() => setOpenIndex(item.question! - 1)}>Q{item.question}</button>}
                </div>
                {item.quote && <p>{item.text}</p>}
                {item.suggestion && <div className="mi-risk-fix"><b>{t("修改建议")}</b><span>{item.suggestion}</span></div>}
              </article>
            ))}
          </div>
        </section>
      )}

      {report.fact_check.status !== "not_requested" && (
        <section className="mi-report-section" aria-label={t("事实核验")}>
          <div className="mi-section-head is-report"><h2>{t("事实核验")}</h2><span>{report.fact_check.status === "failed" ? t("资料读取失败，本次未核验") : t("对照所选资料 · {value0} 条", { value0: report.fact_check.items.length })}</span><i aria-hidden="true" /></div>
          {report.fact_check.items.length > 0 && (
            <ul className="mi-facts">
              {report.fact_check.items.map((item, index) => (
                <li key={index}>
                  <span className={`mi-verdict is-${item.verdict}`}>{FACT_LABELS[item.verdict]}</span>
                  <div><b>{item.claim}</b><small>{item.quote ? `「${item.quote}」 · ` : ""}{item.file_name}</small></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <footer className="mi-report-foot">{t("评分规则 ")}{report.rubric_version}{t(" · 分数由固定规则计算，模型只判断单条标准并给出原文依据")}</footer>

      {openIndex !== null && rows[openIndex] && (
        <QuestionDetailDialog
          rows={rows}
          index={openIndex}
          expected={expected}
          report={report}
          onNavigate={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
      {toast && <Toast kind="error" title={t("没能再练一次")} message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function OpenResumeButton({ resumeId }: { resumeId: string }) {
  useLocale();
  return <button type="button" className="v3-btn v3-btn-ghost mi-open-resume" onClick={() => navigateTo(editorPath(resumeId))}>{t("打开简历")}</button>;
}

/* ───────────── 改进建议 / 简历风险：把报告里的字符串整理成卡片 ───────────── */

type ImprovementCard = { title: string; body: string; important: boolean; questions: number[]; dimensions: string[] };

function improvementCards(report: MockInterviewReport, rows: Row[], weakKey?: string): ImprovementCard[] {
  const weakRows = rows.map((row, index) => ({ row, no: index + 1 })).filter(({ row }) => row.evaluation.score < GOOD_SCORE).sort((a, b) => a.row.evaluation.score - b.row.evaluation.score);
  return report.improvements.map((text, index) => {
    const [title, ...rest] = text.split(/[：:]/);
    const related = weakRows[index] ?? weakRows[0];
    return {
      title: title.trim(),
      body: rest.join("：").trim() || (related ? related.row.evaluation.weaknesses.join("；") : ""),
      important: index < 2,
      questions: related ? [related.no] : [],
      dimensions: weakKey && index === 0 ? [DIMENSION_LABELS[weakKey as keyof typeof DIMENSION_LABELS]] : [],
    };
  });
}

type RiskCard = { quote: string | null; text: string; suggestion: string | null; question: number | null };

function riskCards(report: MockInterviewReport, rows: Row[]): RiskCard[] {
  const conflictRisks: RiskCard[] = report.fact_check.items.filter((item) => item.verdict === "conflict").map((item) => ({
    quote: item.claim,
    text: t("与所选资料不一致：《{value0}》记载为「{value1}」。面试中被追问数据来源时容易失分。", { value0: item.file_name, value1: item.quote }),
    suggestion: t("改为与资料一致的表述，或补充「{value0}」的统计口径。", { value0: item.claim }),
    question: rows.findIndex((row) => row.conflicts.includes(item)) + 1 || null,
  }));
  const textRisks: RiskCard[] = report.resume_risks.map((text) => {
    const quote = text.match(/「([^」]+)」/)?.[1] ?? null;
    return { quote, text, suggestion: null, question: null };
  });
  return [...conflictRisks, ...textRisks];
}

/* ───────────── 07.3a 单题详情 ───────────── */

const VERDICT_LABELS: Record<MockSignalVerdict["verdict"], string> = { get hit() { return t("命中"); }, get partial() { return t("部分"); }, get miss() { return t("未命中"); } };
const LONG_ANSWER = 160;

function QuestionDetailDialog({
  rows,
  index,
  expected,
  report,
  onNavigate,
  onClose,
}: {
  rows: Row[];
  index: number;
  expected: number;
  report: MockInterviewReport;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  useLocale();
  const { group, evaluation, conflicts } = rows[index];
  const turns = [group.root, ...group.follows];
  const totalChars = turns.reduce((sum, question) => sum + charCount(question.answer_text), 0);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const allExpanded = turns.every((question) => expanded[question.id] || charCount(question.answer_text) <= LONG_ANSWER);
  const user = useResumeStore((state) => state.user);
  const initial = [...(user?.nickname || user?.email || t("我"))][0] ?? t("我");
  const factItems = conflicts.length ? conflicts : report.fact_check.items.filter((item) => turns.some((question) => question.answer_text?.includes(item.claim.slice(0, 4))));
  // 上一题 / 下一题：题目内容左右翻页滑动（下一题从右侧进来）
  const previousIndex = useRef(index);
  const direction: 1 | -1 = index >= previousIndex.current ? 1 : -1;
  useEffect(() => { previousIndex.current = index; }, [index]);
  // 换题后回到顶部
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [index]);

  return (
    <Dialog width={820} label={t("第 {value0} 题详情", { value0: index + 1 })} onClose={onClose} className="mi-qdialog" closable>
      <header className="mi-qd-head">
        <div className="mi-qd-top">
          <SlideSwap itemKey={String(index)} direction={direction} distance={16}>
            <div>
              <small>{t("第 ")}{index + 1}{t(" 题 / 共 ")}{rows.length}{t(" 题")}</small>
              <h2>{evaluation.topic}</h2>
            </div>
          </SlideSwap>
          <div className="mi-qd-nav">
            <button type="button" className="v3-btn v3-btn-ghost is-sm" disabled={index === 0} onClick={() => onNavigate(index - 1)}>{t("‹ 上一题")}</button>
            <button type="button" className="v3-btn v3-btn-ghost is-sm" disabled={index === rows.length - 1} onClick={() => onNavigate(index + 1)}>{t("下一题 ›")}</button>
          </div>
        </div>
        <div className="mi-qd-meta">
          <span className="mi-qd-score"><b className={scoreTone(evaluation.score)}>{evaluation.score}</b><small>/ 100</small></span>
          <span className="mi-tag-sq">{t("深度 L")}{evaluation.achieved_depth || "—"}{t(" · 期望 L")}{expected}</span>
          <span className="mi-tag-sq">{group.follows.length ? t("{value0} 次追问", { value0: group.follows.length }) : t("无追问")}</span>
          {conflicts.length > 0 && <span className="mi-tag-sq is-warn">{conflicts.length}{t(" 处资料冲突")}</span>}
        </div>
      </header>
      <div ref={bodyRef} className="mi-qd-body">
        <SlideSwap itemKey={String(index)} direction={direction} distance={48} className="mi-qd-slide">
        <div className="mi-qd-columns">
        <section className="mi-qd-transcript" aria-label={t("问答记录")}>
          <div className="mi-qd-section-head">
            <h3>{t("问答记录")}</h3>
            <small>{t("1 道主问题 · ")}{group.follows.length}{t(" 次追问 · 回答共 ")}{totalChars}{t(" 字")}</small>
            {!allExpanded && <button type="button" className="mi-link-blue" onClick={() => setExpanded(Object.fromEntries(turns.map((question) => [question.id, true])))}>{t("全部展开")}</button>}
          </div>
          {turns.map((question, turnIndex) => {
            const long = charCount(question.answer_text) > LONG_ANSWER;
            const open = expanded[question.id] || !long;
            return (
              <div key={question.id} className={`mi-round${turnIndex === turns.length - 1 ? " is-last" : ""}`}>
                <span className={`mi-rail${question.kind === "main" ? " is-main" : ""}`} aria-hidden="true" />
                <div className="mi-round-body">
                  <div className="mi-round-title"><b>{question.kind === "main" ? t("主问题") : t("追问 {value0}", { value0: turnIndex })}</b><small>{t("考察深度 L")}{question.depth_level}</small></div>
                  <div className="mi-round-q">
                    <InterviewerMark />
                    <div><small>{t("面试官")}</small><p>{question.content}</p></div>
                  </div>
                  <div className="mi-round-a">
                    <span className="mi-avatar" aria-hidden="true">{initial}</span>
                    <div>
                      <small>{t("你的回答 ")}<span>{question.answer_status === "skipped" ? t("已跳过") : t("{value0} 字", { value0: charCount(question.answer_text) })}</span></small>
                      {question.answer_status === "skipped" ? <p className="is-muted">{t("这道题跳过了，记 0 分。")}</p> : <p className={open ? "" : "is-clamped"}>{question.answer_text}</p>}
                      {long && <button type="button" className="mi-link-blue" onClick={() => setExpanded((value) => ({ ...value, [question.id]: !open }))}>{open ? t("收起") : t("展开全文")} <span aria-hidden="true">{open ? "⌃" : "⌄"}</span></button>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </section>
        <section className="mi-qd-analysis" aria-label={t("详细分析")}>
          <div className="mi-qd-section-head"><h3>{t("详细分析")}</h3><small>{t("基于整道题（含追问）的回答评估")}</small></div>
          {evaluation.skipped ? <p className="mi-qd-text">{t("这道题被跳过，没有可评估的回答。")}</p> : (
            <>
              <p className="mi-qd-text">{[...evaluation.highlights.slice(0, 1), ...evaluation.weaknesses.slice(0, 1)].join("；")}{t("；实际深度 L")}{evaluation.achieved_depth}{evaluation.achieved_depth < expected ? t("，比期望低 {value0} 级", { value0: expected - evaluation.achieved_depth }) : t("，达到期望")}。</p>
              <div className="mi-signals">
                {evaluation.signals.map((signal) => (
                  <div key={signal.signal} className="mi-signal">
                    <span className={`mi-verdict is-${signal.verdict}`}>{VERDICT_LABELS[signal.verdict]}</span>
                    <div><b>{signal.signal}</b><small>{signal.evidence ? `“${signal.evidence}”` : t("回答中未涉及")}</small></div>
                  </div>
                ))}
              </div>
              <div className="mi-hw">
                <div><b>{t("亮点")}</b>{evaluation.highlights.length ? evaluation.highlights.map((text) => <p key={text}><i className="is-good" />{text}</p>) : <p className="is-muted">{t("暂无")}</p>}</div>
                <div><b>{t("待改进")}</b>{evaluation.weaknesses.length ? evaluation.weaknesses.map((text) => <p key={text}><i className="is-warn" />{text}</p>) : <p className="is-muted">{t("暂无")}</p>}</div>
              </div>
              {evaluation.factual_errors.length > 0 && (
                <div className="mi-material is-conflict"><b>{t("事实错误")}</b>{evaluation.factual_errors.map((text) => <p key={text}>{text}</p>)}</div>
              )}
              {factItems.map((item, factIndex) => (
                <div key={factIndex} className={`mi-material is-${item.verdict}`}>
                  <div><b>{t("资料核验 · ")}{FACT_LABELS[item.verdict]}</b><small>{item.file_name}</small></div>
                  <p>{t("你提到「")}{item.claim}{t("」，资料原文：「")}{item.quote}」。</p>
                </div>
              ))}
              {evaluation.reference_answer && <div className="mi-reference"><b>{t("参考思路")}</b><p>{evaluation.reference_answer}</p></div>}
            </>
          )}
        </section>
        </div>
        </SlideSwap>
      </div>
    </Dialog>
  );
}
