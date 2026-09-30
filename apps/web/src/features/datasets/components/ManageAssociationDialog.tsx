import { useEffect, useMemo, useState } from "react";

import { api, ApiRequestError, type DatasetRecord, type InterviewSessionSummary } from "../../../api/client";
import { Dialog, DialogFooter, SearchBox } from "../../../v3/primitives";
import { AssociateArt } from "./DatasetArt";

const WEEK = "日一二三四五六";
const MODE_LABELS: Record<string, string> = { video: "视频面试", onsite: "现场", phone: "电话", other: "其他" };
const pad = (value: number) => String(value).padStart(2, "0");

// 面试场次副标题：「三面 · 09-27 周日 16:00 · 飞书视频」；已完成 / 已取消的写状态
function sessionMeta(session: InterviewSessionSummary) {
  const date = new Date(session.start_at);
  const when = Number.isNaN(date.getTime())
    ? ""
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} 周${WEEK[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const tail = session.status === "completed"
    ? "已完成"
    : session.status === "cancelled"
      ? "已取消"
      : session.location || MODE_LABELS[session.mode] || "";
  return [session.stage_label, when, tail].filter(Boolean).join(" · ");
}

function associationErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.message === "DATASET_ALREADY_LINKED") return "这份资料已关联其他面试，请刷新后重试。";
    if (error.message === "INTERVIEW_ASSET_NOT_FOUND") return "关联已被解除，请刷新后重试。";
    if (error.status === 404) return "面试或资料不存在，请刷新后重试。";
    if (error.message === "INVALID_INTERVIEW_REQUEST") return "资料还没有上传完成，暂时不能关联。";
  }
  return "关联没有保存，请稍后重试。";
}

// 06.1d 管理关联（540 宽）：插图 → 搜索 → 面试单选列表（当前关联标「当前」）→ 左下红字「取消关联」 + 取消 / 保存。
// 一份资料只能关联一场面试：换场次时先解绑旧场次，再关联新场次（接口 attach / unlink 已有）。
export function ManageAssociationDialog({
  dataset,
  displayName,
  onClose,
  onSaved,
}: {
  dataset: DatasetRecord;
  displayName: string;
  onClose: () => void;
  onSaved: (message: string) => Promise<void> | void;
}) {
  const currentId = dataset.interview_session_id ?? null;
  const [sessions, setSessions] = useState<InterviewSessionSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(currentId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    void api.listInterviewSessions().then(
      (result) => {
        if (cancelled) return;
        // 当前关联排最前，其余按开始时间倒序
        const items = [...result.items].sort((a, b) => {
          if (a.id === currentId) return -1;
          if (b.id === currentId) return 1;
          return new Date(b.start_at).getTime() - new Date(a.start_at).getTime();
        });
        setSessions(items);
      },
      () => {
        if (!cancelled) setLoadError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [currentId, reload]);

  const keyword = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => (sessions ?? []).filter((session) => {
    if (!keyword) return true;
    return `${session.company_name} ${session.job_title} ${session.stage_label}`.toLocaleLowerCase().includes(keyword);
  }), [keyword, sessions]);

  const save = async () => {
    if (!selected || selected === currentId) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (currentId) await api.unlinkSessionAsset(currentId, dataset.id);
      await api.attachInterviewAsset(selected, dataset.id);
      const target = sessions?.find((session) => session.id === selected);
      await onSaved(target ? `已关联到「${target.company_name} · ${target.stage_label}」。` : "关联已更新。");
    } catch (err) {
      setError(associationErrorMessage(err));
      setBusy(false);
    }
  };

  const unlink = async () => {
    if (!currentId) return;
    setBusy(true);
    setError(null);
    try {
      await api.unlinkSessionAsset(currentId, dataset.id);
      await onSaved("已取消关联。");
    } catch (err) {
      setError(associationErrorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog width={540} label="管理关联" className="ds-dialog is-tight" closable={!busy} onClose={() => { if (!busy) onClose(); }}>
      <div className="v3-dialog-body">
        <h2 className="v3-dialog-title">管理关联</h2>
        <p className="v3-dialog-sub ds-one-line" title={`「${displayName}」可以关联到一场面试，关联后在求职记录里也能看到它。`}>「{displayName}」可以关联到一场面试，关联后在求职记录里也能看到它。</p>
        <div className="v3-stage ds-dialog-art" style={{ height: 96 }}>
          <AssociateArt dataset={dataset} />
        </div>
        <div className="ds-assoc-search-wrap">
          <SearchBox value={query} onChange={setQuery} placeholder="搜索公司、岗位或轮次…" label="搜索面试" />
        </div>
        <div className="ds-list-label" style={{ marginBottom: 11 }}><span>选择要关联的面试</span><span>一份资料只能关联一场</span></div>
        <div className="ds-pick is-sessions" role="radiogroup" aria-label="面试场次" style={{ height: 240 }}>
          {sessions === null && !loadError && <p className="ds-pick-empty">正在读取面试…</p>}
          {loadError && (
            <p className="ds-pick-empty">
              面试列表读取失败，<button type="button" className="v3-link" onClick={() => setReload((value) => value + 1)}>重新加载</button>
            </p>
          )}
          {sessions !== null && visible.length === 0 && (
            <p className="ds-pick-empty">{keyword ? "没有匹配的面试" : "还没有面试安排，可以先在岗位看板里添加"}</p>
          )}
          {visible.map((session) => {
            const on = selected === session.id;
            return (
              <button
                key={session.id}
                type="button"
                role="radio"
                aria-checked={on}
                className="ds-session"
                disabled={busy}
                onClick={() => setSelected(session.id)}
              >
                <span className={`v3-radio${on ? " is-on" : ""}`} aria-hidden="true" />
                <span className="ds-session-copy">
                  <strong>{session.company_name} · {session.job_title}</strong>
                  <small className="v3-num">{sessionMeta(session)}</small>
                </span>
                {session.id === currentId && <span className="ds-current-tag">当前</span>}
              </button>
            );
          })}
        </div>
        {error && <p className="ds-inline-error" role="alert">{error}</p>}
      </div>
      <DialogFooter left={currentId ? <button type="button" className="ds-unlink" disabled={busy} onClick={() => void unlink()}>取消关联</button> : null}>
        <button type="button" className="v3-btn v3-btn-ghost" style={{ width: 80 }} disabled={busy} onClick={onClose}>取消</button>
        <button type="button" className="v3-btn v3-btn-dark" style={{ width: 88 }} disabled={busy || !selected || selected === currentId} onClick={() => void save()}>
          {busy ? "保存中…" : "保存"}
        </button>
      </DialogFooter>
    </Dialog>
  );
}
