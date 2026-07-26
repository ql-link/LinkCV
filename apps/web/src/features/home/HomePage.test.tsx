import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

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

  it("删除后先隐藏卡片并在五秒后调用一次删除", () => {
    const onDelete = vi.fn();
    renderHome({ onDelete });

    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));

    expect(screen.queryByText("Frontend Resume")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销" })).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(4999));
    expect(onDelete).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("1");
  });

  it("五秒内撤销会恢复卡片且不调用删除", () => {
    const onDelete = vi.fn();
    renderHome({ onDelete });

    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByText("Frontend Resume")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("卸载主页会清理等待中的删除计时器", () => {
    const onDelete = vi.fn();
    const { unmount } = renderHome({ onDelete });

    fireEvent.click(screen.getByRole("button", { name: "删除简历 Frontend Resume" }));
    unmount();
    act(() => vi.advanceTimersByTime(5000));

    expect(onDelete).not.toHaveBeenCalled();
  });
});
