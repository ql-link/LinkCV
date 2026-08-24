import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "../../api/client";
import { PluginReleasePanel } from "./PluginReleasePanel";

const release = {
  version: "0.2.0",
  released_at: "2026-08-07T10:00:00Z",
  browser: "Chrome" as const,
  manifest_version: 3 as const,
  size: 81920,
  sha256: "b".repeat(64),
  download_url: "/api/plugin-releases/0.2.0/download",
};

afterEach(() => vi.restoreAllMocks());

describe("PluginReleasePanel", () => {
  it("没有插件时只显示上传入口", async () => {
    vi.spyOn(api, "getAdminPluginRelease").mockResolvedValue({ status: "absent", release: null });
    render(<PluginReleasePanel />);

    expect(await screen.findByText("当前没有插件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传插件" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新插件" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新上架" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除插件" })).not.toBeInTheDocument();
  });

  it("已上架时显示更新、下架和删除，并能确认更新", async () => {
    vi.spyOn(api, "getAdminPluginRelease").mockResolvedValue({ status: "published", release });
    const updated = { ...release, version: "0.2.1", download_url: "/api/plugin-releases/0.2.1/download" };
    const publish = vi.spyOn(api, "adminPublishPluginRelease").mockResolvedValue({
      release: updated,
      cleanup_pending: false,
    });
    render(<PluginReleasePanel />);
    expect(await screen.findByText("岗位采集插件 v0.2.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新插件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下架插件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除插件" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "上传插件" })).not.toBeInTheDocument();

    const file = new File(["plugin"], "plugin-v0.2.1.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("选择插件 ZIP"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "确认更新" }));
    const updateDialog = screen.getByRole("alertdialog", { name: "确认更新插件？" });
    expect(updateDialog).toHaveTextContent("删除旧版本安装包");
    fireEvent.click(within(updateDialog).getByRole("button", { name: "确认更新" }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith(file));
    expect(await screen.findByRole("status")).toHaveTextContent("v0.2.1 已更新");
  });

  it("已下架时保留版本并可直接重新上架", async () => {
    vi.spyOn(api, "getAdminPluginRelease").mockResolvedValue({ status: "unpublished", release });
    const reactivate = vi.spyOn(api, "adminReactivatePluginRelease").mockResolvedValue({ release });
    render(<PluginReleasePanel />);

    expect(await screen.findByText("已下架")).toBeInTheDocument();
    expect(screen.getByText("岗位采集插件 v0.2.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新上架" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新插件" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除插件" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下架插件" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重新上架" }));
    await waitFor(() => expect(reactivate).toHaveBeenCalledOnce());
    expect(await screen.findByRole("status")).toHaveTextContent("已重新上架");
    expect(screen.getByText("已上架")).toBeInTheDocument();
  });

  it("物理删除前二次确认，成功后回到上传状态", async () => {
    vi.spyOn(api, "getAdminPluginRelease").mockResolvedValue({ status: "published", release });
    const remove = vi.spyOn(api, "adminDeletePluginRelease").mockResolvedValue({ deleted: true });
    render(<PluginReleasePanel />);
    await screen.findByText("岗位采集插件 v0.2.0");

    fireEvent.click(screen.getByRole("button", { name: "删除插件" }));
    expect(screen.getByRole("alertdialog", { name: "永久删除插件？" })).toHaveTextContent(
      "此操作不可恢复",
    );
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    expect(await screen.findByText("当前没有插件")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传插件" })).toBeInTheDocument();
  });

  it("保留失败文件供清除，并展示具体校验错误", async () => {
    vi.spyOn(api, "getAdminPluginRelease").mockResolvedValue({ status: "absent", release: null });
    vi.spyOn(api, "adminPublishPluginRelease").mockRejectedValue(
      new ApiRequestError(422, "PLUGIN_RELEASE_INVALID_CONTENTS"),
    );
    render(<PluginReleasePanel />);
    await screen.findByText("当前没有插件");

    const file = new File(["plugin"], "wrapped-plugin.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("选择插件 ZIP"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "确认上传" }));
    const uploadDialog = screen.getByRole("alertdialog", { name: "确认上传插件？" });
    fireEvent.click(within(uploadDialog).getByRole("button", { name: "确认上传" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "ZIP 根目录必须包含 manifest.json",
    );
    expect(screen.getByText("wrapped-plugin.zip")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除" }));
    expect(screen.queryByText("wrapped-plugin.zip")).not.toBeInTheDocument();
  });
});
