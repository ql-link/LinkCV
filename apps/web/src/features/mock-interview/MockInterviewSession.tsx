// 07.2 模拟面试 · 准备中（Figma 161:2）/ 进行中（159:1043）。文字作答；语音输入按钮由 voice/VoiceInputButton 提供。
// 面试官问题通过 mockInterviewApi.answer / skip 返回的 SSE 事件逐字输出。
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { mockInterviewPath, navigateTo, newMockInterviewPath } from "@/routing";
import { Icon } from "@/v3/Icon";
import { BeTag, ConfirmDialog, Toast, PageEyebrow } from "@/v3/primitives";
import { VoiceInputButton, voiceInputFooterHint, type VoiceInputState } from "./voice/VoiceInputButton";
import {
  mockInterviewApi,
  mockInterviewErrorMessage,
  type MockInterviewDetail,
  type MockInterviewQuestion,
  type MockTurnEvent,
} from "./mockInterviewApi";
import { charCount, clock, groupQuestions, hhmm, sessionEyebrow, sessionHeading, useNow } from "./mockShared";

/* ───────────── 准备中 / 准备失败 ───────────── */

// 准备阶段的三步进度按经过时间推算（后端只给状态，不给子步骤）
const PREP_STEPS = [
  { title: "分析简历与岗位背景", done: "识别简历中可追问的主张与岗位要求" },
  { title: "制定考察计划", done: "筛选考察点并按难度设定深度" },
  { title: "生成第一道问题", done: "" },
];

export function PreparingView({ interview, onChanged }: { interview: MockInterviewDetail; onChanged: () => void }) {
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
        <button type="button" className="mi-text-btn" onClick={() => setConfirm(true)} disabled={busy}>取消本场</button>
      </SessionHeader>
      <section className={`mi-preparing${failed ? " is-failed" : ""}`} aria-live="polite" aria-busy={!failed}>
        {failed ? (
          <span className="mi-prep-alert" aria-hidden="true"><Icon name="alert" size={20} /></span>
        ) : (
          <span className="mi-spinner" aria-hidden="true" />
        )}
        <h2>{failed ? "面试官没能准备好题目" : "面试官正在准备题目"}</h2>
        <p>{failed ? "考察计划不完整，请重试；进行中的名额已经释放。" : "通常需要 20–40 秒，可以离开此页，准备完成后回到这里继续。"}</p>
        <ol className="mi-prep-steps">
          {PREP_STEPS.map((item, index) => {
            const state = index < step ? "done" : index === step ? (failed ? "failed" : "active") : "todo";
            return (
              <li key={item.title} className={`is-${state}`}>
                <i aria-hidden="true">{state === "done" && <Icon name="check" size={10} strokeWidth={2.6} />}</i>
                <b>{item.title}</b>
                {state === "done" && item.done && <small>{item.done}</small>}
                {state === "active" && index === 1 && <small>{interview.question_count} 个考察点 · {interview.difficulty === "senior" ? "高级" : interview.difficulty === "junior" ? "初级" : "中级"}难度</small>}
              </li>
            );
          })}
        </ol>
        {failed && (
          <div className="mi-prep-fail-actions">
            <button type="button" className="v3-btn v3-btn-ghost is-lg" onClick={() => navigateTo("/mock-interviews")}>返回</button>
            <button type="button" className="v3-btn v3-btn-dark is-lg" disabled={busy} onClick={() => run(() => mockInterviewApi.retry(interview.id))}>重试</button>
          </div>
        )}
      </section>
      {confirm && (
        <ConfirmDialog
          title="取消这场模拟面试？"
          description="面试官还在准备题目，取消后本场记为已放弃，可以随时重新开始。"
          confirmLabel="取消本场"
          busyLabel="正在取消…"
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => run(() => mockInterviewApi.abandon(interview.id), () => { setConfirm(false); navigateTo("/mock-interviews"); })}
        />
      )}
      {toast && <Toast kind="error" title="操作没有完成" message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function SessionHeader({ interview, children }: { interview: MockInterviewDetail; children?: React.ReactNode }) {
  return (
    <header className="mi-session-head">
      <div>
        <PageEyebrow segments={[{ label: "MOCK INTERVIEW", href: "/mock-interviews", onClick: () => navigateTo("/mock-interviews"), ariaLabel: "返回模拟面试" }, ...sessionEyebrow(interview).split(" · ")]} />
        <h1 className="mi-serif-title">{sessionHeading(interview)}</h1>
      </div>
      <div className="mi-session-actions">{children}</div>
    </header>
  );
}

/* ───────────── 进行中 ───────────── */

type Streaming = { text: string; kind: "main" | "follow_up" | "closing"; depth?: number } | null;

export function InProgressView({ interview, onChanged, pause }: { interview: MockInterviewDetail; onChanged: () => void | Promise<void>; pause: (value: boolean) => void }) {
  const now = useNow(1000);
  const [draft, setDraft] = useState("");
  const [speechSessionId, setSpeechSessionId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<Streaming>(null);
  const [pending, setPending] = useState<{ text: string | null; at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceInputState>("idle");
  const [confirm, setConfirm] = useState<"finish" | "abandon" | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const questions = interview.questions;
  const current = questions.find((question) => question.id === interview.current_question_id) ?? null;
  const groups = useMemo(() => groupQuestions(questions), [questions]);
  const currentRoot = current ? (current.parent_id ?? current.id) : null;
  const currentGroup = groups.find((group) => group.root.id === currentRoot) ?? groups[groups.length - 1];
  const mainIndex = currentGroup ? currentGroup.root.plan_index + 1 : 1;
  const followNo = current?.kind === "follow_up" ? currentGroup.follows.findIndex((item) => item.id === current.id) + 1 : 0;
  const answeredMains = groups.filter((group) => group.root.answer_status !== "pending" && group.root.id !== currentRoot).length;
  const elapsed = interview.started_at ? now - new Date(interview.started_at).getTime() : 0;
  const locked = busy || streaming !== null || !current;

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [questions.length, streaming?.text, pending]);

  useEffect(() => { if (!locked) inputRef.current?.focus(); }, [locked]);

  const consume = async (stream: AsyncGenerator<MockTurnEvent>, text: string | null) => {
    setBusy(true);
    pause(true);
    setPending({ text, at: new Date().toISOString() });
    setDraft("");
    setSpeechSessionId(null);
    try {
      for await (const event of stream) {
        if (event.type === "interviewer.delta") {
          setStreaming((value) => ({ kind: value?.kind ?? "main", depth: value?.depth, text: (value?.text ?? "") + event.content }));
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
      setToast({ title: "回答没有提交成功", message: mockInterviewErrorMessage(reason) });
    } finally {
      // 先拿到最新场次再撤掉「待确认」的回答，避免中间闪回作答前的样子
      pause(false);
      await onChanged();
      setPending(null);
      setBusy(false);
    }
  };

  // 追问还是下一题在第一段 delta 前还不知道：先按「当前是主问题且允许追问 → 追问」猜测标签，turn 事件后以真实数据为准
  const startStreaming = () => {
    const willFollow = interview.follow_up_enabled && current?.kind === "main";
    setStreaming({ text: "", kind: willFollow ? "follow_up" : "main", depth: willFollow ? (current?.depth_level ?? 2) + 1 : undefined });
  };

  const send = () => {
    const text = draft.trim();
    if (!current || !text || locked) return;
    try {
      const stream = mockInterviewApi.answer(interview.id, { question_id: current.id, answer: text, speech_session_id: speechSessionId ?? undefined });
      startStreaming();
      void consume(stream, text);
    } catch (reason) {
      setToast({ title: "回答没有提交成功", message: mockInterviewErrorMessage(reason) });
    }
  };

  const skip = () => {
    if (!current || locked) return;
    try {
      const stream = mockInterviewApi.skip(interview.id, { question_id: current.id });
      setStreaming({ text: "", kind: "main" });
      void consume(stream, null);
    } catch (reason) {
      setToast({ title: "没能跳过此题", message: mockInterviewErrorMessage(reason) });
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
      setToast({ title: "操作没有完成", message: mockInterviewErrorMessage(reason) });
    } finally {
      setBusy(false);
    }
  };

  const hint = voiceState === "recording" ? voiceInputFooterHint(voiceState) : "Enter 发送 · Shift + Enter 换行";
  const placeholder = streaming ? "面试官提问中，稍后可以作答…" : current ? "输入你的回答…" : "面试已结束";

  return (
    <div className="mi-page mi-session mi-live">
      <SessionHeader interview={interview}>
        <span className="mi-timer" aria-label="已用时">{clock(elapsed)}</span>
        <button type="button" className="mi-text-btn" disabled={busy} onClick={() => setConfirm("abandon")}>放弃</button>
        <button type="button" className="v3-btn v3-btn-ghost mi-finish-btn" disabled={busy || streaming !== null} onClick={() => setConfirm("finish")}>结束并评估</button>
      </SessionHeader>
      <div className="mi-progress" role="progressbar" aria-label="作答进度" aria-valuemin={0} aria-valuemax={interview.question_count} aria-valuenow={answeredMains}>
        <span className="mi-progress-bars" aria-hidden="true">
          {Array.from({ length: interview.question_count }, (_, index) => (
            <i key={index} className={index < mainIndex - 1 ? "is-done" : index === mainIndex - 1 ? "is-current" : ""} />
          ))}
        </span>
        <b>第 {mainIndex} / {interview.question_count} 题{followNo ? ` · 追问 ${followNo}` : ""}</b>
      </div>
      <div className="mi-thread" ref={scrollRef} aria-live="polite">
        {groups.map((group) => (
          <QuestionBlock key={group.root.id} group={group} currentId={current?.id ?? null} pending={pending} streamingActive={streaming !== null} />
        ))}
        {streaming && (
          <div className="mi-msg-ai">
            <div className="mi-msg-meta">
              {streaming.kind === "follow_up" ? <span className="mi-kind is-follow">追问 · L{streaming.depth ?? 3}</span> : streaming.kind === "main" ? <span className="mi-kind">主问题</span> : null}
              <span className="mi-typing">正在输入…</span>
            </div>
            <p>{streaming.text}<span className="mi-caret" aria-hidden="true" /></p>
          </div>
        )}
        {closing && !streaming && <div className="mi-msg-ai is-closing"><p>{closing}</p></div>}
      </div>
      <div className="mi-composer">
        <div className={`mi-input${voiceState === "recording" ? " is-recording" : ""}${locked ? " is-locked" : ""}`}>
          <textarea
            ref={inputRef}
            aria-label="你的回答"
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
            <button type="button" className="mi-send" aria-label="发送" disabled={locked || !draft.trim()} onClick={send}><Icon name="send" size={15} /></button>
          </div>
        </div>
        <div className="mi-composer-foot">
          <button type="button" className="mi-text-btn" disabled={locked} onClick={skip}>跳过此题</button>
          <span>{hint}</span>
        </div>
      </div>
      {confirm === "finish" && (
        <ConfirmDialog
          title="结束并生成评估？"
          description={answeredMains === 0 && !groups.some((group) => group.root.answer_status === "answered") ? "你还没有回答任何主问题，结束后本场记为已放弃，不生成报告。" : "已作答的题目会进入评估，未作答的题目不计分。评估约需 1 分钟。"}
          confirmLabel="结束并评估"
          busyLabel="正在结束…"
          danger={false}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => finishOrAbandon("finish")}
        />
      )}
      {confirm === "abandon" && (
        <ConfirmDialog
          title="放弃这场模拟面试？"
          description="已作答的内容不会生成评估报告，放弃后可以重新开始一场。"
          confirmLabel="放弃本场"
          busyLabel="正在放弃…"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => finishOrAbandon("abandon")}
        />
      )}
      {toast && <Toast kind="error" title={toast.title} message={toast.message} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function QuestionBlock({
  group,
  currentId,
  pending,
  streamingActive,
}: {
  group: ReturnType<typeof groupQuestions>[number];
  currentId: string | null;
  pending: { text: string | null; at: string } | null;
  streamingActive: boolean;
}) {
  const all = [group.root, ...group.follows];
  const done = all.every((question) => question.answer_status !== "pending") && !all.some((question) => question.id === currentId);
  return (
    <section className="mi-qblock" aria-label={`第 ${group.root.plan_index + 1} 题`}>
      <div className="mi-qlabel"><span>Q{group.root.plan_index + 1} · {done ? "已完成" : "进行中"}</span></div>
      {all.map((question) => (
        <Turn key={question.id} question={question} isCurrent={question.id === currentId} pending={question.id === currentId ? pending : null} streamingActive={streamingActive} />
      ))}
    </section>
  );
}

function Turn({ question, isCurrent, pending, streamingActive }: { question: MockInterviewQuestion; isCurrent: boolean; pending: { text: string | null; at: string } | null; streamingActive: boolean }) {
  // SSE 回合中数据层已把当前题标记为已答，但界面等 answer.accepted 前后都用 pending 显示，避免闪动
  const answered = question.answer_status === "answered" ? question.answer_text : null;
  const skipped = question.answer_status === "skipped";
  const text = pending ? pending.text : answered;
  const at = pending ? pending.at : question.answered_at;
  return (
    <>
      <div className="mi-msg-ai">
        <div className="mi-msg-meta">
          {question.kind === "follow_up" ? <span className="mi-kind is-follow">追问 · L{question.depth_level}</span> : <span className="mi-kind">主问题</span>}
          {isCurrent && !pending && !streamingActive && <span className="mi-typing is-wait">等待你作答</span>}
        </div>
        <p>{question.content}</p>
      </div>
      {(text || (pending && pending.text === null) || skipped) && (
        <div className="mi-msg-me">
          {text ? (
            <>
              <div className="mi-bubble">{text}</div>
              <small>{hhmm(at)} · {charCount(text)} 字{question.answer_source === "voice_input" ? " · 语音输入" : ""}</small>
            </>
          ) : (
            <div className="mi-bubble is-skipped">已跳过此题</div>
          )}
        </div>
      )}
    </>
  );
}

/* ───────────── 评估中 / 已结束 ───────────── */

export function EvaluatingView({ interview, onChanged }: { interview: MockInterviewDetail; onChanged: () => void }) {
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
        <h2>{failed ? "评估报告没能生成" : "正在生成评估报告"}</h2>
        <p>{failed ? "你的作答都已保存，重试即可重新评估。" : interview.report?.closing_message || "面试官正在逐题评估你的回答，约需 1 分钟，可以离开此页。"}</p>
        {failed && (
          <div className="mi-prep-fail-actions">
            <button type="button" className="v3-btn v3-btn-ghost is-lg" onClick={() => navigateTo("/mock-interviews")}>返回</button>
            <button type="button" className="v3-btn v3-btn-dark is-lg" disabled={busy} onClick={retry}>重试评估</button>
          </div>
        )}
      </section>
      {toast && <Toast kind="error" title="操作没有完成" message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

export function AbandonedView({ interview }: { interview: MockInterviewDetail }) {
  return (
    <div className="mi-page mi-session">
      <SessionHeader interview={interview} />
      <section className="mi-preparing is-ended">
        <h2>这场模拟面试已放弃</h2>
        <p>放弃的场次不生成评估报告，可以用相同配置再练一次。 <BeTag /></p>
        <div className="mi-prep-fail-actions">
          <button type="button" className="v3-btn v3-btn-ghost is-lg" onClick={() => navigateTo("/mock-interviews")}>返回</button>
          <button type="button" className="v3-btn v3-btn-dark is-lg" onClick={() => navigateTo(newMockInterviewPath({ applicationId: interview.job_application_id ?? undefined }))}>重新开始</button>
        </div>
      </section>
    </div>
  );
}
