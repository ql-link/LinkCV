import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type PublicSharePayload, type ResumeShareState } from "../../api/client";
import { SharePanel } from "./SharePanel";

vi.mock("../../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/client")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      getShareState: vi.fn(),
      createShare: vi.fn(),
      updateShare: vi.fn(),
      deleteShare: vi.fn(),
      fetchPublicShare: vi.fn(),
    },
  };
});

const mockedGetState = vi.mocked(api.getShareState);
const mockedCreate = vi.mocked(api.createShare);
const mockedUpdate = vi.mocked(api.updateShare);
const mockedDelete = vi.mocked(api.deleteShare);
const mockedFetchPublic = vi.mocked(api.fetchPublicShare);

const shareState: ResumeShareState = {
  share_token: "token_abc",
  share_visibility: "public",
  share_expires_at: null,
  share_created_at: "2026-08-05T08:00:00Z",
};

const publicPayload = {
  data: {} as PublicSharePayload["data"],
  style: {} as PublicSharePayload["style"],
  sharer: { nickname: "于晏", avatar_url: null },
} satisfies PublicSharePayload;

beforeEach(() => {
  mockedFetchPublic.mockResolvedValue(publicPayload);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SharePanel", () => {
  it("未分享时创建链接并展示可复制的链接", async () => {
    mockedGetState.mockResolvedValue({ share: null });
    mockedCreate.mockResolvedValue({ share: shareState });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建分享链接" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    const dialog = await screen.findByRole("dialog", { name: "创建分享链接？" });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    await waitFor(() => {
      const link = screen.getByDisplayValue(/\/share\/toke\*\*\*\*\*_abc$/);
      expect(link).toBeInTheDocument();
    });
    expect(mockedCreate).toHaveBeenCalledWith("1", { visibility: "public", expires_at: null });
  });

  it("取消创建时不生成链接", async () => {
    mockedGetState.mockResolvedValue({ share: null });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建分享链接" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    const dialog = await screen.findByRole("dialog", { name: "创建分享链接？" });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(dialog).not.toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("创建前可选择仅自己可见再创建", async () => {
    mockedGetState.mockResolvedValue({ share: null });
    mockedCreate.mockResolvedValue({
      share: { ...shareState, share_visibility: "private" },
    });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建分享链接" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "仅自己可见" }));
    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    const dialog = await screen.findByRole("dialog", { name: "创建分享链接？" });
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith("1", {
        visibility: "private",
        expires_at: null,
      }),
    );
  });

  it("创建前可选择有效期七天", async () => {
    mockedGetState.mockResolvedValue({ share: null });
    mockedCreate.mockResolvedValue({
      share: { ...shareState, share_expires_at: new Date(Date.now() + 7 * 86400000).toISOString() },
    });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建分享链接" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "7 天" }));
    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));
    const dialog = await screen.findByRole("dialog", { name: "创建分享链接？" });
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith("1", {
        visibility: "public",
        expires_at: expect.any(String),
      }),
    );
  });

  it("已分享时可修改有效期并保存", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    mockedUpdate.mockResolvedValue({
      share: { ...shareState, share_expires_at: new Date(Date.now() + 30 * 86400000).toISOString() },
    });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByDisplayValue(/\/share\/toke\*\*\*\*\*_abc/)).toBeInTheDocument(),
    );

    // 点击仅本地暂存，不立即提交
    fireEvent.click(screen.getByRole("button", { name: "一个月" }));
    expect(mockedUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "保存链接配置" }));
    const dialog = await screen.findByRole("dialog", { name: "保存链接配置？" });
    expect(dialog).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith("1", {
        visibility: "public",
        expires_at: expect.any(String),
      }),
    );
    expect(screen.queryByRole("button", { name: "覆盖链接" })).not.toBeInTheDocument();
  });

  it("可修改可见性为仅自己可见并保存", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    mockedUpdate.mockResolvedValue({
      share: { ...shareState, share_visibility: "private" },
    });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByDisplayValue(/\/share\/toke\*\*\*\*\*_abc/)).toBeInTheDocument(),
    );

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("链接当前可用"),
    );
    const privateVisibilityButton = screen.getByRole("button", { name: "仅自己可见" });
    fireEvent.click(privateVisibilityButton);
    await waitFor(() => expect(privateVisibilityButton).toHaveClass("active"));
    fireEvent.click(screen.getByRole("button", { name: "保存链接配置" }));
    const dialog = await screen.findByRole("dialog", { name: "保存链接配置？" });
    fireEvent.click(screen.getByRole("button", { name: "确认保存" }));

    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith("1", {
        visibility: "private",
        expires_at: null,
      }),
    );
  });

  it("修改配置后在确认弹窗取消则不提交", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "一个月" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "一个月" }));
    fireEvent.click(screen.getByRole("button", { name: "保存链接配置" }));
    const dialog = await screen.findByRole("dialog", { name: "保存链接配置？" });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(dialog).not.toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("链接默认遮蔽，点击查看后展示完整链接，可再次隐藏", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByDisplayValue(/\/share\/toke\*\*\*\*\*_abc$/)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "查看" }));
    expect(screen.getByDisplayValue(/\/share\/token_abc$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "隐藏" }));
    expect(screen.getByDisplayValue(/\/share\/toke\*\*\*\*\*_abc$/)).toBeInTheDocument();
  });

  it("重新生成链接需二次确认，旧链接作废且保留配置", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    mockedCreate.mockResolvedValue({ share: { ...shareState, share_token: "token_new" } });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重新生成链接" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "重新生成链接" }));
    const dialog = await screen.findByRole("dialog", { name: "重新生成分享链接？" });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认重新生成" }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith("1", {
        visibility: "public",
        expires_at: null,
      }),
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue(/\/share\/toke\*\*\*\*\*_new$/)).toBeInTheDocument(),
    );
  });

  it("在重新生成确认弹窗取消则不生成", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "重新生成链接" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "重新生成链接" }));
    const dialog = await screen.findByRole("dialog", { name: "重新生成分享链接？" });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(dialog).not.toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("公共链接探测成功后显示链接可用", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("链接当前可用"),
    );
    expect(mockedFetchPublic).toHaveBeenCalledWith("token_abc");
  });

  it("链接过期时显示已过期，不发起探测", async () => {
    mockedGetState.mockResolvedValue({
      share: {
        ...shareState,
        share_expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      },
    });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("链接已过期"),
    );
    expect(mockedFetchPublic).not.toHaveBeenCalled();
  });

  it("公共链接探测失败时显示链接已失效", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    mockedFetchPublic.mockRejectedValue(new Error("unavailable"));
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("链接已失效"),
    );
  });

  it("仅自己可见链接不进行公开探测但视为可用", async () => {
    mockedGetState.mockResolvedValue({
      share: { ...shareState, share_visibility: "private" },
    });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("链接当前可用"),
    );
    expect(mockedFetchPublic).not.toHaveBeenCalled();
  });

  it("删除链接需二次确认并清空分享状态", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    mockedDelete.mockResolvedValue({ deleted: true });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "删除链接" })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "删除链接" }));
    const dialog = await screen.findByRole("alertdialog", { name: "删除分享链接？" });
    expect(dialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("1"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "创建分享链接" })).toBeInTheDocument(),
    );
    // 删除后创建配置重置为默认：所有人可见 + 永久
    expect(screen.getByRole("button", { name: "所有人可见" }).className).toContain("active");
    expect(screen.getByRole("button", { name: "永久" }).className).toContain("active");
  });
});
