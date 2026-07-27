import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, type ResumeSummary } from "../../api/client";
import { HomeScreen } from "./HomePage";

const resumes: ResumeSummary[] = [
  { id: "1", title: "Frontend Resume", source_type: "blank", lock_version: 1, created_at: "2026-07-20T08:00:00Z", updated_at: "2026-07-24T08:00:00Z" },
  { id: "2", title: "产品经理", source_type: "blank", lock_version: 1, created_at: "2026-07-20T08:00:00Z", updated_at: "2026-07-23T08:00:00Z" },
];

function renderHome(overrides: Partial<React.ComponentProps<typeof HomeScreen>> = {}) {
  const props: React.ComponentProps<typeof HomeScreen> = {
    email: "zhangsan@example.com",
    resumes,
    onOpen: vi.fn(),
    onDelete: vi.fn(),
    onCreate: vi.fn(),
    onImport: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
  };
  return { ...render(<HomeScreen {...props} />), props };
}

describe("HomeScreen", () => {
  afterEach(() => vi.restoreAllMocks());

  it("按标题即时过滤且忽略大小写", () => {
    renderHome();

    fireEvent.change(screen.getByRole("textbox", { name: "搜索简历" }), { target: { value: "frontend" } });

    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
    expect(screen.queryByText("产品经理")).not.toBeInTheDocument();
  });

  it("切换模板后隐藏搜索并在确认后通过标准模板创建简历", async () => {
    const onCreate = vi.fn();
    renderHome({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: "模板" }));

    expect(screen.queryByRole("textbox", { name: "搜索简历" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /标准简历模板/ }));

    expect(screen.getByRole("dialog", { name: "使用「标准简历模板」创建简历？" })).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "使用模板创建" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  });

  it("每次从模板创建都显示确认，也可以取消", () => {
    const onCreate = vi.fn();
    renderHome({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: "模板" }));
    fireEvent.click(screen.getByRole("button", { name: /标准简历模板/ }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /标准简历模板/ }));
    expect(screen.getByRole("dialog", { name: "使用「标准简历模板」创建简历？" })).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("普通创建达到数量上限时显示明确提示", async () => {
    const onCreate = vi.fn().mockRejectedValue(new ApiRequestError(409, "RESUME_LIMIT_REACHED"));
    renderHome({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: "新建简历" }));

    await waitFor(() => {
      expect(screen.getByText("每个账号最多保存 10 份简历，请先删除一份后再创建。")).toBeInTheDocument();
    });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("模板创建达到数量上限时关闭确认并显示明确提示", async () => {
    const onCreate = vi.fn().mockRejectedValue(new ApiRequestError(409, "RESUME_LIMIT_REACHED"));
    renderHome({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: "模板" }));
    fireEvent.click(screen.getByRole("button", { name: /标准简历模板/ }));
    fireEvent.click(screen.getByRole("button", { name: "使用模板创建" }));

    await waitFor(() => {
      expect(screen.getByText("每个账号最多保存 10 份简历，请先删除一份后再创建。")).toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("从主页选择支持的文件并调用简历导入", async () => {
    const onImport = vi.fn().mockResolvedValue(undefined);
    const file = new File(["# 张三"], "resume.md", { type: "text/markdown" });
    renderHome({ onImport });

    fireEvent.click(screen.getByRole("button", { name: "导入简历" }));
    fireEvent.change(screen.getByLabelText("选择简历文件"), { target: { files: [file] } });

    await waitFor(() => expect(onImport).toHaveBeenCalledWith(file));
  });

  it("导入服务未配置时显示明确的站内提示", async () => {
    const onImport = vi.fn().mockRejectedValue(new ApiRequestError(503, "STRUCTURING_MODEL_UNAVAILABLE"));
    const file = new File(["# 张三"], "resume.md", { type: "text/markdown" });
    renderHome({ onImport });

    fireEvent.change(screen.getByLabelText("选择简历文件"), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("简历结构化服务尚未配置，暂时无法导入。")).toBeInTheDocument();
    });
  });

  it("通过站内弹窗确认后调用删除，成功后显示结果", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderHome({ onDelete });

    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));

    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog", { name: "删除「Frontend Resume」？" })).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("1"));
    await waitFor(() => expect(screen.getByText("已删除「Frontend Resume」")).toBeInTheDocument());
  });

  it("取消确认时保留卡片且不调用删除", () => {
    const onDelete = vi.fn();
    renderHome({ onDelete });

    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("删除失败时保留卡片并显示明确错误", async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error("HTTP_500"));
    renderHome({ onDelete });

    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => {
      expect(screen.getByText("删除「Frontend Resume」失败，请稍后重试。")).toBeInTheDocument();
    });
    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
  });
});
