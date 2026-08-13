import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { ResumeCreatePage } from "./ResumeCreatePage";

vi.mock("./TemplatePicker", () => ({
  TemplatePicker: ({ onSelect }: { onSelect: (template: object) => void }) => (
    <button
      type="button"
      onClick={() => onSelect({ id: "8", key: "modern-cn", name: "现代双栏" })}
    >
      选择现代双栏
    </button>
  ),
}));

describe("ResumeCreatePage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/resumes/new");
  });

  it("要求选择模板并把名称和字符串模板 ID 提交给创建契约", async () => {
    const createResume = vi.fn().mockResolvedValue("12");
    useResumeStore.setState({ createResume });
    window.history.replaceState(null, "", "/resumes/new");
    render(<ResumeCreatePage />);

    fireEvent.click(screen.getByRole("button", { name: "创建并开始编辑" }));
    expect(screen.getByText("请先选择一套简历模板。")).toBeInTheDocument();
    expect(createResume).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "选择现代双栏" }));
    fireEvent.change(screen.getByLabelText("简历名称"), {
      target: { value: "2026 产品经理简历" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建并开始编辑" }));

    await waitFor(() => {
      expect(createResume).toHaveBeenCalledWith("2026 产品经理简历", "8");
      expect(window.location.pathname).toBe("/resumes/12/edit");
    });
  });

  it("名称重复时留在新建页并显示明确错误", async () => {
    useResumeStore.setState({
      createResume: vi.fn().mockRejectedValue(
        new ApiRequestError(409, "RESUME_TITLE_CONFLICT"),
      ),
    });
    render(<ResumeCreatePage />);

    fireEvent.click(screen.getByRole("button", { name: "选择现代双栏" }));
    fireEvent.change(screen.getByLabelText("简历名称"), {
      target: { value: "重复名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建并开始编辑" }));

    expect(await screen.findByText("该名称已经存在，请换一个名称。")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/resumes/new");
  });
});
