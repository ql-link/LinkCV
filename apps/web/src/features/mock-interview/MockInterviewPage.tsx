// 07 模拟面试入口：按路由分发到各页面。数据来自 ./mockInterviewApi（本地假数据，接口签名与后端一致）。
// 语音面试（answer_mode === "voice"）的进行中与报告页交给 voice/ 目录，外壳由它们自己决定。
import { useEffect } from "react";
import { mockInterviewPath, navigateTo } from "@/routing";
import { V3Shell } from "@/v3/Shell";
import { RouteSkeleton } from "@/v3/skeletons";
import { Icon } from "@/v3/Icon";
import { MockInterviewHome } from "./MockInterviewHome";
import { MockInterviewNew } from "./MockInterviewNew";
import { MockInterviewReportView } from "./MockInterviewReport";
import { AbandonedView, EvaluatingView, InProgressView, PreparingView } from "./MockInterviewSession";
import { useMockInterview } from "./mockShared";
import { VoiceReportPage } from "./voice/VoiceReportPage";
import { VoiceSessionPage } from "./voice/VoiceSessionPage";
import "./mock-interview.css";

export type MockInterviewView = "home" | "new" | "session" | "report";

export function MockInterviewPage({
  view,
  interviewId,
  applicationId,
  resumeId,
}: {
  view: MockInterviewView;
  interviewId?: string;
  applicationId?: string;
  resumeId?: string;
}) {
  if (view === "home") return <V3Shell active="mock"><MockInterviewHome /></V3Shell>;
  if (view === "new") return <V3Shell active="mock"><MockInterviewNew applicationId={applicationId} resumeId={resumeId} /></V3Shell>;
  return <InterviewRoute id={interviewId ?? ""} report={view === "report"} />;
}

function InterviewRoute({ id, report }: { id: string; report: boolean }) {
  const { interview, error, refresh, pause } = useMockInterview(id);

  // 报告只对 completed 场次返回：状态不对时跳到对应页
  useEffect(() => {
    if (!interview) return;
    if (report && interview.status !== "completed") navigateTo(mockInterviewPath(interview.id), { replace: true });
    if (!report && interview.status === "completed") navigateTo(mockInterviewPath(interview.id, true), { replace: true });
  }, [interview, report]);

  if (error) {
    return (
      <V3Shell active="mock">
        <div className="mi-page">
          <div className="mi-load-error" role="alert">
            <strong>{error.includes("不存在") ? "找不到这场模拟面试" : "模拟面试没有加载出来"}</strong>
            <span>{error}</span>
            <button type="button" className="v3-btn v3-btn-ghost" onClick={() => navigateTo("/mock-interviews")}><Icon name="chevl" size={13} />返回模拟面试</button>
          </div>
        </div>
      </V3Shell>
    );
  }
  if (!interview) return <V3Shell active="mock" scroll={false}><RouteSkeleton section="mock" /></V3Shell>;

  const onChanged = () => refresh();
  if (interview.answer_mode === "voice") {
    if (interview.status === "completed") return <VoiceReportPage interview={interview} onChanged={onChanged} />;
    if (["preparing", "preparation_failed", "in_progress"].includes(interview.status)) return <VoiceSessionPage interview={interview} onChanged={onChanged} />;
  }

  let body;
  if (interview.status === "completed") body = <MockInterviewReportView interview={interview} />;
  else if (interview.status === "preparing" || interview.status === "preparation_failed") body = <PreparingView interview={interview} onChanged={onChanged} />;
  else if (interview.status === "in_progress") body = <InProgressView interview={interview} onChanged={onChanged} pause={pause} />;
  else if (interview.status === "abandoned") body = <AbandonedView interview={interview} />;
  else body = <EvaluatingView interview={interview} onChanged={onChanged} />;
  return <V3Shell active="mock">{body}</V3Shell>;
}
