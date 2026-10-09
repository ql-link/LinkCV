// 评分规则 v4 报告到页面报告视图的适配。
// v4 报告仍带着 v1–v3 字段（维度 1–5 分、改进建议、简历风险），旧页面可以直接读取；
// 与视图不同的只有事实错误：v4 每条带严重度，旧页面按字符串展示。
import type {
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

export function reportView(report: MockInterviewReport | MockInterviewReportV4Raw | null): MockInterviewReport | null {
  if (!report || !isV4Report(report)) return report;
  return { ...report, questions: report.questions.map(evaluationView) };
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
