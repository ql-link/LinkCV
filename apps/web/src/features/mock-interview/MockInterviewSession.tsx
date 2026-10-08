import { t, useLocale } from "@/i18n";
// 07.2 模拟面试 · 准备中（Figma 161:2）/ 进行中（1136:156 作答界面重设计 v2）。文字作答；语音输入按钮由 voice/VoiceInputButton 提供。
// 面试官问题通过 mockInterviewApi.answer / skip 返回的 SSE 事件逐字输出。
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { mockInterviewPath, navigateTo, newMockInterviewPath } from "@/routing";
import { Icon } from "@/v3/Icon";
import { ConfirmDialog, Toast, PageEyebrow } from "@/v3/primitives";
import { VoiceInputButton, voiceInputFooterHint, type VoiceInputState } from "./voice/VoiceInputButton";
import {
  mockInterviewApi,
  mockInterviewErrorMessage,
  type MockInterviewDetail,
  type MockTurnEvent,
} from "./mockInterviewApi";
import { InterviewerMark, clock, groupQuestions, sessionEyebrow, sessionHeading, useNow, type QuestionGroup } from "./mockShared";
import { MOCK_INTERVIEW_ERROR_MESSAGES } from "./mockInterviewText";

/* ───────────── 准备中 / 准备失败 ───────────── */

// 准备阶段的三步进度按经过时间推算（后端只给状态，不给子步骤）
const PREP_STEPS = [
  { get title() { return t("分析简历与岗位背景"); }, done: "识别简历中可追问的主张与岗位要求" },
  { get title() { return t("制定考察计划"); }, done: "筛选考察点并按难度设定深度" },
  { get title() { return t("生成第一道问题"); }, done: "" },
];

export function PreparingView({ interview, onChanged }: { interview: MockInterviewDetail; onChanged: () => void }) {
  useLocale();
  const now = useNow(400);
  const failed = interview.status === "preparation_failed";
  const elapsed = now - new Date(interview.created_at).getTime();
  const step = failed ? 1 : Math.min(2, Math.floor(elapsed / 900));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await action();
      after?.();
      onChanged();
    } catch (reason) {
      setToast(mockInterviewErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mi-page mi-session">
      <SessionHeader interview={interview}>
        <button type="button" className="mi-text-btn" onClick={() => setConfirm(true)} disabled={busy}>{t("取消本场")}</button>
      </SessionHeader>
      <section className={`mi-preparing${failed ? " is-failed" : ""}`} aria-live="polite" aria-busy={!failed}>
        {failed ? (
          <span className="mi-prep-alert" aria-hidden="true"><Icon name="alert" size={20} /></span>
        ) : (
          <span className="mi-spinner" aria-hidden="true" />
        )}
        <h2>{failed ? t("面试官没能准备好题目") : t("面试官正在准备题目")}</h2>
        <p>{failed ? (interview.error_code && MOCK_INTERVIEW_ERROR_MESSAGES[interview.error_code] ? t(MOCK_INTERVIEW_ERROR_MESSAGES[interview.error_code]) : t("面试官没能完成准备，请重试；进行中的名额已经释放。")) : t("通常需要 20–40 秒，可以离开此页，准备完成后回到这里继续。")}</p>
        <ol className="mi-prep-steps">
          {PREP_STEPS.map((item, index) => {
            const state = index < step ? "done" : index === step ? (failed ? "failed" : "active") : "todo";
            return (
              <li key={item.title} className={`is-${state}`}>
                <i aria-hidden="true">{state === "done" && <Icon name="check" size={10} strokeWidth={2.6} />}</i>
                <b>{item.title}</b>
                {state === "done" && item.done && <small>{t(item.done)}</small>}
                {state === "active" && index === 1 && <small>{interview.question_count}{t(" 个考察点 · ")}{interview.difficulty === "senior" ? t("高级") : interview.difficulty === "junior" ? t("初级") : t("中级")}{t("难度")}</small>}
              </li>
            );
          })}
        </ol>
        {failed && (
          <div className="mi-prep-fail-actions">
            <button type="button" className="v3-btn v3-btn-ghost is-lg" onClick={() => navigateTo("/mock-interviews")}>{t("返回")}</button>
            <button type="button" className="v3-btn v3-btn-dark is-lg" disabled={busy} onClick={() => run(() => mockInterviewApi.retry(interview.id))}>{t("重试")}</button>
          </div>
        )}
      </section>
      {confirm && (
        <ConfirmDialog
          title={t("取消这场模拟面试？")}
          description={t("面试官还在准备题目，取消后本场记为已放弃，可以随时重新开始。")}
          confirmLabel={t("取消本场")}
          busyLabel={t("正在取消…")}
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => run(() => mockInterviewApi.abandon(interview.id), () => { setConfirm(false); navigateTo("/mock-interviews"); })}
        />
      )}
      {toast && <Toast kind="error" title={t("操作没有完成")} message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function SessionHeader({ interview, children }: { interview: MockInterviewDetail; children?: React.ReactNode }) {
  useLocale();
  return (
    <header className="mi-session-head">
      <div>
        <PageEyebrow segments={[{ label: "MOCK INTERVIEW", href: "/mock-interviews", onClick: () => navigateTo("/mock-interviews"), ariaLabel: t("返回模拟面试") }, ...sessionEyebrow(interview).split(" · ")]} />
        <h1 className="mi-serif-title">{sessionHeading(interview)}</h1>
      </div>
      <div className="mi-session-actions">{children}</div>
    </header>
  );
}

/* ───────────── 进行中 ───────────── */
// 07.2R 作答界面（Figma 1136:156）：进度条按主问题分段，当前题再按「主问题 + 追问上限」细分；
// 正文只显示一道主问题的追问链，面试官在左、回答在右。已完成的题可从进度条点开只读回看。

type Streaming = { text: string } | null;
type Pending = { text: string | null; at: string } | null;

// 每道主问题的追问上限随难度变化，见 docs/features/mock-interview.md「出题与难度」
const FOLLOW_UP_LIMIT: Record<MockInterviewDetail["difficulty"], number> = { junior: 2, intermediate: 2, senior: 3 };

export function InProgressView({ interview, onChanged, pause }: { interview: MockInterviewDetail; onChanged: () => void | Promise<void>; pause: (value: boolean) => void }) {
  useLocale();
  const now = useNow(1000);
  const [draft, setDraft] = useState("");
  const [speechSessionId, setSpeechSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<Streaming>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceInputState>("idle");
  const [confirm, setConfirm] = useState<"finish" | "abandon" | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const questions = interview.questions;
  const current = questions.find((question) => question.id === interview.current_question_id) ?? null;
  const groups = useMemo(() => groupQuestions(questions), [questions]);
  const currentRoot = current ? (current.parent_id ?? current.id) : null;
  const currentGroup = groups.find((group) => group.root.id === currentRoot) ?? groups[groups.length - 1];
  // 自我介绍不占题量：它单独显示为「自我介绍」，正式题从 1 开始计数
  const introOffset = interview.has_intro ? 1 : 0;
  const isIntro = introOffset === 1 && currentGroup?.root.plan_index === 0;
  const mainIndex = currentGroup ? (isIntro ? 0 : currentGroup.root.plan_index + 1 - introOffset) : 1;
  const followNo = current?.kind === "follow_up" ? currentGroup.follows.findIndex((item) => item.id === current.id) + 1 : 0;
  const followLimit = interview.follow_up_enabled ? FOLLOW_UP_LIMIT[interview.difficulty] : 0;
  const answeredMains = groups.filter((group) => group.root.answer_status !== "pending" && group.root.id !== currentRoot && group.root.plan_index >= introOffset).length;
  const elapsed = interview.started_at ? now - new Date(interview.started_at).getTime() : 0;
  // 回答已保存但面试官回复丢失（回合失败或页面中断）：需要先重新生成，不能继续作答
  const needsReply = interview.needs_reply && streaming === null;
  const locked = busy || streaming !== null || !current || needsReply;
  const reviewGroup = reviewId && reviewId !== currentGroup?.root.id ? groups.find((group) => group.root.id === reviewId) ?? null : null;
  const shownGroup = reviewGroup ?? currentGroup;
  const groupLabel = (group: QuestionGroup) => (introOffset === 1 && group.root.plan_index === 0 ? t("自我介绍") : t("第 {value0} 题", { value0: group.root.plan_index + 1 - introOffset }));

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = reviewGroup ? 0 : node.scrollHeight;
  }, [questions.length, streaming?.text, pending, reviewGroup]);

  useEffect(() => { if (!locked && !reviewGroup) inputRef.current?.focus(); }, [locked, reviewGroup]);

  // text 为 null 表示跳过；重新生成回复时不传，不在当前题下补一条回答
  const consume = async (stream: AsyncGenerator<MockTurnEvent>, text?: string | null) => {
    setBusy(true);
    pause(true);
    setReviewId(null);
    if (text !== undefined) setPending({ text, at: new Date().toISOString() });
    setDraft("");
    setSpeechSessionId(null);
    try {
      for await (const event of stream) {
        if (event.type === "interviewer.delta") {
          setStreaming((value) => ({ text: (value?.text ?? "") + event.content }));
        } else if (event.type === "interviewer.turn") {
          if (event.action === "finish") setClosing(event.closing_message);
          setStreaming(null);
        } else if (event.type === "interviewer.failed") {
          throw new Error(event.error);
        }
      }
    } catch (reason) {
      setStreaming(null);
      if (text) setDraft(text);
      setToast({ title: t("回答没有提交成功"), message: mockInterviewErrorMessage(reason) });
    } finally {
      // 先拿到最新场次再撤掉「待确认」的回答，避免中间闪回作答前的样子
      pause(false);
      await onChanged();
      setPending(null);
      setBusy(false);
    }
  };

  // 下一条是追问还是新的主问题要等回合结束才知道，提问过程中只显示「正在提问…」
  const regenerateReply = () => {
    if (busy) return;
    const stream = mockInterviewApi.retryReply(interview.id);
    setStreaming({ text: "" });
    void consume(stream);
  };

  const send = () => {
    const text = draft.trim();
    if (!current || !text || locked) return;
    try {
      const stream = mockInterviewApi.answer(interview.id, { question_id: current.id, answer: text, speech_session_id: speechSessionId ?? undefined });
      setStreaming({ text: "" });
      void consume(stream, text);
    } catch (reason) {
      setToast({ title: t("回答没有提交成功"), message: mockInterviewErrorMessage(reason) });
    }
  };

  const skip = () => {
    if (!current || locked) return;
    try {
      const stream = mockInterviewApi.skip(interview.id, { question_id: current.id });
      setStreaming({ text: "" });
      void consume(stream, null);
    } catch (reason) {
      setToast({ title: t("没能跳过此题"), message: mockInterviewErrorMessage(reason) });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const finishOrAbandon = async (kind: "finish" | "abandon") => {
    setBusy(true);
    try {
      const { mock_interview } = kind === "finish" ? await mockInterviewApi.finish(interview.id) : await mockInterviewApi.abandon(interview.id);
      setConfirm(null);
      if (mock_interview.status === "abandoned") navigateTo("/mock-interviews");
      else onChanged();
    } catch (reason) {
      setToast({ title: t("操作没有完成"), message: mockInterviewErrorMessage(reason) });
    } finally {
      setBusy(false);
    }
  };

  const placeholder = streaming ? t("面试官提问完毕后可以作答") : needsReply ? t("面试官的回复没有生成，请先重新生成") : current ? t("输入你的回答…") : t("面试已结束");
  const progressText = `${isIntro ? t("开场 · 自我介绍") : `${t("第 ")}${mainIndex} / ${interview.question_count}${t(" 题")}`}${followNo ? t(" · 追问 {value0}", { value0: followNo }) : ""}`;

  return (
    <div className="mi-page mi-session mi-live">
      <div className="mi-live-top">
        <header className="mi-live-head">
          <div className="mi-live-title">
            <h1 className="mi-serif-title">{sessionHeading(interview)}</h1>
            <p>{sessionEyebrow(interview)}</p>
          </div>
          <div className="mi-session-actions">
            <span className="mi-timer" aria-label={t("已用时")}>{clock(elapsed)}</span>
            <button type="button" className="mi-text-btn" disabled={busy} onClick={() => setConfirm("abandon")}>{t("放弃")}</button>
            <button type="button" className="v3-btn v3-btn-ghost mi-finish-btn" disabled={busy || streaming !== null} onClick={() => setConfirm("finish")}>{t("结束并评估")}</button>
          </div>
        </header>
        <SessionProgress
          interview={interview}
          groups={groups}
          currentGroup={currentGroup}
          followNo={followNo}
          followLimit={followLimit}
          introOffset={introOffset}
          reviewId={reviewGroup?.root.id ?? null}
          disabled={busy || streaming !== null}
          label={groupLabel}
          statusText={progressText}
          onSelect={(group) => setReviewId(group.root.id === currentGroup?.root.id ? null : group.root.id)}
        />
      </div>
      <div className="mi-thread" ref={scrollRef} aria-live="polite">
        <div className="mi-chain">
          {shownGroup && (
            <QuestionChain
              group={shownGroup}
              label={reviewGroup ? t("{value0} · 已完成", { value0: groupLabel(shownGroup) }) : groupLabel(shownGroup)}
              currentId={reviewGroup ? null : current?.id ?? null}
              pending={reviewGroup ? null : pending}
              waiting={!reviewGroup && streaming === null && !pending}
            />
          )}
          {streaming && !reviewGroup && <AiMessage label={t("正在提问…")} text={streaming.text} active typing />}
          {closing && !streaming && !reviewGroup && <AiMessage label={t("结束语")} text={closing} />}
        </div>
      </div>
      <div className="mi-composer">
        {reviewGroup && currentGroup ? (
          <div className="mi-review-bar">
            <span>{t("正在回看{value0}，{value1}还在等你回答", { value0: groupLabel(reviewGroup), value1: groupLabel(currentGroup) })}</span>
            <button type="button" className="v3-btn v3-btn-dark" onClick={() => setReviewId(null)}>{t("回到{value0}", { value0: groupLabel(currentGroup) })}</button>
          </div>
        ) : (
          <>
            {needsReply && (
              <div className="mi-reply-lost" role="alert">
                <span>{t("面试官的回复没有生成出来，你的回答已经保存。")}</span>
                <button type="button" className="v3-btn v3-btn-dark" disabled={busy} onClick={regenerateReply}>{t("重新生成回复")}</button>
              </div>
            )}
            <div className={`mi-input${voiceState === "recording" ? " is-recording" : ""}${locked ? " is-locked" : ""}`}>
              <textarea
                ref={inputRef}
                aria-label={t("你的回答")}
                value={draft}
                placeholder={placeholder}
                disabled={locked}
                rows={1}
                maxLength={8000}
                onKeyDown={onKeyDown}
                onChange={(event) => { setDraft(event.target.value); if (!event.target.value) setSpeechSessionId(null); }}
              />
              <div className="mi-input-tools">
                {current && (
                  <VoiceInputButton
                    interviewId={interview.id}
                    questionId={current.id}
                    disabled={locked}
                    onStateChange={setVoiceState}
                    onText={(text, sessionId) => { setDraft((value) => (value ? `${value}${text}` : text)); setSpeechSessionId(sessionId); }}
                  />
                )}
                <button type="button" className="mi-skip" disabled={locked} title={t("跳过后这道题不再追问，记 0 分")} onClick={skip}>{t("跳过此题")}</button>
                <button type="button" className="mi-send" aria-label={t("发送")} disabled={locked || !draft.trim()} onClick={send}><Icon name="send" size={15} /></button>
              </div>
            </div>
            {voiceState === "recording" && <p className="mi-composer-hint">{voiceInputFooterHint(voiceState)}</p>}
          </>
        )}
      </div>
      {confirm === "finish" && (
        <ConfirmDialog
          title={t("结束并生成评估？")}
          description={answeredMains === 0 && !groups.some((group) => group.root.answer_status === "answered") ? t("你还没有回答任何主问题，结束后本场记为已放弃，不生成报告。") : t("已作答的题目会进入评估，未作答的题目不计分。评估约需 1 分钟。")}
          confirmLabel={t("结束并评估")}
          busyLabel={t("正在结束…")}
          danger={false}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => finishOrAbandon("finish")}
        />
      )}
      {confirm === "abandon" && (
        <ConfirmDialog
          title={t("放弃这场模拟面试？")}
          description={t("已作答的内容不会生成评估报告，放弃后可以重新开始一场。")}
          confirmLabel={t("放弃本场")}
          busyLabel={t("正在放弃…")}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => finishOrAbandon("abandon")}
        />
      )}
      {toast && <Toast kind="error" title={toast.title} message={toast.message} onDismiss={() => setToast(null)} />}
    </div>
  );
}

// 进度条：每道主问题一段；当前题细分为「主问题 + 追问上限」，已完成的题只保留实际发生的轮数
function SessionProgress({
  interview,
  groups,
  currentGroup,
  followNo,
  followLimit,
  introOffset,
  reviewId,
  disabled,
  label,
  statusText,
  onSelect,
}: {
  interview: MockInterviewDetail;
  groups: QuestionGroup[];
  currentGroup: QuestionGroup | undefined;
  followNo: number;
  followLimit: number;
  introOffset: number;
  reviewId: string | null;
  disabled: boolean;
  label: (group: QuestionGroup) => string;
  statusText: string;
  onSelect: (group: QuestionGroup) => void;
}) {
  useLocale();
  const steps = Array.from({ length: interview.question_count + introOffset }, (_, planIndex) => ({
    planIndex,
    intro: introOffset === 1 && planIndex === 0,
    group: groups.find((group) => group.root.plan_index === planIndex),
  }));
  return (
    <nav className="mi-steps" aria-label={t("作答进度")}>
      <span className="v3-visually-hidden" aria-live="polite">{statusText}</span>
      <ol>
        {steps.map(({ planIndex, intro, group }) => {
          const isCurrent = !!group && group === currentGroup;
          const skipped = group?.root.answer_status === "skipped";
          const state = isCurrent ? "cur" : group ? (skipped ? "skip" : "done") : "todo";
          const rounds = isCurrent ? 1 + Math.max(followLimit, followNo) : state === "done" && group ? 1 + group.follows.length : 1;
          const name = group ? label(group) : t("第 {value0} 题", { value0: planIndex + 1 - introOffset });
          const viewing = group?.root.id === reviewId;
          const segs = (
            <>
              <span className="mi-step-bars" aria-hidden="true">
                {Array.from({ length: rounds }, (_, index) => (
                  <i key={index} className={isCurrent ? (index < followNo ? "is-done" : index === followNo ? "is-current" : "") : state === "done" ? "is-done" : state === "skip" ? "is-skip" : ""} />
                ))}
              </span>
              <span className="mi-step-label">
                <b>{name}</b>
                {isCurrent && followNo > 0 && <em>{t("追问 {value0}", { value0: `${followNo}/${Math.max(followLimit, followNo)}` })}</em>}
                {state === "skip" && <small>{t("已跳过")}</small>}
              </span>
            </>
          );
          return (
            <li key={planIndex} className={`mi-step is-${state}${intro ? " is-intro" : ""}${viewing ? " is-viewing" : ""}`}>
              {group ? (
                <button type="button" disabled={disabled} aria-current={isCurrent ? "step" : undefined} aria-pressed={viewing} aria-label={isCurrent ? name : t("查看{value0}", { value0: name })} onClick={() => onSelect(group)}>{segs}</button>
              ) : (
                <div>{segs}</div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// 一道主问题的追问链：主问题 → 回答 → 追问 1 → 回答 …
function QuestionChain({ group, label, currentId, pending, waiting }: { group: QuestionGroup; label: string; currentId: string | null; pending: Pending; waiting: boolean }) {
  useLocale();
  const all = [group.root, ...group.follows];
  return (
    <section className="mi-chain-group" aria-label={label}>
      {all.map((question, index) => {
        const isCurrent = question.id === currentId;
        const turnPending = isCurrent ? pending : null;
        // SSE 回合中数据层已把当前题标记为已答，但界面在回合结束前统一用 pending 显示，避免闪动
        const answered = question.answer_status === "answered" ? question.answer_text : null;
        const text = turnPending ? turnPending.text : answered;
        const skipped = turnPending ? turnPending.text === null : question.answer_status === "skipped";
        return (
          <Fragment key={question.id}>
            <AiMessage label={index === 0 ? label : t("追问 {value0}", { value0: index })} text={question.content} main={index === 0} active={isCurrent && waiting} />
            {(text || skipped) && (
              <div className="mi-msg-me">
                <div className={`mi-bubble${skipped && !text ? " is-skipped" : ""}`}>{text || t("已跳过此题")}</div>
              </div>
            )}
          </Fragment>
        );
      })}
    </section>
  );
}

function AiMessage({ label, text, main = false, active = false, typing = false }: { label: string; text: string; main?: boolean; active?: boolean; typing?: boolean }) {
  return (
    <div className={`mi-msg-ai${main ? " is-main" : ""}${active ? " is-active" : ""}`}>
      <InterviewerMark size={28} />
      <div className="mi-msg-body">
        <span className="mi-msg-label">{label}</span>
        <p className="mi-msg-bubble">{text}{typing && <span className="mi-caret" aria-hidden="true" />}</p>
      </div>
    </div>
  );
}

/* ───────────── 评估中 / 已结束 ───────────── */

export function EvaluatingView({ interview, onChanged }: { interview: MockInterviewDetail; onChanged: () => void }) {
  useLocale();
  const failed = interview.status === "evaluation_failed";
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (interview.status === "completed") navigateTo(mockInterviewPath(interview.id, true), { replace: true });
  }, [interview.id, interview.status]);
  const retry = async () => {
    setBusy(true);
    try { await mockInterviewApi.retry(interview.id); onChanged(); } catch (reason) { setToast(mockInterviewErrorMessage(reason)); } finally { setBusy(false); }
  };
  return (
    <div className="mi-page mi-session">
      <SessionHeader interview={interview} />
      <section className={`mi-preparing${failed ? " is-failed" : ""}`} aria-live="polite">
        {failed ? <span className="mi-prep-alert" aria-hidden="true"><Icon name="alert" size={20} /></span> : <span className="mi-spinner" aria-hidden="true" />}
        <h2>{failed ? t("评估报告没能生成") : t("正在生成评估报告")}</h2>
        <p>{failed ? t("你的作答都已保存，重试即可重新评估。") : interview.report?.closing_message || t("面试官正在逐题评估你的回答，约需 1 分钟，可以离开此页。")}</p>
        {failed && (
          <div className="mi-prep-fail-actions">
            <button type="button" className="v3-btn v3-btn-ghost is-lg" onClick={() => navigateTo("/mock-interviews")}>{t("返回")}</button>
            <button type="button" className="v3-btn v3-btn-dark is-lg" disabled={busy} onClick={retry}>{t("重试评估")}</button>
          </div>
        )}
      </section>
      {toast && <Toast kind="error" title={t("操作没有完成")} message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

export function AbandonedView({ interview }: { interview: MockInterviewDetail }) {
  useLocale();
  return (
    <div className="mi-page mi-session">
      <SessionHeader interview={interview} />
      <section className="mi-preparing is-ended">
        <h2>{t("这场模拟面试已放弃")}</h2>
        <p>{t("放弃的场次不生成评估报告，可以用相同配置再练一次。")}</p>
        <div className="mi-prep-fail-actions">
          <button type="button" className="v3-btn v3-btn-ghost is-lg" onClick={() => navigateTo("/mock-interviews")}>{t("返回")}</button>
          <button type="button" className="v3-btn v3-btn-dark is-lg" onClick={() => navigateTo(newMockInterviewPath({ applicationId: interview.job_application_id ?? undefined }))}>{t("重新开始")}</button>
        </div>
      </section>
    </div>
  );
}
