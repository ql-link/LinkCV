import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "../../api/client";
import { AdminNoticePanel } from "./AdminNoticePanel";

const publishedAt = "2026-08-24T02:00:00Z";

describe("AdminNoticePanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("加载并展示全部通知及状态徽标", async () => {
    vi.spyOn(api, "adminListNotices").mockResolvedValue({
      items: [
        { id: "2", title: "第二条", content: "- 内容", published_at: publishedAt, revoked_at: null },
        { id: "1", title: "第一条", content: "- 内容", published_at: publishedAt, revoked_at: publishedAt },
      ],
    } as never);
    render(<AdminNoticePanel />);

    expect(await screen.findByText("第二条")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("已发布")).toBeInTheDocument();
    expect(within(rows[2]).getByText("已下架")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "下架" })).toBeInTheDocument();
    expect(within(rows[2]).getByRole("button", { name: "重新上架" })).toBeInTheDocument();
  });

  it("填写标题与内容后发布并刷新列表", async () => {
    const list = vi
      .spyOn(api, "adminListNotices")
      .mockResolvedValue({ items: [] } as never);
    const create = vi
      .spyOn(api, "adminCreateNotice")
      .mockResolvedValue({
        notice: { id: "7", title: "v1.2 更新", content: "- 更新", published_at: publishedAt, revoked_at: null },
      } as never);
    render(<AdminNoticePanel />);
    await screen.findByText("暂无更新通知");

    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "v1.2 更新" } });
    fireEvent.change(screen.getByRole("textbox", { name: /内容（支持 Markdown/ }), { target: { value: "- 更新" } });
    const submit = screen.getByRole("button", { name: "发布通知" });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith("v1.2 更新", "- 更新");
    });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("标题或内容为空时发布按钮禁用", async () => {
    vi.spyOn(api, "adminListNotices").mockResolvedValue({ items: [] } as never);
    render(<AdminNoticePanel />);
    await screen.findByText("暂无更新通知");

    expect(screen.getByRole("button", { name: "发布通知" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "只有标题" } });
    expect(screen.getByRole("button", { name: "发布通知" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: /内容（支持 Markdown/ }), { target: { value: "- 内容" } });
    expect(screen.getByRole("button", { name: "发布通知" })).not.toBeDisabled();
  });

  it("下架与重新上架调用对应接口并更新行状态", async () => {
    const revokedAt = "2026-08-24T03:00:00Z";
    vi.spyOn(api, "adminListNotices").mockResolvedValue({
      items: [
        { id: "5", title: "通知", content: "- 内容", published_at: publishedAt, revoked_at: null },
      ],
    } as never);
    const revoke = vi
      .spyOn(api, "adminRevokeNotice")
      .mockResolvedValue({
        notice: { id: "5", title: "通知", content: "- 内容", published_at: publishedAt, revoked_at: revokedAt },
      } as never);
    render(<AdminNoticePanel />);

    fireEvent.click(await screen.findByRole("button", { name: "下架" }));
    await waitFor(() => {
      expect(revoke).toHaveBeenCalledWith("5");
    });
    expect(await screen.findByText("已下架")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下架" })).toBeNull();
  });
});
