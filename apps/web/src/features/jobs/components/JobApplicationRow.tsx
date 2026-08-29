import type { JobApplicationSummary } from "@/api/client";
import { MoreHorizontal, Calendar, Building2, ChevronRight } from "lucide-react";
import { navigateTo } from "@/routing";
import "../jobs.css";

export function JobApplicationRow({ application }: { application: JobApplicationSummary }) {
  return (
    <div 
      className="job-application-row"
      onClick={() => navigateTo(`/career/applications/${application.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigateTo(`/career/applications/${application.id}`);
      }}
      tabIndex={0}
      role="button"
      aria-label={`查看 ${application.company_name_snapshot} 的 ${application.job_title_snapshot} 申请记录`}
    >
      <div className="job-application-row-main">
        <h3 className="job-application-row-title">
          <Building2 size={16} aria-hidden="true" />
          {application.company_name_snapshot}
          <span className="job-application-row-separator">·</span>
          {application.job_title_snapshot}
        </h3>
        <div className="job-application-row-meta">
          <span className="job-application-row-stage" data-stage={application.current_stage_type}>
            {application.current_stage_label}
          </span>
          {application.next_session_start_at && (
            <span className="job-application-row-time">
              <Calendar size={14} aria-hidden="true" />
              {new Date(application.next_session_start_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      <div className="job-application-row-actions">
        <span className="job-application-row-status" data-status={application.status}>
          {application.status === 'active' ? '进行中' : 
           application.status === 'rejected' ? '已淘汰' : 
           application.status === 'withdrawn' ? '已撤回' : '已归档'}
        </span>
        <button type="button" aria-label="更多操作" className="job-application-row-more" onClick={(e) => { e.stopPropagation(); /* handle more */ }}>
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
        <ChevronRight size={16} className="job-application-row-chevron" aria-hidden="true" />
      </div>
    </div>
  );
}
