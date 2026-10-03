import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InterviewReviewReportV2, InterviewSessionRecord } from "@/api/client";
import { ReviewReportV2Body } from "./ReviewReportV2";
import { radarPoints, reviewScore100, reviewStatusText } from "./reviewReport";

const mocks = vi.hoisted(() => ({ saveInterviewReviewNote: vi.fn(), deleteInterviewReviewNote: vi.fn() }));
vi.mock("@/api/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/api/client")>();
  return { ...original, api: mocks };
});

const report: InterviewReviewReportV2 = {
  schema_version: 2,
  rubric_version: "real-v1",
  source_hash: "0".repeat(64),
  generated_at: "2026-10-03T08:00:00Z",
  headline: "项目讲得清楚，一致性方案需要更完整",
  summary: "整体表现良好。",
  verdict: {
    level: "promising", confidence: "medium", confidence_reason: null,
    signals: [{ polarity: "positive", quote: "你什么时候可以到岗", meaning: "询问到岗时间" }],
    adjusted_by_signals: 0, fatal_questions: 0,
  },
  total_score: 74.6, grade: "good", question_average: 70.8, dimension_score: 83.3,
  first_axis: "professional_depth",
  category_counts: { technical: 2, project: 1 },
  dimensions: [
    { key: "professional_depth", assessed: true, score: 4, weight: 0.4, evidence: "先更新数据库再删除缓存", comment: "讲清了顺序" },
    { key: "structure", assessed: true, score: 4, weight: 0.25, evidence: "我负责示例系统", comment: null },
    { key: "job_fit", assessed: true, score: 5, weight: 0.2, evidence: "后端系统", comment: null },
    { key: "resume_consistency", assessed: false, score: null, weight: 0, evidence: null, comment: null },
    { key: "communication", assessed: true, score: 3, weight: 0.15, evidence: "一个月内", comment: null },
  ],
  questions: [
    {
      index: 1, key: "a".repeat(64), question: "请介绍缓存改造项目", answer: "我负责示例系统的缓存改造", category: "project",
      answer_status: "answered", follow_ups: 1, expected_depth: 3, achieved_depth: 3, score: 50,
      signals: [{ signal: "给出量化结果", verdict: "miss", quote: null }, { signal: "说明个人动作", verdict: "hit", quote: "我负责示例系统" }],
      factual_errors: [], resume_conflict: null, strength: "结构清楚", improvement: "补充数据", suggested_answer: "先给结论",
      evidence_snippets: [{ dataset_id: "9", title: "缓存复盘.md", text: "延迟从 120ms 降到 60ms" }],
    },
    {
      index: 2, key: "b".repeat(64), question: "缓存不一致怎么办", answer: null, category: "technical",
      answer_status: "missing", follow_ups: 0, expected_depth: 3, achieved_depth: null, score: null,
      signals: [], factual_errors: [], resume_conflict: null, strength: null, improvement: null, suggested_answer: null,
      evidence_snippets: [],
    },
  ],
  improvements: [{ title: "量化项目收益", detail: "补充上线前后的数据。", priority: "key", dimension: "structure", question_indexes: [1] }],
  basis: { transcript_source: "transcription", transcript_chars: 4000, resume_title: null, has_job: true, material_snippets: 1, material_mode: "rag", downgraded_quotes: 1, dropped_questions: 0 },
};

const session = {
  id: "31",
  lock_version: 3,
  review_question_notes: [
    { id: "n1", question_key: "c".repeat(64), question_text: "已经不在报告里的题", verdict: null, note: "旧笔记", lock_version: 1, updated_at: "2026-10-03T08:00:00Z" },
  ],
} as unknown as InterviewSessionRecord;

function renderBody(onNotesChanged = vi.fn(), onSelect = vi.fn(), selected = 0) {
  render(<ReviewReportV2Body session={session} report={report} selected={selected} onSelect={onSelect} questionActions={null} archived={false} onNotesChanged={onNotesChanged} />);
  return { onNotesChanged, onSelect };
}

describe("ReviewReportV2Body", () => {
  it("shows the verdict, total, radar and unassessed dimensions", () => {
    renderBody();
    const verdict = screen.getByRole("region", { name: "结果判断" });
    expect(within(verdict).getByText("有希望通过")).toBeInTheDocument();
    expect(within(verdict).getByText("判断把握 中")).toBeInTheDocument();
    expect(within(verdict).getByText("询问到岗时间")).toBeInTheDocument();
    expect(screen.getByText("75")).toBeInTheDocument();
    expect(screen.getByText("题目 70.8 × 70% + 维度 83.3 × 30%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "能力雷达" })).toBeInTheDocument();
    expect(screen.getByText("没有关联简历，不评这一项")).toBeInTheDocument();
    expect(screen.getByText(/1–5 分 · 权重按本场 2 技术题、1 项目题 计算/)).toBeInTheDocument();
    expect(screen.getByText("无法评估")).toBeInTheDocument();
    expect(screen.getByText("延迟从 120ms 降到 60ms")).toBeInTheDocument();
    expect(screen.getByText(/资料库片段 1 段/)).toBeInTheDocument();
  });

  it("saves a per-question note and lists notes whose question disappeared", async () => {
    const saved = { id: "n2", question_key: "a".repeat(64), question_text: "请介绍缓存改造项目", verdict: "improve", note: "要带数字", lock_version: 1, updated_at: "2026-10-03T09:00:00Z" };
    mocks.saveInterviewReviewNote.mockResolvedValue({ note: saved });
    const { onNotesChanged } = renderBody();
    expect(screen.getByRole("region", { name: /未匹配的笔记/ })).toHaveTextContent("已经不在报告里的题");
    fireEvent.change(screen.getByRole("textbox", { name: "复盘笔记内容" }), { target: { value: "要带数字" } });
    fireEvent.click(screen.getByRole("button", { name: "保存笔记" }));
    await waitFor(() => expect(mocks.saveInterviewReviewNote).toHaveBeenCalledWith("31", {
      question_text: "请介绍缓存改造项目", verdict: null, note: "要带数字", lock_version: null,
    }));
    await waitFor(() => expect(onNotesChanged).toHaveBeenCalledWith([session.review_question_notes![0], saved]));
  });

  it("jumps to the source question of a suggestion", () => {
    const { onSelect } = renderBody(vi.fn(), vi.fn(), 1);
    expect(screen.getByText("文字稿里没有找到这道题的回答，不计入得分")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Q1" }));
    expect(onSelect).toHaveBeenCalledWith(0);
  });
});

describe("review report helpers", () => {
  it("reads both report versions on a 100-point scale", () => {
    expect(reviewScore100(report)).toBe(75);
    expect(reviewScore100({ schema_version: 1, overall_score: 7.6 } as never)).toBe(76);
    expect(reviewStatusText({ review_report: report })).toBe("复盘 75");
    expect(reviewStatusText({ review_stale: true, review_report: report })).toBe("记录已修改，待重新生成");
  });

  it("places radar points clockwise from the top", () => {
    expect(radarPoints([5, 0, 0, 0, 0], 10, 50).split(" ")[0]).toBe("50.0,40.0");
  });
});
