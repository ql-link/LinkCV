import { AlertTriangle, Check, CircleAlert, ClipboardCheck, Minus, X } from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui";
import type {
  ResumeCompletenessCheck,
  ResumeCompletenessResult,
  ResumeCompletenessStatus,
} from "./resumeCompleteness";
import { resumeCompletenessTone } from "./resumeCompleteness";

const statusCopy: Record<ResumeCompletenessStatus, string> = {
  passed: "已通过",
  partial: "需完善",
  failed: "待补充",
};

const statusIcon = {
  passed: Check,
  partial: Minus,
  failed: CircleAlert,
} as const;

function CompletenessCheckRow({ item }: { item: ResumeCompletenessCheck }) {
  const StatusIcon = statusIcon[item.status];
  return (
    <li className={`resume-completeness-check is-${item.status}`}>
      <span className="resume-completeness-check-icon" aria-hidden="true">
        <StatusIcon />
      </span>
      <span className="resume-completeness-check-copy">
        <span className="resume-completeness-check-title">
          <strong>{item.label}</strong>
          <small>{item.earnedPoints}/{item.maxPoints} 分</small>
        </span>
        <span className="resume-completeness-status">{statusCopy[item.status]}</span>
        {item.issue && <span>{item.issue}</span>}
        {item.recommendation && <em>{item.recommendation}</em>}
      </span>
    </li>
  );
}

export function ResumeCompletenessAction({
  score,
  panelOpen,
  onToggle,
}: {
  score: number;
  panelOpen: boolean;
  onToggle: () => void;
}) {
  const tone = resumeCompletenessTone(score);
  return (
    <Button
      aria-label={`简历完整度 ${score} 分`}
      aria-controls="workbench-side-panel"
      aria-expanded={panelOpen}
      aria-pressed={panelOpen}
      className={`workbench-action workbench-quality-action is-${tone}${panelOpen ? " is-active" : ""}`}
      icon={<ClipboardCheck aria-hidden="true" />}
      size="sm"
      title={`简历完整度 ${score} 分`}
      variant="secondary"
      onClick={onToggle}
    >
      完整度 {score}
    </Button>
  );
}

export function ResumeCompletenessPanel({
  result,
  onClose,
}: {
  result: ResumeCompletenessResult;
  onClose: () => void;
}) {
  const incompleteChecks = result.checks.filter((item) => item.status !== "passed");
  const passedChecks = result.checks.filter((item) => item.status === "passed");
  const tone = resumeCompletenessTone(result.score);

  return (
    <div className="resume-completeness-panel">
      <header className="resume-completeness-head">
        <span>
          <h2 id="workbench-quality-title">简历检查</h2>
          <small>实时规则检查</small>
        </span>
        <button
          type="button"
          className="workbench-drawer-done"
          onClick={onClose}
          aria-label="关闭简历检查"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </header>

      <div className="resume-completeness-content">
        <section className="resume-completeness-summary" aria-labelledby="resume-completeness-summary-title">
          <div
            className={`resume-completeness-score is-${tone}`}
            style={{ "--resume-completeness-score": `${result.score * 3.6}deg` } as CSSProperties}
          >
            <output aria-label={`当前完整度 ${result.score} 分`}>
              <strong>{result.score}</strong>
              <span>/ 100</span>
            </output>
          </div>
          <span>
            <small id="resume-completeness-summary-title">当前完整度</small>
            <strong>{result.level}</strong>
            <span>{incompleteChecks.length > 0 ? `还有 ${incompleteChecks.length} 项可以完善` : "所有基础检查均已通过"}</span>
          </span>
        </section>

        {result.scoreCaps.length > 0 && (
          <section className="resume-completeness-caps" aria-label="分数限制说明">
            <AlertTriangle aria-hidden="true" />
            <span>
              <strong>检测到示例内容</strong>
              {result.scoreCaps.map((cap) => <span key={cap.id}>{cap.reason}</span>)}
            </span>
          </section>
        )}

        <section className="resume-completeness-section">
          <header>
            <h3>优先完善</h3>
            <span>{incompleteChecks.length} 项</span>
          </header>
          {incompleteChecks.length > 0 ? (
            <ul>
              {incompleteChecks.map((item) => <CompletenessCheckRow item={item} key={item.id} />)}
            </ul>
          ) : (
            <p className="resume-completeness-empty">基础内容已经齐全，可以继续优化表达质量。</p>
          )}
        </section>

        <details className="resume-completeness-passed" open={incompleteChecks.length === 0}>
          <summary>
            <span>已通过</span>
            <small>{passedChecks.length} 项</small>
          </summary>
          <ul>
            {passedChecks.map((item) => <CompletenessCheckRow item={item} key={item.id} />)}
          </ul>
        </details>

        <p className="resume-completeness-note">
          完整度检查基础信息、结构及技能表达的具体程度，不代表岗位匹配度。
        </p>
      </div>
    </div>
  );
}
