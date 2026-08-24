import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../api/client";
import { NoticeBell } from "./NoticeBell";

const publishedAt = "2026-08-24T02:00:00Z";

function mockNotices(payload: {
  items: Array<{ id: string; title: string; content: string; published_at: string }>;
  unread_count: number;
}) {
  return vi.spyOn(api, "getNotices").mockResolvedValue(payload as never);
}

describe("NoticeBell", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("有未读通知时显示红点，无未读时不显示", async () => {
    mockNotices({
      items: [{ id: "1", title: "v1.1", content: "- 内容", published_at: publishedAt }],
      unread_count: 1,
    });
    const { unmount } = render(<NoticeBell />);
    const button = await screen.findByRole("button", { name: "查看更新通知，1 条未读" });
    expect(button.querySelector(".notice-bell-dot")).not.toBeNull();
    unmount();

    mockNotices({ items: [], unread_count: 0 });
    render(<NoticeBell />);
    const settled = await screen.findByRole("button", { name: "查看更新通知" });
    expect(settled.querySelector(".notice-bell-dot")).toBeNull();
  });

  it("列表默认摘要态，点击记录进入独立详情弹窗查看完整内容，关闭后回到列表", async () => {
    mockNotices({
      items: [
        {
          id: "1",
          title: "v1.1 上线",
          content: "## 新功能\n\n- 更新通知中心\n- 智能助手优化\n- 修复若干问题",
          published_at: publishedAt,
        },
      ],
      unread_count: 1,
    });
    const markRead = vi
      .spyOn(api, "markNoticesRead")
      .mockResolvedValue({ ok: true, unread_count: 0 } as never);
    render(<NoticeBell />);

    fireEvent.click(await screen.findByRole("button", { name: "查看更新通知，1 条未读" }));
    const list = await screen.findByRole("dialog", { name: "更新通知" });

    // 摘要态：标题与预览前两项可见，第三项被截断，提供查看详情引导。
    expect(within(list).getByText("v1.1 上线")).toBeInTheDocument();
    expect(within(list).getByText("更新通知中心")).toBeInTheDocument();
    expect(within(list).getByText("智能助手优化")).toBeInTheDocument();
    expect(within(list).queryByText("修复若干问题")).not.toBeInTheDocument();
    expect(within(list).getByText("点击查看详情")).toBeInTheDocument();

    // 点击该条记录打开独立详情弹窗，完整内容可见。
    fireEvent.click(within(list).getByRole("button", { name: "查看更新详情：v1.1 上线" }));
    const detail = await screen.findByRole("dialog", { name: "v1.1 上线" });
    expect(within(detail).getByText("修复若干问题")).toBeInTheDocument();

    // 关闭详情弹窗后回到列表摘要态。
    fireEvent.click(within(detail).getByRole("button", { name: "关闭" }));
    const restored = await screen.findByRole("dialog", { name: "更新通知" });
    expect(within(restored).queryByText("修复若干问题")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(markRead).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(document.querySelector(".notice-bell-dot")).toBeNull();
    });
  });

  it("非最新条目默认只有标题与时间，点击记录在详情弹窗查看完整内容", async () => {
    mockNotices({
      items: [
        { id: "2", title: "第二条", content: "- 第二条完整内容", published_at: publishedAt },
        { id: "1", title: "第一条", content: "- 第一条完整内容", published_at: publishedAt },
      ],
      unread_count: 0,
    });
    render(<NoticeBell />);

    fireEvent.click(await screen.findByRole("button", { name: "查看更新通知" }));
    const list = await screen.findByRole("dialog", { name: "更新通知" });

    expect(within(list).getByText("第一条")).toBeInTheDocument();
    // 非最新条目在列表中只有标题与时间，内容只在详情弹窗展示。
    expect(within(list).queryByText("第一条完整内容")).not.toBeInTheDocument();

    fireEvent.click(within(list).getByRole("button", { name: "查看更新详情：第一条" }));
    const detail = await screen.findByRole("dialog", { name: "第一条" });
    expect(within(detail).getByText("第一条完整内容")).toBeInTheDocument();
  });

  it("详情弹窗按受限 Markdown 渲染，脚本不执行且图片为占位", async () => {
    mockNotices({
      items: [
        {
          id: "1",
          title: "安全渲染",
          content:
            "[链接](https://example.test/doc)\n\n<script>window.bad = true</script>\n\n![架构图](https://example.test/a.png)",
          published_at: publishedAt,
        },
      ],
      unread_count: 0,
    });
    render(<NoticeBell />);

    fireEvent.click(await screen.findByRole("button", { name: "查看更新通知" }));
    const list = await screen.findByRole("dialog", { name: "更新通知" });
    fireEvent.click(within(list).getByRole("button", { name: "查看更新详情：安全渲染" }));

    const detail = await screen.findByRole("dialog", { name: "安全渲染" });
    const body = detail.querySelector(".notice-detail-body");
    expect(body).not.toBeNull();
    expect(body?.querySelector("script")).toBeNull();
    expect((window as { bad?: boolean }).bad).toBeUndefined();
    expect(within(detail).getByText("[图片：架构图]")).toBeInTheDocument();
    const link = body?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/doc");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("没有通知时弹窗展示空态", async () => {
    mockNotices({ items: [], unread_count: 0 });
    render(<NoticeBell />);

    fireEvent.click(await screen.findByRole("button", { name: "查看更新通知" }));
    expect(await screen.findByText("暂无更新通知")).toBeInTheDocument();
  });

  it("接口失败时按钮仍可渲染且不抛错", async () => {
    vi.spyOn(api, "getNotices").mockRejectedValue(new Error("network") as never);
    render(<NoticeBell />);
    expect(await screen.findByRole("button", { name: "查看更新通知" })).toBeTruthy();
  });
});
