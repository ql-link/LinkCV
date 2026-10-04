import { describe, expect, it } from "vitest";
import type { InterviewSessionSummary } from "../../api/client";
import { describeScheduleConflict, findScheduleConflicts } from "./scheduleConflicts";

const base = Date.parse("2026-10-09T06:00:00Z");
function session(id: string, company: string, stage: string, startMin: number, endMin: number, extra: Partial<InterviewSessionSummary> = {}) {
  return {
    id, company_name: company, stage_label: stage, status: "scheduled", schedule_kind: "fixed_slot",
    start_at: new Date(base + startMin * 60_000).toISOString(), end_at: new Date(base + endMin * 60_000).toISOString(),
    answer_plan_start_at: null, answer_plan_end_at: null, ...extra,
  } as InterviewSessionSummary;
}

describe("findScheduleConflicts", () => {
  const now = base - 86_400_000;
  it("finds overlapping upcoming sessions", () => {
    const conflicts = findScheduleConflicts([session("1", "示例阿里", "二面", 0, 60), session("2", "示例美团", "笔试", 30, 90), session("3", "示例快手", "一面", 120, 180)], now);
    expect(conflicts.map((item) => item.key)).toEqual(["1:2"]);
  });
  it("ignores touching, cancelled and past sessions", () => {
    expect(findScheduleConflicts([session("1", "A", "一面", 0, 60), session("2", "B", "一面", 60, 120)], now)).toEqual([]);
    expect(findScheduleConflicts([session("1", "A", "一面", 0, 60), session("2", "B", "一面", 30, 90, { status: "cancelled" })], now)).toEqual([]);
    expect(findScheduleConflicts([session("1", "A", "一面", 0, 60), session("2", "B", "一面", 30, 90)], base + 86_400_000)).toEqual([]);
  });
  it("uses the answer plan for open-window tests", () => {
    const openWindow = session("2", "B", "笔试", -600, 600, { schedule_kind: "open_window" });
    expect(findScheduleConflicts([session("1", "A", "一面", 0, 60), openWindow], now)).toEqual([]);
    const planned = { ...openWindow, answer_plan_start_at: new Date(base + 30 * 60_000).toISOString(), answer_plan_end_at: new Date(base + 90 * 60_000).toISOString() };
    expect(findScheduleConflicts([session("1", "A", "一面", 0, 60), planned], now)).toHaveLength(1);
  });
  it("describes the conflict like the design", () => {
    const [conflict] = findScheduleConflicts([session("1", "示例阿里", "二面", 0, 60), session("2", "示例美团", "笔试", 0, 60)], now);
    expect(describeScheduleConflict(conflict, "Asia/Shanghai")).toBe("10-09 14:00 示例阿里二面和示例美团笔试时间重叠。");
  });
});
