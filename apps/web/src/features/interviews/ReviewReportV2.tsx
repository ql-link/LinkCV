import { useEffect, useState, type ReactNode } from "react";
import {
  api,
  ApiRequestError,
  type InterviewReviewQuestionNote,
  type InterviewReviewReportV2,
  type InterviewSessionRecord,
} from "@/api/client";
import { t, useLocale } from "@/i18n";
import {
  categoryLabel,
  confidenceLabel,
  dimensionLabel,
  radarPoints,
  reviewGrade,
  verdictLabel,
} from "./reviewReport";

const RADAR_SIZE = 220;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_RADIUS = 78;

/** Five-axis radar, 1–5 per axis; unassessed axes draw at the centre. */
function Radar({ report }: { report: InterviewReviewReportV2 }) {
  const values = report.dimensions.map(item => item.assessed ? item.score : null);
  const rings = [1, 2, 3, 4, 5].map(level => radarPoints(values.map(() => level), RADAR_RADIUS, RADAR_CENTER));
  return (
    <svg className="rp-radar" viewBox={`0 0 ${RADAR_SIZE} ${RADAR_SIZE}`} role="img" aria-label={t("能力雷达")}>
      {rings.map((points, index) => <polygon key={index} points={points} className="rp-radar-ring" />)}
      {report.dimensions.map((item, index) => {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / report.dimensions.length;
        const x = RADAR_CENTER + (RADAR_RADIUS + 20) * Math.cos(angle);
        const y = RADAR_CENTER + (RADAR_RADIUS + 14) * Math.sin(angle);
        return (
          <g key={item.key}>
            <line x1={RADAR_CENTER} y1={RADAR_CENTER} x2={RADAR_CENTER + RADAR_RADIUS * Math.cos(angle)} y2={RADAR_CENTER + RADAR_RADIUS * Math.sin(angle)} className="rp-radar-axis" />
            <text x={x} y={y} textAnchor={Math.abs(x - RADAR_CENTER) < 4 ? "middle" : x > RADAR_CENTER ? "start" : "end"} dominantBaseline="middle" className={item.assessed ? "" : "is-muted"}>
              {dimensionLabel(item.key)} {item.assessed ? item.score : "—"}
            </text>
          </g>
        );
      })}
      <polygon points={radarPoints(values, RADAR_RADIUS, RADAR_CENTER)} className="rp-radar-shape" />
    </svg>
  );
}

function scoreTone(score: number | null): string {
  if (score == null) return "is-gray";
  return score >= 75 ? "is-green" : score >= 50 ? "is-orange" : "is-red";
}

function QuestionNote({
  session, questionText, note, disabled, onSaved,
}: {
  session: InterviewSessionRecord;
  questionText: string;
  note: InterviewReviewQuestionNote | null;
  disabled: boolean;
  onSaved: (note: InterviewReviewQuestionNote | null) => void;
}) {
  const [draft, setDraft] = useState(note?.note ?? "");
  const [verdict, setVerdict] = useState<"good" | "improve" | null>(note?.verdict ?? null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  useEffect(() => { setDraft(note?.note ?? ""); setVerdict(note?.verdict ?? null); setState("idle"); }, [note?.id, note?.lock_version, questionText]);
  const dirty = draft.trim() !== (note?.note ?? "") || verdict !== (note?.verdict ?? null);
  const save = async (nextVerdict = verdict) => {
    setState("saving");
    try {
      const result = await api.saveInterviewReviewNote(session.id, {
        question_text: questionText,
        verdict: nextVerdict,
        note: draft.trim() || null,
        lock_version: note?.lock_version ?? null,
      });
      onSaved(result.note ?? null);
      setState("saved");
    } catch (error) {
      setState(error instanceof ApiRequestError && error.status === 409 ? "conflict" : "error");
    }
  };
  return (
    <section className="rp-note" aria-label={t("我的复盘笔记")}>
      <header>
        <h4>{t("我的复盘笔记")}</h4>
        <div className="rp-note-verdict" role="group" aria-label={t("这道题答得怎么样")}>
          {(["good", "improve"] as const).map(value => (
            <button key={value} type="button" aria-pressed={verdict === value} disabled={disabled || state === "saving"}
              onClick={() => { const next = verdict === value ? null : value; setVerdict(next); void save(next); }}>
              {value === "good" ? t("答得好") : t("待改进")}
            </button>
          ))}
        </div>
      </header>
      <textarea aria-label={t("复盘笔记内容")} value={draft} maxLength={2000} disabled={disabled}
        placeholder={t("记下这道题哪里卡住了、下次怎么答")} onChange={event => { setDraft(event.target.value); setState("idle"); }} />
      <footer>
        <small role="status">{state === "saving" ? t("正在保存…") : state === "saved" ? t("已保存") : state === "conflict" ? t("笔记已在其他页面更新，请刷新后再试。") : state === "error" ? t("保存失败，请稍后重试。") : ""}</small>
        <button type="button" className="rp-outline-button" disabled={disabled || !dirty || state === "saving"} onClick={() => void save()}>{t("保存笔记")}</button>
      </footer>
    </section>
  );
}

export function ReviewReportV2Body({
  session, report, selected, onSelect, questionActions, archived, onNotesChanged,
}: {
  session: InterviewSessionRecord;
  report: InterviewReviewReportV2;
  selected: number;
  onSelect: (index: number) => void;
  questionActions: ReactNode;
  archived: boolean;
  onNotesChanged: (notes: InterviewReviewQuestionNote[]) => void;
}) {
  useLocale();
  const notes = session.review_question_notes ?? [];
  const byKey = new Map(notes.map(item => [item.question_key, item]));
  const keys = new Set(report.questions.map(item => item.key));
  const unmatched = notes.filter(item => !keys.has(item.question_key));
  const verdict = verdictLabel(report.verdict.level);
  const grade = reviewGrade(report.total_score == null ? null : Math.round(report.total_score));
  const question = report.questions[selected];
  const good = report.questions.filter(item => item.score != null && item.score >= 75).length;
  const weak = report.questions.filter(item => item.score != null && item.score < 60).length;
  const counts = Object.entries(report.category_counts).filter(([, count]) => count) as Array<[keyof typeof report.category_counts, number]>;
  const replaceNote = (next: InterviewReviewQuestionNote | null, key: string) => {
    const rest = notes.filter(item => item.question_key !== key);
    onNotesChanged(next ? [...rest, next] : rest);
  };
  const removeNote = async (note: InterviewReviewQuestionNote) => {
    try { await api.deleteInterviewReviewNote(session.id, note.id); onNotesChanged(notes.filter(item => item.id !== note.id)); }
    catch { /* The list stays as is; the next reload shows the truth. */ }
  };
  return (
    <>
      <section className={`rp-verdict is-${verdict.tone}`} aria-label={t("结果判断")}>
        <div>
          <small>{t("结果判断")}</small>
          <strong>{verdict.label}</strong>
          <span className="rp-chip is-gray">{confidenceLabel(report.verdict.confidence)}</span>
        </div>
        <p>{report.headline}</p>
        {report.verdict.confidence_reason && <p className="rp-muted">{report.verdict.confidence_reason}</p>}
        {report.verdict.signals.length > 0 && (
          <ul className="rp-signals" aria-label={t("面试官信号")}>
            {report.verdict.signals.map((item, index) => (
              <li key={index}><span className={`rp-chip ${item.polarity === "positive" ? "is-green" : "is-red"}`}>{item.polarity === "positive" ? t("正向") : t("负向")}</span>{item.meaning}<q>{item.quote}</q></li>
            ))}
          </ul>
        )}
        <small className="rp-muted">{t("这是 AI 基于文字稿的判断，不代表最终结果。")}</small>
      </section>

      <section className="rp-scores" aria-label={t("复盘评分")}>
        <div className="rp-hero">
          <div className="rp-total">
            <small>{t("总分")}{grade && <span className={`rp-level is-${grade.tone}`}>{grade.label}</span>}</small>
            <strong>{report.total_score == null ? "—" : Math.round(report.total_score)}</strong><span>/ 100</span>
            {report.question_average != null && <em>{report.dimension_score != null
              ? t("题目 {value0} × 70% + 维度 {value1} × 30%", { value0: report.question_average, value1: report.dimension_score })
              : t("题目 {value0}", { value0: report.question_average })}</em>}
          </div>
          <div className="rp-hero-copy">
            <h2>{report.summary}</h2>
            <p>{[t("识别问题 {value0} 题", { value0: report.questions.length }), t("表现较好 {value0} 题", { value0: good }), t("待提升 {value0} 题", { value0: weak })].join(" · ")}</p>
          </div>
        </div>
        <h2 className="rp-section-title">{t("能力维度")}<small>{t("1–5 分 · 权重按本场 {value0} 计算", { value0: counts.map(([key, count]) => `${count} ${categoryLabel(key)}`).join("、") || t("题目") })}</small></h2>
        <div className="rp-dimension-grid">
          <Radar report={report} />
          <ul className="rp-dimensions">{report.dimensions.map(item => (
            <li key={item.key}>
              <header>
                <strong>{dimensionLabel(item.key)}</strong>
                <span className="rp-track" aria-hidden="true"><i className={item.score != null && item.score < 3 ? "is-low" : ""} style={{ width: `${((item.score ?? 0) / 5) * 100}%` }} /></span>
                <small>{item.assessed ? `${item.score} / 5` : t("未评估")}</small>
              </header>
              <p>{item.assessed ? [t("权重 {value0}%", { value0: Math.round(item.weight * 100) }), item.comment].filter(Boolean).join(" · ") : item.key === "job_fit" ? t("没有岗位要求，不评这一项") : item.key === "resume_consistency" ? t("没有关联简历，不评这一项") : t("证据不足，不评这一项")}</p>
              {item.evidence && <blockquote>{item.evidence}</blockquote>}
            </li>
          ))}</ul>
        </div>
      </section>

      <section className="rp-questions" aria-labelledby="rp-questions-title">
        <h2 className="rp-section-title" id="rp-questions-title">{t("逐题表现")}<small>{t("期望深度 L{value0} · 点击题目查看完整问答与分析", { value0: report.questions[0]?.expected_depth ?? 3 })}</small></h2>
        <nav aria-label={t("复盘问题")}><ol>{report.questions.map((item, index) => {
          const note = byKey.get(item.key);
          return (
            <li key={item.key + index}>
              <button type="button" aria-pressed={selected === index} onClick={() => onSelect(index)}>
                <small>Q{item.index}</small>
                <span>{item.question}<em className="rp-question-meta">{[categoryLabel(item.category), item.follow_ups ? t("{value0} 次追问", { value0: item.follow_ups }) : t("无追问"), item.achieved_depth != null ? t("深度 L{value0}", { value0: item.achieved_depth }) : null, item.resume_conflict ? t("与简历不一致") : null, note ? t("有笔记") : null].filter(Boolean).join(" · ")}</em></span>
                <b className={`rp-score ${scoreTone(item.score)}`}>{item.score == null ? t("无法评估") : Math.round(item.score)}</b>
              </button>
            </li>
          );
        })}</ol></nav>
        {question && (
          <section className="rp-answer" aria-label={t("AI 建议的回答 · Q{value0}", { value0: question.index })}>
            <small>{t("AI 建议的回答 · Q")}{question.index}</small>
            <h3>{question.question}</h3>
            {question.answer ? <><h4>{t("我的回答")}</h4><p>{question.answer}</p></> : <p className="rp-muted">{question.answer_status === "declined" ? t("这道题没有作答") : t("文字稿里没有找到这道题的回答，不计入得分")}</p>}
            {question.signals.length > 0 && <><h4>{t("要点命中")}</h4><ul className="rp-signal-list">{question.signals.map((signal, index) => (
              <li key={index}><span className={`rp-chip ${signal.verdict === "hit" ? "is-green" : signal.verdict === "partial" ? "is-orange" : "is-gray"}`}>{signal.verdict === "hit" ? t("命中") : signal.verdict === "partial" ? t("部分") : t("未提到")}</span>{signal.signal}{signal.quote && <q>{signal.quote}</q>}</li>
            ))}</ul></>}
            {question.resume_conflict && <p className="rp-banner is-red">{question.resume_conflict}</p>}
            {question.factual_errors.length > 0 && <><h4>{t("事实错误")}</h4><ul className="rp-signal-list">{question.factual_errors.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
            {question.strength && <><h4>{t("做得好的地方")}</h4><p>{question.strength}</p></>}
            {question.improvement && <><h4>{t("可以更好")}</h4><p>{question.improvement}</p></>}
            {question.suggested_answer && <><h4>{t("下次怎么答")}</h4><p>{question.suggested_answer}</p></>}
            {question.evidence_snippets.length > 0 && <><h4>{t("来自资料库的佐证")}</h4><ul className="rp-snippets">{question.evidence_snippets.map((item, index) => <li key={index}><strong>{item.title}</strong><p>{item.text}</p></li>)}</ul></>}
            <QuestionNote session={session} questionText={question.question} note={byKey.get(question.key) ?? null} disabled={archived}
              onSaved={next => replaceNote(next, question.key)} />
            {questionActions}
          </section>
        )}
      </section>

      {unmatched.length > 0 && (
        <section className="rp-suggestions" aria-labelledby="rp-unmatched-title">
          <h2 className="rp-section-title" id="rp-unmatched-title">{t("未匹配的笔记")}<small>{t("重新生成报告后，这些笔记对应的题目没有再出现")}</small></h2>
          <ul>{unmatched.map(item => (
            <li key={item.id}>
              <header><strong>{item.question_text}</strong></header>
              {item.note && <p>{item.note}</p>}
              {!archived && <footer><button type="button" className="rp-outline-button" onClick={() => void removeNote(item)}>{t("删除笔记")}</button></footer>}
            </li>
          ))}</ul>
        </section>
      )}

      {report.improvements.length > 0 && (
        <section className="rp-suggestions" aria-labelledby="rp-suggestions-title">
          <h2 className="rp-section-title" id="rp-suggestions-title">{t("改进建议")}<small>{t("按影响排序 · {value0} 条", { value0: report.improvements.length })}</small></h2>
          <ul>{report.improvements.map((item, index) => (
            <li key={index}>
              <header><span className={`rp-chip ${item.priority === "key" ? "is-red" : "is-orange"}`}>{item.priority === "key" ? t("重要") : t("建议")}</span><strong>{item.title}</strong></header>
              <p>{item.detail}</p>
              <footer>
                {item.question_indexes.length > 0 && <>{t("来源")}{item.question_indexes.map(number => <button key={number} type="button" className="rp-chip is-blue" onClick={() => onSelect(Math.max(0, report.questions.findIndex(question => question.index === number)))}>Q{number}</button>)}</>}
                {item.dimension && <>{t("维度")}<span className="rp-chip is-gray">{dimensionLabel(item.dimension as never)}</span></>}
              </footer>
            </li>
          ))}</ul>
        </section>
      )}

      <p className="rp-basis">{[
        report.basis.transcript_source === "transcription" ? t("录音转写文字稿") : t("文字稿"),
        report.basis.resume_title ? t("投递简历 {value0}", { value0: report.basis.resume_title }) : t("未关联简历"),
        report.basis.has_job ? t("岗位要求") : t("无岗位要求"),
        report.basis.material_snippets ? t("资料库片段 {value0} 段", { value0: report.basis.material_snippets }) : null,
        report.basis.material_mode === "local" ? t("资料召回已降级为本地匹配") : null,
        report.basis.downgraded_quotes ? t("{value0} 处判断因原句不符被降级", { value0: report.basis.downgraded_quotes }) : null,
        t("评分规则 {value0}", { value0: report.rubric_version }),
      ].filter(Boolean).join(" · ")}</p>
    </>
  );
}
