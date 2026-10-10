import { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { api, ApiRequestError, type PoolJob } from "../../api/client";
import { careerApplicationPath, navigateTo } from "../../routing";
import { PoolCompanyLogo, PoolDialog, PoolTag } from "./PoolUi";
import { poolError, poolRecruitment } from "./jobPoolPresentation";

type JoinFeedback = { job: PoolJob; applicationId?: string; created?: boolean; error?: string; closed?: boolean };

export function usePoolJoin(onJoined: (jobId: string, applicationId: string) => void, onClosed?: (jobId: string) => void) {
  const pending = useRef(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<JoinFeedback | null>(null);
  const join = async (job: PoolJob) => {
    if (job.joined_application_id) { navigateTo(careerApplicationPath(job.joined_application_id)); return; }
    if (pending.current || job.availability_status === "closed") return;
    pending.current = true;
    setJoiningId(job.id);
    try {
      const result = await api.joinPoolJob(job.id);
      onJoined(job.id, result.application_id);
      setFeedback({ job, applicationId: result.application_id, created: result.created });
      window.dispatchEvent(new Event("career-applications-changed"));
    } catch (error) {
      const closed = error instanceof ApiRequestError && error.message === "JOB_POOL_CLOSED";
      if (closed) onClosed?.(job.id);
      setFeedback({ job, error: poolError(error), closed });
    } finally { pending.current = false; setJoiningId(null); }
  };
  const dialog = feedback && <PoolDialog
    busy={joiningId !== null}
    title={feedback.error ? feedback.closed ? "岗位已下线" : "加入失败" : feedback.created ? "已加入求职进程" : "这个岗位已经加入"}
    onClose={() => setFeedback(null)}
    footer={<>
      <Button variant="outline" disabled={joiningId !== null} onClick={() => setFeedback(null)}>{feedback.error ? "取消" : feedback.created ? "继续浏览" : "返回岗位池"}</Button>
      {feedback.applicationId ? <Button onClick={() => navigateTo(careerApplicationPath(feedback.applicationId!))}>{feedback.created ? "查看求职进程" : "查看已有记录"}</Button>
        : !feedback.closed && <Button disabled={joiningId !== null} onClick={() => void join(feedback.job)}>{joiningId ? "正在加入…" : "重新加入"}</Button>}
    </>}
  >
    <PoolTag tone={feedback.error ? "warning" : "success"}>{feedback.error ? "暂时无法保存" : feedback.created ? "添加成功" : "已有记录"}</PoolTag>
    {!feedback.error && <div className="pool-saved-job"><div className="pool-company-heading"><PoolCompanyLogo company={feedback.job.company} size={32} /><span>{feedback.job.company.name}</span></div><h3>{feedback.job.title}</h3><p>{feedback.job.locations.cities.join(" / ") || "地点未标明"} · {poolRecruitment(feedback.job)}{feedback.job.category ? ` · ${feedback.job.category}` : ""}</p></div>}
    <p>{feedback.error ?? (feedback.created ? "已保存为个人岗位，可以继续管理投递、面试和求职进展。" : "你已有这个岗位的求职记录，可直接查看和继续推进。")}</p>
  </PoolDialog>;
  return { joiningId, join, dialog };
}

export function PoolJoinButton({ job, joiningId, onJoin, compact = false }: { job: PoolJob; joiningId: string | null; onJoin: (job: PoolJob) => void; compact?: boolean }) {
  const label = joiningId === job.id ? "正在加入…" : job.joined_application_id ? "查看求职进程" : job.availability_status === "closed" ? "岗位已下线" : "加入求职进程";
  return <Button className={compact ? "pool-card-action" : undefined} variant={compact ? "link" : "default"} disabled={joiningId !== null || (!job.joined_application_id && job.availability_status === "closed")} onClick={() => onJoin(job)}>
    {compact && <span aria-hidden="true">{job.joined_application_id ? "✓ " : "＋ "}</span>}{label}
  </Button>;
}
