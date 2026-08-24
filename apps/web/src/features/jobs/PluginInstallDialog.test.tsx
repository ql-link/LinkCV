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
  it("展示完整安装与使用说明，不暴露发布元数据", async () => {
    vi.spyOn(api, "getPluginRelease").mockResolvedValue({ status: "available", release });
    const { container } = render(<PluginInstallDialog onClose={vi.fn()} />);

    expect(await screen.findByText(/chrome:\/\/extensions/)).toBeInTheDocument();
    expect(screen.getByText(/edge:\/\/extensions/)).toBeInTheDocument();
    expect(screen.queryByText(/安装过程大约需要两分钟/)).not.toBeInTheDocument();
    expect(container.querySelector(".plugin-dialog-chip svg")).toBeInTheDocument();
    expect(container.querySelector(".plugin-dialog-header")).toContainElement(screen.getByRole("heading", { name: "安装 LinkResume 岗位采集插件" }));
    expect(container.querySelector(".plugin-dialog-header")).toContainElement(screen.getByRole("button", { name: "关闭插件安装说明" }));
    expect(screen.getByText(/选择包含/)).toHaveTextContent("manifest.json");
    expect(screen.getByText("打开岗位并核对导入")).toBeInTheDocument();
    expect(screen.getByText(/插件不会自动投递或批量采集/)).toBeInTheDocument();
    expect(screen.getByText(/更新时覆盖原解压目录/)).toBeInTheDocument();
    expect(container.querySelectorAll(".plugin-step")).toHaveLength(5);
    expect(container.querySelector(".plugin-step.is-open")).toHaveTextContent("下载并解压安装包");
    expect(screen.getByRole("button", { name: "下载插件 ZIP" })).toBeEnabled();
    expect(screen.queryByText("v0.2.0")).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp(release.sha256))).not.toBeInTheDocument();
    expect(screen.queryByText(/Manifest V3/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /我已安装/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/完成安装后返回此页/)).not.toBeInTheDocument();
  });

  it("未发布或读取失败时不显示下载链接", async () => {
    vi.spyOn(api, "getPluginRelease").mockResolvedValue({ status: "unpublished", release: null });
    const { unmount } = render(<PluginInstallDialog onClose={vi.fn()} />);
    expect(await screen.findByText("暂未提供插件安装包。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载插件 ZIP" })).not.toBeInTheDocument();
    unmount();

    vi.mocked(api.getPluginRelease).mockRejectedValue(new Error("storage unavailable"));
    render(<PluginInstallDialog onClose={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法获取");
    expect(screen.queryByRole("button", { name: "下载插件 ZIP" })).not.toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: "下载插件 ZIP" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("版本已经更新");
  });
});
