import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewListV3 } from "./ReviewListV3";
const item = { id: "1", applicationId: "1", company: "示例公司", role: "工程师", stage: "一面", mode: "视频", startAt: "2026-10-01T00:00:00Z", endAt: "2026-10-01T01:00:00Z", status: "completed", improvement: "", review: "" };
describe("real review scores", () => {
  it("does not show a sample score or average for completed interviews without a report", () => {
    render(<ReviewListV3 interviews={[item]} />);
    expect(screen.queryByText(/平均/)).not.toBeInTheDocument();
    expect(screen.getByText("上传记录后生成复盘")).toBeInTheDocument();
    expect(screen.queryByText("需后端")).not.toBeInTheDocument();
    expect(screen.getByText("保存文字记录后生成 AI 复盘；录音转写后续提供。")).toBeInTheDocument();
    expect(screen.queryByText(/自动生成复盘/)).not.toBeInTheDocument();
  });
  it("averages only the actual available scores", () => {
    render(<ReviewListV3 interviews={[{ ...item, reviewScore: 6.5 }, { ...item, id: "2", company: "另一公司", reviewScore: null }]} />);
    expect(screen.getByText(/平均 6.5 分/)).toBeInTheDocument();
    expect(screen.getByText("6.5")).toBeInTheDocument();
  });
});
