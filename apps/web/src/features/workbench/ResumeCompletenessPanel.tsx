import { t, useLocale } from "@/i18n";
import { useState } from "react";
import { Icon, type V3IconName } from "../../v3/Icon";
import type {
  ResumeCompletenessCheck,
  ResumeCompletenessResult,
  ResumeCompletenessStatus,
} from "./resumeCompleteness";
import { resumeCompletenessTone } from "./resumeCompleteness";
import { WorkbenchGauge, gaugeGeometry } from "./WorkbenchGauge";
import { WorkbenchPanelHeader } from "./WorkbenchPanelHeader";

const statusCopy: Record<ResumeCompletenessStatus, string> = {
  passed: "已通过",
  partial: "需完善",
  failed: "待补充",
};

const statusIcon: Record<ResumeCompletenessStatus, V3IconName> = {
  passed: "check",
  partial: "minus",
  failed: "alert",
};

// 检查卡片（Figma 509:855 · Check）：左侧 22 圆形状态标、标题 + 得分、右侧状态字，下方问题与建议
function CompletenessCheckRow({ item }: { item: ResumeCompletenessCheck }) {
  useLocale();
  return (
    <li className={`wb3-check-check is-${item.status}`}>
      <span className="wb3-check-check-icon" aria-hidden="true">
        <Icon name={statusIcon[item.status]} size={12} strokeWidth={2.2} />
      </span>
      <span className="wb3-check-check-copy">
        <span className="wb3-check-check-title">
          <strong>{item.label}</strong>
          <small>{item.earnedPoints}/{item.maxPoints}{t(" 分")}</small>
          <span className="wb3-check-status">{statusCopy[item.status]}</span>
        </span>
        {item.issue && <span className="wb3-check-issue">{item.issue}</span>}
        {item.recommendation && <em>{item.recommendation}</em>}
      </span>
    </li>
  );
}

// 02.2d 简历检查（Figma 509:855）：仪表盘居中，数字与「/ 100」在弧心，开口处等级胶囊，两端标 0 / 100
export function ResumeCompletenessPanel({
  result,
  onClose,
}: {
  result: ResumeCompletenessResult;
  onClose: () => void;
}) {
  useLocale();
  const incompleteChecks = result.checks.filter((item) => item.status !== "passed");
  const passedChecks = result.checks.filter((item) => item.status === "passed");
  const tone = resumeCompletenessTone(result.score);
  const [passedOpen, setPassedOpen] = useState(incompleteChecks.length === 0);
  const gauge = gaugeGeometry(false, 18);
  // 圆弧起点（150°）的坐标，用来摆放两端的 0 / 100
  const endX = gauge.r * Math.cos((150 * Math.PI) / 180);
  const endY = gauge.cy + gauge.r * Math.sin((150 * Math.PI) / 180);

  return (
    <div className="wb3-check-panel">
      <WorkbenchPanelHeader
        titleId="workbench-quality-title"
        title={t("简历检查")}
        subtitle={t("实时规则检查")}
        closeLabel={t("关闭简历检查")}
        onClose={onClose}
      />

      <div className="wb3-check-content">
        <section className="wb3-check-summary" aria-labelledby="wb3-check-summary-title">
          <div className={`wb3-check-score is-${tone}`} style={{ width: gauge.width, height: gauge.height }}>
            <WorkbenchGauge score={result.score} extra={18} />
            <output aria-label={t("当前完整度 {value0} 分", { value0: result.score })} style={{ top: gauge.cy - 42 }}>
              <strong>{result.score}</strong>
              <span>/ 100</span>
            </output>
            <span className="wb3-check-end is-min" style={{ top: endY + 10, left: gauge.cx + endX }} aria-hidden="true">0</span>
            <span className="wb3-check-end is-max" style={{ top: endY + 10, left: gauge.cx - endX }} aria-hidden="true">100</span>
            <span className="wb3-check-level" style={{ top: gauge.cy + 30 }}>{result.level}</span>
          </div>
          <p id="wb3-check-summary-title">{t("当前完整度 · ")}{incompleteChecks.length > 0 ? t("还有 {value0} 项可以完善", { value0: incompleteChecks.length }) : t("所有基础检查均已通过")}
          </p>
        </section>

        {result.scoreCaps.length > 0 && (
          <section className="wb3-check-caps" aria-label={t("分数限制说明")}>
            <Icon name="alert" size={14} />
            <span>
              <strong>{t("检测到示例内容")}</strong>
              {result.scoreCaps.map((cap) => <span key={cap.id}>{cap.reason}</span>)}
            </span>
          </section>
        )}

        <section className="wb3-check-section">
          <header>
            <h3>{t("优先完善")}</h3>
            <span>{incompleteChecks.length}{t(" 项")}</span>
          </header>
          {incompleteChecks.length > 0 ? (
            <ul>
              {incompleteChecks.map((item) => <CompletenessCheckRow item={item} key={item.id} />)}
            </ul>
          ) : (
            <p className="wb3-check-empty">{t("基础内容已经齐全，可以继续优化表达质量。")}</p>
          )}
        </section>

        <details
          className="wb3-check-passed"
          open={passedOpen}
          onToggle={(event) => setPassedOpen((event.currentTarget as HTMLDetailsElement).open)}
        >
          <summary>
            <Icon name="chev" size={14} className="wb3-check-passed-chev" />
            <span>{t("已通过")}</span>
            <small>{passedChecks.length}{t(" 项")}</small>
          </summary>
          <ul>
            {passedChecks.map((item) => <CompletenessCheckRow item={item} key={item.id} />)}
          </ul>
        </details>

        <p className="wb3-check-note">{t("完整度检查基础信息、结构及技能表达的具体程度，不代表岗位匹配度。")}</p>
      </div>
    </div>
  );
}
