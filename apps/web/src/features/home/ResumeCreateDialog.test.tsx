import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, api } from "../../api/client";
import { useResumeStore } from "../../store/resumeStore";
import { ResumeCreateDialog } from "./ResumeCreateDialog";

vi.mock("../preview/ResumePreview", () => ({
  ResumePreview: () => <div data-testid="resume-preview" />,
}));

const templates = [
  { id: "8", key: "classic-cn", name: "经典专业", description: null, data: {}, style: {} },
  { id: "9", key: "modern-cn", name: "现代简约", description: null, data: {}, style: {} },
  { id: "10", key: "technical-cn", name: "技术极简", description: null, data: {}, style: {} },
];

describe("ResumeCreateDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/resumes");
  });

  it("在当前页选择模板并创建后进入编辑器", async () => {
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates } as never);
    const createResume = vi.fn().mockResolvedValue("12");
    useResumeStore.setState({ createResume });
    const onClose = vi.fn();
    render(<ResumeCreateDialog onClose={onClose} />);

    const dialog = await screen.findByRole("dialog", { name: "新建简历" });
    expect(within(dialog).queryByText("导入简历")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("option", { name: "经典专业，已选择" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(within(dialog).getByRole("button", { name: "下一个模板" }));
    expect(within(dialog).getByRole("option", { name: "现代简约，已选择" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByRole("status", { name: "当前模板位置" })).toHaveTextContent("2 / 3");

    fireEvent.change(within(dialog).getByLabelText("简历名称"), {
      target: { value: "  2026 产品经理简历  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并进入编辑器" }));

    await waitFor(() => {
      expect(createResume).toHaveBeenCalledWith("2026 产品经理简历", "9");
      expect(window.location.pathname).toBe("/resumes/12/edit");
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("支持左右方向键切换模板", async () => {
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates } as never);
    render(<ResumeCreateDialog onClose={vi.fn()} />);

    const listbox = await screen.findByRole("listbox", { name: "选择简历模板" });
    listbox.focus();
    fireEvent.keyDown(listbox, { key: "ArrowLeft" });

    expect(screen.getByRole("option", { name: "技术极简，已选择" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status", { name: "当前模板位置" })).toHaveTextContent("3 / 3");

    fireEvent.keyDown(listbox, { key: "ArrowLeft" });
    fireEvent.keyDown(listbox, { key: "ArrowLeft" });
    expect(screen.getByRole("option", { name: "经典专业，已选择" })).toHaveAttribute("aria-selected", "true");
    expect(listbox).toHaveFocus();
  });

  it("名称为空时阻止提交并把错误放在弹窗内", async () => {
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates } as never);
    const createResume = vi.fn();
    useResumeStore.setState({ createResume });
    render(<ResumeCreateDialog onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: "新建简历" });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并进入编辑器" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("请输入简历名称。");
    expect(createResume).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("简历名称")).toHaveFocus();
  });

  it("名称冲突时保留弹窗并显示契约错误", async () => {
    vi.spyOn(api, "listResumeTemplates").mockResolvedValue({ templates } as never);
    useResumeStore.setState({
      createResume: vi.fn().mockRejectedValue(new ApiRequestError(409, "RESUME_TITLE_CONFLICT")),
    });
    render(<ResumeCreateDialog onClose={vi.fn()} />);

    const dialog = await screen.findByRole("dialog", { name: "新建简历" });
    fireEvent.change(within(dialog).getByLabelText("简历名称"), { target: { value: "重复名称" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建并进入编辑器" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("该名称已经存在，请换一个名称。");
    expect(dialog).toBeInTheDocument();
    expect(window.location.pathname).toBe("/resumes");
  });

  it("模板加载失败时提供重试且禁用创建", async () => {
    const listTemplates = vi.spyOn(api, "listResumeTemplates")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ templates } as never);
    render(<ResumeCreateDialog onClose={vi.fn()} />);

    expect(await screen.findByText("模板暂时无法加载，请检查网络后重试。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建并进入编辑器" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));

    expect(await screen.findByRole("option", { name: "经典专业，已选择" })).toBeInTheDocument();
    expect(listTemplates).toHaveBeenCalledTimes(2);
  });
});
