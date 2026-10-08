import type {
  InterviewReviewDimensionKey,
  InterviewReviewReport,
  InterviewReviewReportV2,
  InterviewReviewVerdictLevel,
  InterviewQuestionCategory,
} from "@/api/client";
import { t } from "@/i18n";

type AnyReport = InterviewReviewReport | InterviewReviewReportV2 | null | undefined;

export function isReportV2(report: AnyReport): report is InterviewReviewReportV2 {
  return report?.schema_version === 2;
}

/** 0–100 total for both report versions; v1 stored a 0–10 average. */
export function reviewScore100(report: AnyReport): number | null {
  if (!report) return null;
  if (isReportV2(report)) return report.total_score == null ? null : Math.round(report.total_score);
  return report.overall_score == null ? null : Math.round(report.overall_score * 10);
}

/** 0–10 scale used by the review list column. */
export function reviewScore10(report: AnyReport): number | null {
  const score = reviewScore100(report);
  return score == null ? null : Math.round(score) / 10;
}

export function reviewGrade(score: number | null): { label: string; tone: "green" | "orange" | "red" } | null {
  if (score == null) return null;
  if (score >= 85) return { label: t("优秀"), tone: "green" };
  if (score >= 70) return { label: t("良好"), tone: "green" };
  if (score >= 60) return { label: t("合格"), tone: "orange" };
  return { label: t("待提升"), tone: "red" };
}

export function dimensionLabel(key: InterviewReviewDimensionKey): string {
  const labels: Record<InterviewReviewDimensionKey, string> = {
    professional_depth: t("专业深度"),
    motivation_fit: t("动机与稳定性"),
    structure: t("表达结构"),
    job_fit: t("岗位匹配"),
    resume_consistency: t("经历可信度"),
    communication: t("沟通与应变"),
  };
  return labels[key];
}

export function categoryLabel(category: InterviewQuestionCategory): string {
  const labels: Record<InterviewQuestionCategory, string> = {
    technical: t("技术题"),
    project: t("项目题"),
    behavioral: t("行为题"),
    hr: t("HR 题"),
  };
  return labels[category];
}

export function verdictLabel(level: InterviewReviewVerdictLevel): { label: string; tone: "green" | "blue" | "orange" | "red" } {
  const labels: Record<InterviewReviewVerdictLevel, { label: string; tone: "green" | "blue" | "orange" | "red" }> = {
    likely_pass: { label: t("大概率通过"), tone: "green" },
    promising: { label: t("有希望通过"), tone: "blue" },
    at_risk: { label: t("存在风险"), tone: "orange" },
    likely_fail: { label: t("大概率未通过"), tone: "red" },
  };
  return labels[level];
}

export function confidenceLabel(confidence: "high" | "medium" | "low"): string {
  return confidence === "high" ? t("判断把握 高") : confidence === "medium" ? t("判断把握 中") : t("判断把握 低");
}

/** Short status line for lists and timeline rows. */
export function reviewStatusText(session: {
  review_stale?: boolean;
  review_status?: string | null;
  review_report?: AnyReport;
}): string {
  if (session.review_stale) return t("记录已修改，待重新生成");
  if (session.review_status === "generating") return t("正在生成…");
  if (session.review_report) {
    const score = reviewScore100(session.review_report);
    return score != null ? t("复盘 {value0}", { value0: score }) : t("已复盘");
  }
  return session.review_status === "failed" ? t("生成失败") : t("待复盘");
}

/** Points on a regular polygon for a 5-axis radar, values on a 0–5 scale. */
export function radarPoints(values: Array<number | null>, radius: number, center: number): string {
  return values
    .map((value, index) => {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / values.length;
      const r = ((value ?? 0) / 5) * radius;
      return `${(center + r * Math.cos(angle)).toFixed(1)},${(center + r * Math.sin(angle)).toFixed(1)}`;
    })
    .join(" ");
}
