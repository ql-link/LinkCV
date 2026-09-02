import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api/client";
import { defaultCanonicalDocument, defaultCanonicalPresentation, editorSettingsToStyle } from "../../api/resumeContract";
import { defaultSettings } from "../../store/resumeStore";
import { compareVersionStyles, VersionDiffDialog } from "./VersionDiffDialog";

afterEach(() => vi.restoreAllMocks());

describe("版本页面设置差异", () => {
  it("读取历史版本时使用统一的面板加载状态", () => {
    vi.spyOn(api, "getResumeVersion").mockReturnValue(new Promise(() => {}));

    render(
      <VersionDiffDialog
        open
        resumeId="42"
        version={{ version_no: 2, name: "历史投递版" }}
        currentMarkdown="# 当前内容"
        currentSettings={defaultSettings}
        restoring={false}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "正在读取版本内容…" })).toHaveClass(
      "page-loading",
      "is-panel",
    );
  });

  it("只返回发生变化的设置", () => {
    const differences = compareVersionStyles(
      { ...defaultSettings, fontSize: 12, smartOnePage: true },
      defaultCanonicalPresentation,
    );
    expect(differences.map((item) => item.label)).toContain("字号");
    expect(differences.map((item) => item.label)).toContain("智能一页");
  });

  it("读取快照后展示差异，只有确认才触发恢复回调", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "getResumeVersion").mockResolvedValue({
      version: {
        id: "9",
        version_no: 2,
        name: "历史投递版",
        reason: "manual",
        created_at: "2026-08-21T08:00:00Z",
        data: {
          ...defaultCanonicalDocument,
          sections: [{
            node_id: "node_section000000001",
            semantic_kind: "custom",
            title: { node_id: "node_title0000000001", value: "历史内容", source_refs: [] },
            entries: [],
            blocks: [],
            source_refs: [],
          }],
        },
        style: defaultCanonicalPresentation,
      },
    });
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <VersionDiffDialog
        open
        resumeId="42"
        version={{ version_no: 2, name: "历史投递版" }}
        currentMarkdown="# 当前内容"
        currentSettings={defaultSettings}
        restoring={false}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    expect(await screen.findByText(/当前内容/)).toBeInTheDocument();
    expect(screen.getByText(/历史内容/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认恢复" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("内容与设置均相同时禁用确认恢复", async () => {
    const markdown = "## 相同内容";
    vi.spyOn(api, "getResumeVersion").mockResolvedValue({
      version: {
        id: "10",
        version_no: 3,
        name: "相同版",
        reason: "manual",
        created_at: "2026-08-21T09:00:00Z",
        data: {
          ...defaultCanonicalDocument,
          sections: [{
            node_id: "node_section000000002",
            semantic_kind: "custom",
            title: { node_id: "node_title0000000002", value: "相同内容", source_refs: [] },
            entries: [],
            blocks: [],
            source_refs: [],
          }],
        },
        style: editorSettingsToStyle(defaultSettings, defaultCanonicalPresentation),
      },
    });
    render(
      <VersionDiffDialog
        open
        resumeId="42"
        version={{ version_no: 3, name: "相同版" }}
        currentMarkdown={markdown}
        currentSettings={defaultSettings}
        restoring={false}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(await screen.findByText("当前内容与该版本一致，无需恢复。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认恢复" })).toBeDisabled();
  });
});
