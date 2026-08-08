import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    },
  };
});

const mockedGetState = vi.mocked(api.getShareState);
const mockedCreate = vi.mocked(api.createShare);
const mockedUpdate = vi.mocked(api.updateShare);
const mockedDelete = vi.mocked(api.deleteShare);

const shareState: ResumeShareState = {
  share_token: "token_abc",
  share_visibility: "public",
  share_expires_at: null,
  share_created_at: "2026-08-05T08:00:00Z",
};

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

    await waitFor(() => {
      const link = screen.getByDisplayValue(/\/share\/token_abc$/);
      expect(link).toBeInTheDocument();
    });
    expect(mockedCreate).toHaveBeenCalledWith("1");
  });

  it("可切换可见性为仅自己可见", async () => {
    mockedGetState.mockResolvedValue({ share: shareState });
    mockedUpdate.mockResolvedValue({
      share: { ...shareState, share_visibility: "private" },
    });
    render(<SharePanel resumeId="1" resumeTitle="简历A" onClose={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByDisplayValue(/\/share\/token_abc/)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: "仅自己可见" }));

    await waitFor(() => expect(mockedUpdate).toHaveBeenCalledWith("1", { visibility: "private" }));
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
  });
});
