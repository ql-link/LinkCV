import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ResumeShareState } from "../../api/client";
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

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SharePanel", () => {
  it("未分享时无需二次确认即可创建链接", async () => {
    mockedGetState.mockResolvedValue({ share: null });
    mockedCreate.mockResolvedValue({ share: shareState });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    expect(
      screen.getByText("分享内容会同步展示最近一次自动保存成功的草稿。"),
    ).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "创建分享链接" }));

    await waitFor(() => {
      expect(mockedCreate).toHaveBeenCalledWith("1", {
        visibility: "public",
        expires_at: null,
      });
    });
    expect(screen.queryByRole("dialog", { name: "创建分享链接？" })).not.toBeInTheDocument();
    expect(await screen.findByDisplayValue(/\/share\/token_abc$/)).toBeInTheDocument();
  });

  it("创建前选择的可见性与有效期直接用于创建", async () => {
    mockedGetState.mockResolvedValue({ share: null });
    mockedCreate.mockResolvedValue({
      share: { ...shareState, share_visibility: "private" },
    });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await screen.findByRole("button", { name: "创建分享链接" });
    fireEvent.click(screen.getByRole("button", { name: "仅自己可见" }));
    fireEvent.click(screen.getByRole("button", { name: "7 天" }));
    fireEvent.click(screen.getByRole("button", { name: "创建分享链接" }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith("1", {
        visibility: "private",
        expires_at: expect.any(String),
      }),
    );
  });

  it("链接默认明文显示并可一键复制", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    const link = await screen.findByDisplayValue(/\/share\/token_abc$/);
    expect(link).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制链接" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringMatching(/\/share\/token_abc$/),
      ),
    );
  });

  it("可见性与有效期改动立即分别保存", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    mockedUpdate
      .mockResolvedValueOnce({ share: { ...shareState, share_visibility: "private" } })
      .mockResolvedValueOnce({
        share: {
          ...shareState,
          share_visibility: "private",
          share_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
        },
      });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await screen.findByDisplayValue(/\/share\/token_abc$/);
    fireEvent.click(screen.getByRole("button", { name: "仅自己可见" }));
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenNthCalledWith(1, "1", { visibility: "private" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "一个月" }));
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenNthCalledWith(2, "1", {
        expires_at: expect.any(String),
      }),
    );
    expect(screen.queryByRole("button", { name: "保存链接配置" })).not.toBeInTheDocument();
  });

  it("显示服务端真实到期时间且不再下载公开 payload 探测状态", async () => {
    mockedGetState.mockResolvedValue({
      share: { ...shareState, share_expires_at: "2099-01-02T03:04:00Z" },
    });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    const statuses = await screen.findAllByText(/有效至.*2099/);
    expect(statuses.length).toBeGreaterThan(0);
    expect(mockedFetchPublic).not.toHaveBeenCalled();
  });

  it("重新生成链接仍需二次确认并保留配置", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    mockedCreate.mockResolvedValue({ share: { ...shareState, share_token: "token_new" } });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "重新生成链接" }));
    expect(await screen.findByRole("dialog", { name: "重新生成分享链接？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认重新生成" }));

    await waitFor(() =>
      expect(mockedCreate).toHaveBeenCalledWith("1", {
        visibility: "public",
        expires_at: null,
      }),
    );
    expect(await screen.findByDisplayValue(/\/share\/token_new$/)).toBeInTheDocument();
  });

  it("删除链接仍需二次确认", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    mockedDelete.mockResolvedValue({ deleted: true });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除链接" }));
    expect(await screen.findByRole("alertdialog", { name: "删除分享链接？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith("1"));
    expect(await screen.findByRole("button", { name: "创建分享链接" })).toBeInTheDocument();
  });

  it("过期链接显示真实过期状态且可通过快捷有效期恢复", async () => {
    mockedGetState.mockResolvedValue({
      share: { ...shareState, share_expires_at: "2020-01-01T00:00:00Z" },
    });
    mockedUpdate.mockResolvedValue({
      share: { ...shareState, share_expires_at: new Date(Date.now() + 7 * 86400000).toISOString() },
    });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("链接已过期"),
    );
    fireEvent.click(screen.getByRole("button", { name: "7 天" }));
    await waitFor(() =>
      expect(mockedUpdate).toHaveBeenCalledWith("1", { expires_at: expect.any(String) }),
    );
  });
});
