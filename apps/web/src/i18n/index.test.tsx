import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { formatDate, getLocale, setLocale, t, useLocale, weekdayName } from "./index";
import { INTERVIEW_TYPE_LABELS, mockInterviewApi, resetMockInterviewStore } from "../features/mock-interview/mockInterviewApi";
import { applicationProgressToneClass, applicationScheduleStatusLabel } from "../features/interviews/applicationProgress";

function Example({ authored }: { authored: string }) {
  useLocale();
  return <><button>{t("我的简历")}</button><p>{authored}</p><label>{INTERVIEW_TYPE_LABELS.technical}</label></>;
}
afterEach(() => { setLocale("zh-CN"); resetMockInterviewStore(false); });
describe("ordinary workspace language", () => {
  it("changes mounted UI and static options without changing authored text", () => {
    setLocale("zh-CN");
    render(<Example authored="我的简历" />);
    act(() => setLocale("en-US"));
    expect(screen.getByRole("button", { name: "My resumes" })).toBeInTheDocument();
    expect(screen.getByText("我的简历")).toBeInTheDocument();
    expect(screen.getByText("Technical")).toBeInTheDocument();
    expect(localStorage.getItem("linkresume.interface-locale")).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
  });
  it("uses the selected locale for dates and weekday names", () => {
    setLocale("en-US");
    expect(formatDate(new Date(2026, 9, 2))).toBe("Oct 2, 2026");
    expect(weekdayName(5)).toBe("Fri");
    setLocale("zh-CN");
    expect(weekdayName(5)).toBe("周五");
  });
  it("does not rewrite interview questions, answers, or the answer-language setting", async () => {
    setLocale("en-US"); resetMockInterviewStore(true);
    const result = await mockInterviewApi.list();
    const detail = await mockInterviewApi.get(result.items.find((item) => item.status === "completed")!.id);
    expect(detail.mock_interview.language).toBe("zh");
    expect(detail.mock_interview.questions[0].content).toContain("你在简历里写了");
    expect(detail.mock_interview.report?.summary).toContain("你对调度平台");
  });
  it("preserves status behavior when schedule labels are translated", () => {
    setLocale("en-US");
    const item = { current_stage_type: "interview", current_stage_label: "自定义面试", current_stage: null, stage_state: "scheduled", status: "active", offer_status: "none", archived_at: null, applied_at: "2026-10-01", phase: "applied", lifecycle_status: "active", termination_reason: null, next_session_start_at: "2026-10-02T10:00:00Z", next_session_end_at: "2026-10-02T11:00:00Z" } as Parameters<typeof applicationProgressToneClass>[0];
    const options = { now: new Date("2026-10-02T12:00:00Z") };
    expect(applicationScheduleStatusLabel(item, options)).toBe("Awaiting result");
    expect(applicationProgressToneClass(item, options)).toBe("is-waiting");
    expect(getLocale()).toBe("en-US");
  });
});
