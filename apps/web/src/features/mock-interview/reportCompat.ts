// 评分规则 v4 报告到页面报告视图的适配。
// v4 去掉了整体维度分、改进建议与简历风险数组，改为能力项（0–100）与行动清单；
// 新报告页确认前，这里补齐旧页面读取的字段，同时把 v4 原始字段保留在 verdict / competencies / actions 上。
import type {
  MockCompetency,
  MockDimension,
  MockFactualError,
  MockInterviewDetail,
  MockInterviewReport,
  MockInterviewReportV4Raw,
  MockQuestionEvaluation,
} from "./mockInterviewTypes";

type RawEvaluation = Omit<MockQuestionEvaluation, "factual_errors"> & { factual_errors: Array<string | MockFactualError> };

export function isV4Report(report: unknown): report is MockInterviewReportV4Raw {
  return Boolean(report && typeof report === "object" && (report as { rubric_version?: unknown }).rubric_version === "v4");
}

function evaluationView<T extends RawEvaluation>(evaluation: T): T & { factual_errors: string[] } {
  return { ...evaluation, factual_errors: evaluation.factual_errors.map((item) => (typeof item === "string" ? item : item.description)) };
}

function dimensionView(item: MockCompetency): MockDimension {
  // 旧页面按 1–5 分画条形图；v4 能力分是 0–100。
  return { key: item.key, score: Math.round(((item.score ?? 0) / 20) * 10) / 10, weight: item.weight, evidence: "", comment: item.comment };
}

export function reportView(report: MockInterviewReport | MockInterviewReportV4Raw | null): MockInterviewReport | null {
  if (!report || !isV4Report(report)) return report;
  const actions = report.actions ?? [];
  const { dimensions, questions, ...rest } = report;
  return {
    ...rest,
    competencies: dimensions,
    dimensions: dimensions.filter((item) => item.assessed).map(dimensionView),
    questions: questions.map(evaluationView),
    question_average: report.total_score,
    dimension_score: 0,
    improvements: actions.filter((item) => item.kind !== "resume").map((item) => (item.detail ? `${item.title}：${item.detail}` : item.title)),
    resume_risks: actions.filter((item) => item.kind === "resume").map((item) => `${item.resume_quote ? `「${item.resume_quote}」` : ""}${item.title}${item.detail ? `：${item.detail}` : ""}`),
    practice_focus: [],
  };
}

export function detailView<T extends MockInterviewDetail>(detail: T): T {
  const raw = detail as unknown as { report: MockInterviewReport | MockInterviewReportV4Raw | null; questions: Array<{ evaluation: RawEvaluation | null }> };
  return {
    ...detail,
    report: reportView(raw.report),
    questions: detail.questions.map((question, index) => {
      const evaluation = raw.questions[index]?.evaluation;
      return evaluation ? { ...question, evaluation: evaluationView(evaluation) } : question;
    }),
  };
}

// 任意接口响应中出现的 mock_interview 详情都走同一个适配。
export function normalizeResponse<T>(value: T): T {
  if (value && typeof value === "object" && "mock_interview" in value) {
    const detail = (value as { mock_interview: unknown }).mock_interview;
    if (detail && typeof detail === "object" && "questions" in detail) {
      return { ...value, mock_interview: detailView(detail as MockInterviewDetail) } as T;
    }
  }
  return value;
}
