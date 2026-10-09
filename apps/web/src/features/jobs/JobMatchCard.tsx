import { useCallback, useEffect, useRef, useState } from "react";
import { t, useLocale } from "@/i18n";
import { ApiRequestError, api, type JobMatch } from "@/api/client";
import { Icon } from "@/v3/Icon";
import matchGauge from "./assets/match-gauge.svg";

const POLL_MS = 3000;
const POLL_LIMIT = 20;
const TAG_LIMIT = 6;

export function matchErrorMessage(code: string | null | undefined) {
  switch (code) {
    case "JOB_MATCH_NO_DESCRIPTION": return t("请先补充岗位描述。");
    case "LLM_MODEL_NOT_CONFIGURED": return t("AI 匹配分析暂未开放。");
    case "JOB_NOT_FOUND":
    case "RESUME_NOT_FOUND": return t("岗位或简历已不存在，请刷新页面。");
    case "JOB_MATCH_INTERRUPTED": return t("上次分析被中断，请重新分析。");
    default: return t("分析没有完成，请稍后重新分析。");
  }
}

export type JobMatchState = {
  match: JobMatch | null;
  loading: boolean;
  analyzing: boolean;
  error: string | null;
  analyze: () => void;
};

/** Reads the saved result for one job and resume; analysis is only ever user-triggered. */
export function useJobMatch(jobId: string, resumeId: string | null | undefined, enabled: boolean): JobMatchState {
  useLocale();
  const scope = enabled && resumeId ? `${jobId}:${resumeId}` : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const timer = useRef<number | undefined>(undefined);
  const [match, setMatch] = useState<JobMatch | null>(null);
  const [loading, setLoading] = useState(Boolean(scope));
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const poll = useCallback((startedFor: string, attempt: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (scopeRef.current !== startedFor || !resumeId) return;
      void api.getJobMatch(jobId, resumeId).then((result) => {
        if (scopeRef.current !== startedFor) return;
        setMatch(result.match);
        if (result.match?.status === "pending" && attempt < POLL_LIMIT) poll(startedFor, attempt + 1);
        else setAnalyzing(false);
      }).catch(() => {
        if (scopeRef.current === startedFor) setAnalyzing(false);
      });
    }, POLL_MS);
  }, [jobId, resumeId]);

  useEffect(() => {
    setMatch(null);
    setError(null);
    setAnalyzing(false);
    setLoading(Boolean(scope));
    if (!scope || !resumeId) return undefined;
    let cancelled = false;
    void api.getJobMatch(jobId, resumeId).then((result) => {
      if (cancelled) return;
      setMatch(result.match);
      if (result.match?.status === "pending") { setAnalyzing(true); poll(scope, 1); }
    }).catch(() => {
      if (!cancelled) setError(matchErrorMessage(null));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; window.clearTimeout(timer.current); };
  }, [scope, jobId, resumeId, poll]);

  const analyze = useCallback(() => {
    if (!scope || !resumeId) return;
    setError(null);
    setAnalyzing(true);
    void api.analyzeJobMatch(jobId, resumeId).then((result) => {
      if (scopeRef.current !== scope) return;
      setMatch(result.match);
      setAnalyzing(false);
    }).catch((reason) => {
      if (scopeRef.current !== scope) return;
      if (reason instanceof ApiRequestError && reason.message === "JOB_MATCH_IN_PROGRESS") {
        poll(scope, 1);
        return;
      }
      setAnalyzing(false);
      setError(matchErrorMessage(reason instanceof ApiRequestError ? reason.message : null));
    });
  }, [scope, jobId, resumeId, poll]);

  return { match, loading, analyzing, error, analyze };
}

function TagList({ words, kind }: { words: string[]; kind: "is-matched" | "is-missing" }) {
  const shown = words.slice(0, TAG_LIMIT);
  return (
    <div className="jd-tags">
      {shown.map((word) => <span className={`jd-tag ${kind}`} key={word} title={word}>{word}</span>)}
      {words.length > shown.length && <span className="jd-tag">{t("等 {value0} 项", { value0: words.length })}</span>}
    </div>
  );
}

export function JobMatchBody({ state, resumeTitle, hasDescription, onOptimize }: {
  state: JobMatchState;
  resumeTitle: string;
  hasDescription: boolean;
  onOptimize: () => void;
}) {
  useLocale();
  const { match, loading, analyzing, error, analyze } = state;
  const ready = match?.status === "ready" ? match : null;
  const failedCode = !analyzing && match?.status === "failed" ? match.error_code : null;
  const failure = error ?? (failedCode ? matchErrorMessage(failedCode) : null);

  let title: string;
  let note: string | null = null;
  if (!hasDescription) { title = t("补充岗位描述后可分析"); note = t("有了岗位描述才能对照简历计算匹配度。"); }
  else if (loading) title = t("正在读取分析结果…");
  else if (analyzing) { title = t("正在分析…"); note = t("正在对照岗位要求逐条检查这份简历，通常需要十几秒。"); }
  else if (failure) { title = t("分析没有完成"); note = failure; }
  else if (ready) {
    title = ready.headline ? t("还缺：{value0}", { value0: ready.headline }) : t("已覆盖主要要求");
    if (ready.stale) note = t("简历或岗位描述已变化，这个分数可能已过期。");
  } else { title = t("还没有分析匹配度"); note = t("点击下方按钮，对照岗位描述检查这份简历。"); }

  const score = ready && !analyzing ? String(ready.score ?? "—") : "—";
  const busy = loading || analyzing;
  const analyzeLabel = ready ? t("重新分析") : failure ? t("重新分析") : t("分析匹配度");

  return <>
    <div className="jd-match-stage"><img src={matchGauge} alt="" /><strong>{score}</strong><span className="jd-gauge-label">{t("匹配度")}</span><span className="jd-gauge-zero">0</span><span className="jd-gauge-max">100</span></div>
    <div className="jd-match-copy">
      <p className="jd-muted">{t("基于「")}{resumeTitle}」</p>
      <h2>{title}</h2>
      {note && <p className="jd-match-note">{note}</p>}
      {ready && !analyzing && <>
        {ready.hits.length > 0 && <div className="jd-match-group"><p className="jd-muted">{t("已命中 · ")}{ready.hits.length}</p><TagList words={ready.hits} kind="is-matched" /></div>}
        {ready.gaps.length > 0 && <div className="jd-match-group is-missing"><p className="jd-muted">{t("待补充 · ")}{ready.gaps.length}</p><TagList words={ready.gaps} kind="is-missing" /></div>}
      </>}
    </div>
    <div className="jd-match-actions">
      <button className="v3-btn v3-btn-ghost" type="button" disabled={!hasDescription || busy} onClick={analyze}><Icon name="spark" size={13} />{analyzing ? t("分析中…") : analyzeLabel}</button>
      <button className="v3-btn v3-btn-ghost" type="button" disabled={!hasDescription} onClick={onOptimize}><Icon name="edit" size={13} />{t("按 JD 优化关联简历")}</button>
    </div>
  </>;
}
