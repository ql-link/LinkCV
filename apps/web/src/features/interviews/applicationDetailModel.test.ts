import { describe, expect, it } from "vitest";
import type { ApplicationStageRecord, InterviewSessionSummary, JobApplicationSummary } from "@/api/client";
import { buildApplicationDetail, effectiveSessionStatus } from "./applicationDetailModel";

const NOW = new Date("2026-10-06T12:00:00+08:00");

function stage(overrides: Partial<ApplicationStageRecord>): ApplicationStageRecord {
  return {
    id: "stage-1",
    application_id: "app-1",
    client_request_id: "request-1",
    stage_type: "screening",
    stage_label: "筛选中",
    interview_round_no: null,
    sequence_no: 1,
    stage_status: "active",
    stage_result: "pending",
    current_marker: 1,
    entered_at: "2026-09-28T09:00:00+08:00",
    completed_at: null,
    created_at: "2026-09-28T09:00:00+08:00",
    updated_at: "2026-09-28T09:00:00+08:00",
    ...overrides,
  };
}

function application(overrides: Partial<JobApplicationSummary> = {}): JobApplicationSummary {
  const stages = overrides.stages ?? [stage({})];
  return {
    id: "app-1",
    job_description_id: "job-1",
    company_name_snapshot: "示例科技",
    job_title_snapshot: "后端开发工程师",
    job_snapshot: {},
    resume_title_snapshot: "示例简历",
    calendar_color: "blue",
    current_stage_type: "screening",
    current_round_no: null,
    current_stage_label: "筛选中",
    stage_state: "awaiting_result",
    status: "active",
    phase: "applied",
    lifecycle_status: "active",
    terminated_at: null,
    termination_reason: null,
    offer_status: "none",
    offer_base_location: null,
    offer_salary: null,
    offer_salary_currency: null,
    offer_salary_period: null,
    offer_benefits_description: null,
    is_favorite: false,
    applied_at: "2026-09-28T09:00:00+08:00",
    notes: null,
    archived_at: null,
    lock_version: 3,
    created_at: "2026-09-25T09:00:00+08:00",
    updated_at: "2026-09-28T09:00:00+08:00",
    next_session_id: null,
    next_session_start_at: null,
    next_session_end_at: null,
    next_session_mode: null,
    stages,
    current_stage: stages.find((item) => item.current_marker === 1) ?? null,
    ...overrides,
  };
}

function session(overrides: Partial<InterviewSessionSummary>): InterviewSessionSummary {
  return {
    id: "session-1",
    application_id: "app-1",
    application_stage_id: "stage-2",
    client_request_id: "session-request-1",
    stage_type: "interview",
    round_no: 1,
    stage_label: "一面",
    status: "scheduled",
    round_result: "pending",
    start_at: "2026-10-08T14:00:00+08:00",
    end_at: "2026-10-08T15:00:00+08:00",
    schedule_kind: "fixed_slot",
    answer_plan_start_at: null,
    answer_plan_end_at: null,
    timezone: "Asia/Shanghai",
    mode: "video",
    meeting_url: null,
    location: null,
    interviewer_name: "李老师",
    interviewer_title: null,
    reminder_minutes: null,
    preparation_note: null,
    questions_markdown: null,
    review_summary: null,
    improvement_markdown: null,
    prep_items: [],
    prep_generated_at: null,
    prep_total: 0,
    prep_done: 0,
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    lock_version: 1,
    created_at: "2026-10-01T09:00:00+08:00",
    updated_at: "2026-10-01T09:00:00+08:00",
    company_name: "示例科技",
    job_title: "后端开发工程师",
    calendar_color: "blue",
    application_stage_state: "scheduled",
    ...overrides,
  };
}

const interviewStages = [
  stage({ id: "stage-1", stage_status: "completed", stage_result: "passed", current_marker: null, completed_at: "2026-09-30T09:00:00+08:00" }),
  stage({ id: "stage-2", stage_type: "interview", stage_label: "一面", interview_round_no: 1, sequence_no: 2, entered_at: "2026-10-01T09:00:00+08:00" }),
];

function interviewApplication(overrides: Partial<JobApplicationSummary> = {}) {
  return application({
    stages: interviewStages,
    current_stage: interviewStages[1],
    current_stage_type: "interview",
    current_round_no: 1,
    current_stage_label: "一面",
    stage_state: "scheduled",
    ...overrides,
  });
}

describe("buildApplicationDetail", () => {
  it("treats an elapsed scheduled session as completed", () => {
    expect(effectiveSessionStatus(session({ end_at: "2026-10-06T11:00:00+08:00" }), NOW)).toBe("completed");
    expect(effectiveSessionStatus(session({}), NOW)).toBe("scheduled");
    expect(effectiveSessionStatus(session({ status: "cancelled", end_at: "2026-10-01T11:00:00+08:00" }), NOW)).toBe("cancelled");
  });

  it("asks a pending application to record the delivery", () => {
    const model = buildApplicationDetail(application({ applied_at: null, phase: "pending", stages: [], current_stage: null, current_stage_label: "待投递" }), [], NOW);
    expect(model.pending).toBe(true);
    expect(model.next.primary).toMatchObject({ action: "record-applied", label: "记录投递" });
    expect(model.steps.map((step) => step.label)).toEqual(["待投递", "筛选中", "笔试 / 测评", "面试", "Offer"]);
    expect(model.history).toEqual([]);
  });

  it("offers no manual completion while an interview is scheduled", () => {
    const model = buildApplicationDetail(interviewApplication(), [session({})], NOW);
    expect(model.next.primary).toMatchObject({ action: "record-review", label: "记录与复盘" });
    expect(model.next.secondary).toEqual([]);
    expect(JSON.stringify(model.next)).not.toContain("标记已完成");
    expect(model.next.hint).toContain("自动进入「等待结果」");
    expect(model.next.chips.map((chip) => chip.label)).toEqual(["一面", "已安排", "还有 2 天"]);
  });

  it("labels a passed screening step as finished", () => {
    const model = buildApplicationDetail(interviewApplication(), [session({})], NOW);
    expect(model.steps.map((step) => step.label)).toEqual(["已投递", "筛选", "一面", "下一阶段"]);
  });

  it("moves to waiting for a result once the interview end time passes", () => {
    const elapsed = session({ start_at: "2026-10-06T09:00:00+08:00", end_at: "2026-10-06T10:00:00+08:00" });
    const model = buildApplicationDetail(interviewApplication(), [elapsed], NOW);
    expect(model.next.title).toBe("一面已结束，等待面试结果");
    expect(model.next.primary).toMatchObject({ action: "advance", label: "通过，添加下一轮" });
    expect(model.history[0].chip).toEqual({ label: "等待结果", tone: "orange" });
  });

  it("uses the answer plan as the open-window primary action", () => {
    const writtenStages = [
      interviewStages[0],
      stage({ id: "stage-2", stage_type: "written_test", stage_label: "技术笔试", sequence_no: 2 }),
    ];
    const model = buildApplicationDetail(
      application({ stages: writtenStages, current_stage: writtenStages[1], current_stage_label: "技术笔试", stage_state: "scheduled" }),
      [session({ stage_type: "other", round_no: null, stage_label: "技术笔试", schedule_kind: "open_window", start_at: new Date(2026, 9, 3, 9, 0).toISOString(), end_at: new Date(2026, 9, 7, 23, 59).toISOString() })],
      NOW,
    );
    expect(model.next.primary).toMatchObject({ action: "answer-plan", label: "作答计划" });
    expect(model.next.tile).toMatchObject({ kind: "date", day: "7", foot: "23:59" });
    expect(model.next.chips.map((chip) => chip.label)).toContain("截止前完成");
  });

  it("asks to schedule a stage that is waiting for a time", () => {
    const model = buildApplicationDetail(interviewApplication({ stage_state: "awaiting_schedule" }), [], NOW);
    expect(model.next.primary).toMatchObject({ action: "schedule", label: "安排一面时间" });
  });

  it("lets the user decide on a received offer", () => {
    const offerStages = [...interviewStages.map((item) => ({ ...item, stage_status: "completed" as const, stage_result: "passed" as const, current_marker: null })), stage({ id: "stage-3", stage_type: "offer", stage_label: "Offer", sequence_no: 3 })];
    const model = buildApplicationDetail(
      application({ stages: offerStages, current_stage: offerStages[2], current_stage_type: "offer", current_stage_label: "Offer", stage_state: "negotiating", offer_status: "received", offer_base_location: "北京" }),
      [],
      NOW,
    );
    expect(model.next.primary).toMatchObject({ action: "accept-offer", label: "接受 Offer" });
    expect(model.next.secondary).toEqual([{ action: "edit-offer", label: "修改 Offer 信息" }, { action: "decline-offer", label: "婉拒", danger: true }]);
    expect(model.offerCard?.title).toBe("Offer 信息");
    expect(model.steps[model.steps.length - 1]).toMatchObject({ label: "Offer", state: "offer" });
  });

  it.each([
    ["2026-10-08", "还有 2 天回复", "orange"],
    ["2026-10-06", "今天截止", "orange"],
    ["2026-10-04", "回复截止已过 2 天", "red"],
    [null, "待你决定", "orange"],
  ] as const)("counts down to the Offer reply date %s", (replyDueOn, label, tone) => {
    const offerStage = stage({ id: "stage-3", stage_type: "offer", stage_label: "Offer", sequence_no: 3 });
    const model = buildApplicationDetail(application({
      stages: [interviewStages[0], offerStage],
      current_stage: offerStage,
      current_stage_type: "offer",
      current_stage_label: "Offer",
      stage_state: "negotiating",
      offer_status: "received",
      offer_received_on: "2026-10-01",
      offer_reply_due_on: replyDueOn,
      offer_start_on: "2026-11-01",
      offer_probation: "3 个月",
    }), [], NOW);
    expect(model.next.chips[2]).toEqual({ label, tone });
    expect(model.offerCard?.rows.map((row) => row.label)).toEqual(expect.arrayContaining(["收到日期", "预计入职", "试用期"]));
    expect(model.steps[model.steps.length - 1].meta).toBe("10.01 · 已收到");
  });

  it("shows the real preparation progress of a scheduled interview", () => {
    const model = buildApplicationDetail(interviewApplication(), [session({ prep_total: 5, prep_done: 1 })], NOW);
    expect(model.next.chips.map((chip) => chip.label)).toContain("准备清单 1/5");
    const empty = buildApplicationDetail(interviewApplication(), [session({ prep_total: 0, prep_done: 0 })], NOW);
    expect(empty.next.chips.map((chip) => chip.label).join()).not.toContain("准备清单");
  });

  it("shows saved review scores on finished interviews", () => {
    const report = { schema_version: 1, source_hash: "hash", generated_at: "2026-10-03T00:00:00Z", summary: "示例报告", overall_score: 8,
      project_expression: { score: null, reason: "记录不足", evidence: null }, system_design: { score: null, reason: "记录不足", evidence: null }, communication: { score: null, reason: "记录不足", evidence: null }, questions: [] };
    const finished = session({ start_at: "2026-10-05T09:00:00+08:00", end_at: "2026-10-05T10:00:00+08:00", review_report: report } as Partial<InterviewSessionSummary>);
    const model = buildApplicationDetail(interviewApplication(), [finished], NOW);
    expect(model.history[0].detail).toContain("复盘 8");
  });

  it("treats HR 面 as a scheduled conversation with its own label", () => {
    const hrStages = [interviewStages[0], stage({ id: "stage-hr", stage_type: "hr", stage_label: "HR 面", sequence_no: 2 })];
    const model = buildApplicationDetail(application({
      stages: hrStages, current_stage: hrStages[1], current_stage_type: "hr", current_stage_label: "HR 面", stage_state: "scheduled",
    }), [session({ application_stage_id: "stage-hr", stage_type: "hr", round_no: null, stage_label: "HR 面" })], NOW);
    expect(model.next.title).toBe("HR 面");
    expect(model.next.hint).toContain("HR 面结束");
    expect(model.steps.map((step) => step.label)).toContain("HR 面");
  });

  it("shows OC details and asks for the formal offer as a new stage", () => {
    const ocStage = stage({ id: "stage-oc", stage_type: "oc", stage_label: "OC", sequence_no: 2 });
    const model = buildApplicationDetail(application({
      stages: [interviewStages[0], ocStage], current_stage: ocStage, current_stage_type: "offer", current_stage_label: "OC",
      stage_state: "negotiating", oc_communicated_at: "2026-10-05T07:00:00Z", oc_salary_text: "35K × 16 薪", oc_start_text: "11 月上旬",
    }), [], NOW);
    expect(model.verbalOffer).toBe(true);
    expect(model.next.primary).toMatchObject({ action: "record-offer", label: "记录正式 Offer" });
    expect(model.next.detail).toContain("口头薪酬 35K × 16 薪");
    expect(model.offerCard?.rows.map((row) => row.label)).toEqual(["沟通时间", "口头薪酬", "预计到岗", "Offer 状态"]);
    expect(model.history[0]).toMatchObject({ title: "OC · 口头意向", chip: { label: "待正式 Offer", tone: "blue" } });
  });

  it("uses the recorded channel for the delivery", () => {
    const model = buildApplicationDetail(interviewApplication({ applied_channel: "同事内推" }), [session({})], NOW);
    expect(model.deliveryRows[1]).toEqual({ label: "投递渠道", value: "同事内推" });
  });

  it("summarises a rejected application and links to the review", () => {
    const rejectedStages = [interviewStages[0], { ...interviewStages[1], stage_status: "completed" as const, stage_result: "rejected" as const, current_marker: null }];
    const model = buildApplicationDetail(
      application({ stages: rejectedStages, current_stage: null, status: "rejected", lifecycle_status: "terminated", termination_reason: "company_rejected", terminated_at: "2026-10-09T10:00:00+08:00" }),
      [],
      NOW,
    );
    expect(model.ended).toBe(true);
    expect(model.next.title).toBe("流程已结束：一面未通过");
    expect(model.next.primary).toMatchObject({ action: "view-review", variant: "outline" });
    expect(model.steps[model.steps.length - 1]).toMatchObject({ label: "一面", state: "failed" });
  });
});
