import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultResumeMarkdown } from "../../parser/defaultResume";
import { evaluateResumeCompleteness } from "./resumeCompleteness";
import { ResumeCompletenessPanel } from "./ResumeCompletenessPanel";

describe("ResumeCompletenessPanel", () => {
  it("解释示例内容封顶，并显示待完善建议", () => {
    render(<ResumeCompletenessPanel result={evaluateResumeCompleteness(defaultResumeMarkdown)} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "简历检查" })).toBeInTheDocument();
    expect(screen.getByLabelText("当前完整度 20 分")).toBeInTheDocument();
    expect(screen.getByText("检测到示例内容")).toBeInTheDocument();
    expect(screen.getByText("姓名仍是系统示例内容。")).toBeInTheDocument();
    expect(screen.getByText("实时规则检查")).toBeInTheDocument();
    expect(screen.queryByText(/不使用 AI/u)).not.toBeInTheDocument();
    expect(screen.getByLabelText("当前完整度 20 分").closest(".resume-completeness-score")).toHaveClass("is-low");
    expect(screen.getByText("完整度检查基础信息、结构及技能表达的具体程度，不代表岗位匹配度。")).toBeInTheDocument();
  });

  it("允许关闭检查面板", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ResumeCompletenessPanel result={evaluateResumeCompleteness("")} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "关闭简历检查" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
