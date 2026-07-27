import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResumeSummary } from "../../api/client";
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

  it("切换模板后隐藏搜索并通过标准模板创建简历", () => {
    const onCreate = vi.fn();
    renderHome({ onCreate });

    fireEvent.click(screen.getByRole("button", { name: "模板" }));

    expect(screen.queryByRole("textbox", { name: "搜索简历" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /标准简历模板/ }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("确认后立即调用删除，成功后显示结果", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderHome({ onDelete });

    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("1");
    await waitFor(() => expect(screen.getByText("已删除「Frontend Resume」")).toBeInTheDocument());
  });

  it("取消确认时保留卡片且不调用删除", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onDelete = vi.fn();
    renderHome({ onDelete });

    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));

    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("删除失败时保留卡片并显示明确错误", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const onDelete = vi.fn().mockRejectedValue(new Error("HTTP_500"));
    renderHome({ onDelete });

    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));

    await waitFor(() => {
      expect(screen.getByText("删除「Frontend Resume」失败，请稍后重试。")).toBeInTheDocument();
    });
    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
  });
});
