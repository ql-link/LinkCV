import { describe, expect, it } from "vitest";
import { isV4Report, reportView } from "./reportCompat";
import type { MockInterviewReportV4Raw } from "./mockInterviewTypes";

const v4: MockInterviewReportV4Raw = {
  rubric_version: "v4",
  answer_mode: "text",
  voice_metrics: null,
  headline: "接近中级标准",
  summary: "原理清楚，边界不足。",
  total_score: 68.5,
  question_average: 68.5,
  dimension_score: 68.5,
  verdict: { level: "borderline", target: "intermediate", core_hit_rate: 0.7, risk_flags: [], reasons: ["总分 69"] },
  competencies: [
    { key: "knowledge", assessed: true, score: 80, level: "strong", weight: 0.6, question_refs: [2], comment: "原理清楚" },
    { key: "problem_solving", assessed: false, score: null, level: null, weight: 0.1, question_refs: [2], comment: "" },
  ],
  dimensions: [{ key: "knowledge", score: 4.2, weight: 1, evidence: [], comment: "原理清楚" }],
  actions: [
    { title: "补齐故障边界", detail: "说明节点宕机后的补偿", priority: "high", kind: "practice", question_refs: [2], competency: "knowledge", resume_quote: null },
  ],
  improvements: ["补齐故障边界：说明节点宕机后的补偿"],
  resume_risks: [],
  questions: [
    {
      topic: "缓存一致性", sequence_no: 2, number: 1, skipped: false, score: 68.5, achieved_depth: 2,
      signals: [], highlights: [], weaknesses: [], reference_answer: "",
      factual_errors: [{ description: "把 TTL 说成强一致", severity: "major" }],
    },
  ],
  fact_check: { status: "not_requested", items: [] },
  off_topic_detected: false,
  low_confidence: false,
};

describe("reportView", () => {
  it("keeps the backend legacy fields and flattens v4 factual errors", () => {
    const view = reportView(v4)!;
    expect(isV4Report(v4)).toBe(true);
    expect(view.verdict?.level).toBe("borderline");
    expect(view.competencies).toHaveLength(2);
    expect(view.dimensions).toEqual(v4.dimensions);
    expect(view.improvements).toEqual(v4.improvements);
    expect(view.questions[0].factual_errors).toEqual(["把 TTL 说成强一致"]);
  });

  it("returns legacy reports unchanged", () => {
    const legacy = { ...v4, rubric_version: "v3" } as unknown as Parameters<typeof reportView>[0];
    expect(reportView(legacy)).toBe(legacy);
    expect(reportView(null)).toBeNull();
  });
});
