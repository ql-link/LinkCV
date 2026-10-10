import { useCallback, useRef, useState } from "react";
import { api, ApiRequestError, type PoolJob } from "../../api/client";
import { careerApplicationPath, navigateTo } from "../../routing";
import { Icon } from "../../v3/Icon";
import { ConfirmDialog, Dialog, Toast } from "../../v3/primitives";
import { PoolJoinFailedArt, PoolUnavailableArt } from "./PoolArt";
import { poolError } from "./jobPoolPresentation";

type JoinNotice = { applicationId: string; created: boolean };
type JoinFailure = { job: PoolJob; error: string; closed: boolean };

/** Joining succeeds in place with a short toast; only a failure or an offline job stops the user with a dialog. */
export function usePoolJoin(onJoined: (jobId: string, applicationId: string) => void, onClosed?: (jobId: string) => void) {
  const pending = useRef(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [notice, setNotice] = useState<JoinNotice | null>(null);
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const join = async (job: PoolJob) => {
    if (job.joined_application_id) { navigateTo(careerApplicationPath(job.joined_application_id)); return; }
    if (pending.current || job.availability_status === "closed") return;
    pending.current = true;
    setJoiningId(job.id);
    try {
      const result = await api.joinPoolJob(job.id);
      onJoined(job.id, result.application_id);
      setFailure(null);
      setNotice({ applicationId: result.application_id, created: result.created });
      window.dispatchEvent(new Event("career-applications-changed"));
    } catch (error) {
      const closed = error instanceof ApiRequestError && error.message === "JOB_POOL_CLOSED";
      if (closed) onClosed?.(job.id);
      setFailure({ job, error: closed ? "这个岗位已从企业官网下线，无法再加入；已有求职记录不受影响。" : `${poolError(error)}岗位信息和已有记录均已保留。`, closed });
    } finally { pending.current = false; setJoiningId(null); }
  };
  const busy = joiningId !== null;
  const feedback = <>
    {notice && <Toast kind="success" title={notice.created ? "已加入求职进程" : "这个岗位已经加入"} message={notice.created ? "可以在求职进程里继续管理投递和面试。" : "你已有这个岗位的求职记录。"} onDismiss={dismissNotice}
      action={<button type="button" className="v3-link" onClick={() => navigateTo(careerApplicationPath(notice.applicationId))}>{notice.created ? "查看" : "查看已有记录"}</button>} />}
    {failure && !failure.closed && <ConfirmDialog title="加入失败" description={failure.error} art={<PoolJoinFailedArt />} danger={false}
      confirmLabel="重新加入" busyLabel="正在加入…" busy={busy} onConfirm={() => void join(failure.job)} onCancel={() => setFailure(null)} />}
    {failure?.closed && <Dialog width={420} label="岗位已下线" className="v3-confirm" onClose={() => setFailure(null)}>
      <div className="v3-dialog-body">
        <div className="v3-stage has-dots"><PoolUnavailableArt tag="官网已下线" /></div>
        <h2 className="v3-dialog-title">岗位已下线</h2>
        <div className="v3-dialog-sub">{failure.error}</div>
      </div>
      <div className="v3-confirm-foot pool-confirm-single">
        <button type="button" className="v3-btn v3-btn-dark" data-autofocus onClick={() => setFailure(null)}>知道了</button>
      </div>
    </Dialog>}
  </>;
  return { joiningId, join, feedback };
}

export function PoolJoinButton({ job, joiningId, onJoin }: { job: PoolJob; joiningId: string | null; onJoin: (job: PoolJob) => void }) {
  const joined = Boolean(job.joined_application_id);
  const closed = !joined && job.availability_status === "closed";
  const label = joiningId === job.id ? "正在加入…" : joined ? "查看求职进程" : closed ? "岗位已下线" : "加入求职进程";
  return <button type="button" className={`v3-btn v3-btn-dark is-lg pool-join${closed ? " is-closed" : ""}`}
    disabled={joiningId !== null || closed} onClick={() => onJoin(job)}>
    {!closed && <Icon name={joined ? "check" : "plus"} size={13} />}{label}
  </button>;
}
