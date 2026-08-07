import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("展示当前版本并在确认后上传 ZIP", async () => {
    vi.spyOn(api, "getPluginRelease").mockResolvedValue({ status: "available", release });
    const publish = vi.spyOn(api, "adminPublishPluginRelease").mockResolvedValue({
      release: { ...release, version: "0.2.1", download_url: "/api/plugin-releases/0.2.1/download" },
    });
    render(<PluginReleasePanel />);
    expect(await screen.findByText("v0.2.0")).toBeInTheDocument();

    const file = new File(["plugin"], "linkcv-production-v0.2.1.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("选择插件 ZIP"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "发布插件" }));
    expect(screen.getByRole("alertdialog", { name: "确认发布插件？" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认发布" }));

    await waitFor(() => expect(publish).toHaveBeenCalledWith(file));
    expect(await screen.findByText("v0.2.1 已发布，JD 下载入口已切换。")).toBeInTheDocument();
  });

  it("在客户端拒绝非 ZIP，并呈现后端校验冲突", async () => {
    vi.spyOn(api, "getPluginRelease").mockResolvedValue({ status: "unpublished", release: null });
    const publish = vi.spyOn(api, "adminPublishPluginRelease").mockRejectedValue(
      new ApiRequestError(409, "PLUGIN_RELEASE_VERSION_CONFLICT"),
    );
    render(<PluginReleasePanel />);
    await screen.findByText("当前环境尚未发布插件。");

    fireEvent.change(screen.getByLabelText("选择插件 ZIP"), {
      target: { files: [new File(["source"], "source.txt")] },
    });
    expect(screen.getByRole("status")).toHaveTextContent("请选择 ZIP");
    expect(screen.queryByRole("button", { name: "发布插件" })).not.toBeInTheDocument();

    const zip = new File(["plugin"], "plugin.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("选择插件 ZIP"), { target: { files: [zip] } });
    fireEvent.click(screen.getByRole("button", { name: "发布插件" }));
    fireEvent.click(screen.getByRole("button", { name: "确认发布" }));
    await waitFor(() => expect(publish).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent("版本低于当前版本");
  });
});
