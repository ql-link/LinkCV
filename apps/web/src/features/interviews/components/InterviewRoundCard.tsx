import type { InterviewSessionSummary } from "@/api/client";
import { Clock, Video, MapPin, CheckCircle2, XCircle, AlertCircle, Phone } from "lucide-react";
import "../interviews.css";

export function InterviewRoundCard({ session }: { session: InterviewSessionSummary }) {
  const isCompleted = session.status === 'completed';
  const isCancelled = session.status === 'cancelled';
  
  return (
    <div className={`interview-round-card is-${session.status}`} aria-label={`${session.company_name} ${session.stage_label} ${session.status}`}>
      <div className="interview-round-card-header">
        <h4 className="interview-round-card-title">
          {session.company_name} <span className="interview-round-card-separator">·</span> {session.job_title}
        </h4>
        <span className="interview-round-card-stage">
          {session.stage_label} {session.round_no ? `(第 ${session.round_no} 轮)` : ''}
        </span>
      </div>
      <div className="interview-round-card-body">
        <div className="interview-round-card-detail">
          <Clock size={14} aria-hidden="true" />
          <time dateTime={session.start_at}>
            {new Date(session.start_at).toLocaleString()}
          </time>
        </div>
        <div className="interview-round-card-detail">
          {session.mode === 'video' ? <Video size={14} aria-hidden="true" /> : 
           session.mode === 'phone' ? <Phone size={14} aria-hidden="true" /> : 
           <MapPin size={14} aria-hidden="true" />}
          <span>{session.mode === 'video' ? '视频面试' : session.mode === 'phone' ? '电话面试' : '线下面试'}</span>
        </div>
      </div>
      <div className="interview-round-card-footer">
        <div className="interview-round-card-status">
          {isCompleted ? (
            <><CheckCircle2 size={16} className="status-icon success" aria-hidden="true" /> <span>已完成</span></>
          ) : isCancelled ? (
            <><XCircle size={16} className="status-icon error" aria-hidden="true" /> <span>已取消</span></>
          ) : (
            <><AlertCircle size={16} className="status-icon pending" aria-hidden="true" /> <span>待面试</span></>
          )}
        </div>
      </div>
    </div>
  );
}
