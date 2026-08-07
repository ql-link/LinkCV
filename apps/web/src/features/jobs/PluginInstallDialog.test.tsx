import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../api/client";
import { PluginInstallDialog } from "./PluginInstallDialog";

const release = {
  version: "0.2.0",
  released_at: "2026-08-07T10:00:00Z",
  browser: "Chrome" as const,
  manifest_version: 3 as const,
  size: 81920,
  sha256: "a".repeat(64),
  download_url: "/api/plugin-releases/0.2.0/download",
};

afterEach(() => vi.restoreAllMocks());

describe("PluginInstallDialog", () => {
  it("只展示使用说明和下载入口，不暴露发布元数据", async () => {
    vi.spyOn(api, "getPluginRelease").mockResolvedValue({ status: "available", release });
    render(<PluginInstallDialog onClose={vi.fn()} />);

    expect(await screen.findByText(/chrome:\/\/extensions/)).toBeInTheDocument();
    expect(screen.getByText("更新时下载新包，并在扩展管理页重新加载。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下载插件" })).toBeEnabled();
    expect(screen.queryByText("v0.2.0")).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(release.sha256))).not.toBeInTheDocument();
    expect(screen.queryByText(/Manifest V3/)).not.toBeInTheDocument();
  });

  it("未发布或读取失败时不显示下载链接", async () => {
    vi.spyOn(api, "getPluginRelease").mockResolvedValue({ status: "unpublished", release: null });
    const { unmount } = render(<PluginInstallDialog onClose={vi.fn()} />);
    expect(await screen.findByText("暂未提供插件安装包。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载插件" })).not.toBeInTheDocument();
    unmount();

    vi.mocked(api.getPluginRelease).mockRejectedValue(new Error("storage unavailable"));
    render(<PluginInstallDialog onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法获取");
    expect(screen.queryByRole("button", { name: "下载插件" })).not.toBeInTheDocument();
  });

  it("关闭按钮交还给调用方", () => {
    vi.spyOn(api, "getPluginRelease").mockReturnValue(new Promise(() => {}));
    const close = vi.fn();
    render(<PluginInstallDialog onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭插件安装说明" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("版本切换导致下载冲突时提示重新打开", async () => {
    vi.spyOn(api, "getPluginRelease").mockResolvedValue({ status: "available", release });
    vi.spyOn(api, "downloadPluginRelease").mockRejectedValue(
      new ApiRequestError(409, "PLUGIN_RELEASE_VERSION_CHANGED"),
    );
    render(<PluginInstallDialog onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "下载插件" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("版本已经更新");
  });
});
