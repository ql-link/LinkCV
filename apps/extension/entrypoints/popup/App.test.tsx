import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { LinkResumeApiError } from "../../src/api/linkresume";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  sendMessage: vi.fn(),
  create: vi.fn(),
  importJob: vi.fn(),
  saveLogo: vi.fn(),
  readLogo: vi.fn(),
}));

vi.mock("../../src/api/company-logo", () => ({ saveCapturedCompanyLogo: mocks.saveLogo, readBossLogo: mocks.readLogo }));

vi.mock("wxt/browser", () => ({
  browser: {
    tabs: {
      query: mocks.query,
      sendMessage: mocks.sendMessage,
      create: mocks.create,
    },
  },
}));

vi.mock("../../src/api/linkresume", () => ({
  LinkResumeApiError: class LinkResumeApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      readonly details: Record<string, unknown>,
    ) {
      super(code);
    }

    get duplicate() {
      return this.details.duplicate ?? null;
    }
  },
  connectToLinkResume: mocks.connect,
  importJob: mocks.importJob,
  linkResumeUrl: (origin: string, path: string) => `${origin}${path}`,
}));

let root: Root | null = null;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readLogo.mockRejectedValue(new Error("no image"));
  mocks.connect.mockResolvedValue({ origin: "https://linkresume.example.test", user: { id: "7" } });
  mocks.saveLogo.mockResolvedValue("");
  document.body.innerHTML = '<div id="root"></div>';
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  mocks.query.mockResolvedValue([
    {
      id: 9,
      url: "https://www.zhipin.com/job_detail/abc.html?ka=detail",
    },
  ]);
  mocks.sendMessage.mockResolvedValue({
    ok: true,
    sourceUrl: "https://www.zhipin.com/job_detail/abc.html?ka=detail",
    capture: {
      job_title: "后端工程师",
      company_name: "示例公司",
      logo_url: "https://cdn.example.test/company.png",
      description_text: "负责 API 开发",
      skills: ["Python"],
      work_schedule_text: "5天/周 6个月",
      company_tags: [],
    },
    warnings: [],
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  vi.unstubAllGlobals();
});

describe("extension popup", () => {
  it("renders a downloaded logo, falls back on decode failure, and releases it", async () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", class extends URL {
      static override createObjectURL = vi.fn(() => "blob:company-logo");
      static override revokeObjectURL = revoke;
    });
    mocks.readLogo.mockResolvedValue(new Blob(["image"]));
    await renderApp();
    const image = document.querySelector<HTMLImageElement>(".company-logo img");
    expect(image?.src).toBe("blob:company-logo");
    await act(async () => { image!.dispatchEvent(new Event("error")); });
    expect(document.querySelector(".company-logo img")).toBeNull();
    expect(document.querySelector(".company-logo")?.textContent).toBe("示");
    await act(async () => { root?.unmount(); root = null; });
    expect(revoke).toHaveBeenCalledWith("blob:company-logo");
  });

  it("starts with a summary and keeps optional captured data when saving", async () => {
    mocks.importJob.mockResolvedValueOnce({ job_description: { id: "42", job_title: "后端工程师", company_name: "示例公司" } });
    await renderApp();
    expect(document.querySelector("input")).toBeNull();
    expect(document.body.textContent).toContain("后端工程师");
    expect(document.body.textContent).toContain("编辑");
    expect(document.querySelector("img.mark")?.getAttribute("src")).toBe("/linkresume-mark.png");
    await clickButton("保存到求职记录");
    expect(mocks.importJob).toHaveBeenCalledWith("https://linkresume.example.test", expect.objectContaining({
      capture: expect.objectContaining({ logo_url: "https://cdn.example.test/company.png", work_schedule_text: "5天/周 6个月", skills: ["Python"] }),
    }));
  });

  it("applies confirmed edits to preview and import without dropping hidden fields", async () => {
    mocks.importJob.mockResolvedValueOnce({ job_description: { id: "42", job_title: "平台工程师" } });
    await renderApp();
    await clickButton("编辑");
    await changeField("岗位名称", "平台工程师");
    await clickButton("完成编辑");
    expect(document.body.textContent).toContain("平台工程师");
    expect(document.querySelector("input")).toBeNull();
    await clickButton("保存到求职记录");
    expect(mocks.importJob).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      capture: expect.objectContaining({ job_title: "平台工程师", work_schedule_text: "5天/周 6个月", skills: ["Python"] }),
    }));
  });

  it("discards cancelled edits and preserves edits when returning to preview", async () => {
    await renderApp();
    await clickButton("编辑");
    await changeField("岗位名称", "取消的岗位");
    await clickButton("取消");
    expect(document.body.textContent).toContain("后端工程师");
    expect(document.body.textContent).not.toContain("取消的岗位");
    await clickButton("编辑");
    await changeField("岗位名称", "确认的岗位");
    await clickButton("返回预览");
    expect(document.body.textContent).toContain("确认的岗位");
  });

  it("blocks blank required fields before returning to preview", async () => {
    await renderApp();
    await clickButton("编辑");
    await changeField("公司名称", "   ");
    await clickButton("返回预览");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("不能为空");
    expect(document.querySelector("input")).not.toBeNull();
    expect(mocks.importJob).not.toHaveBeenCalled();
  });

  it("expands the full original description and returns without recapturing", async () => {
    const full = "岗位职责\n负责 API 开发\n\n任职要求\n熟悉数据库\n原文最后一行";
    const capture = await mocks.sendMessage();
    capture.capture.description_text = full;
    mocks.sendMessage.mockResolvedValue(capture);
    await renderApp();
    const reads = mocks.sendMessage.mock.calls.length;
    await clickButton("查看全部");
    expect(document.body.textContent).toContain("完整职位描述");
    expect(document.body.textContent).toContain("原文最后一行");
    await clickButton("收起描述");
    expect(document.body.textContent).toContain("查看全部");
    expect(mocks.sendMessage).toHaveBeenCalledTimes(reads);
  });

  it("saves directly from the description and opens the returned application", async () => {
    mocks.importJob.mockResolvedValueOnce({ job_description: { id: "job-42", job_title: "后端工程师", company_name: "示例公司" }, application: { id: "application-42" } });
    mocks.saveLogo.mockResolvedValueOnce("公司图标已保存。");
    await renderApp();
    await clickButton("查看全部");
    await clickButton("保存到求职记录");
    expect(document.body.textContent).toContain("岗位已加入求职记录");
    expect(document.body.textContent).not.toContain("公司图标已保存");
    expect(document.querySelectorAll("button")).toHaveLength(1);
    expect(document.querySelector('[aria-label="示例公司公司图标"]')).not.toBeNull();
    await clickButton("查看求职记录");
    expect(mocks.create).toHaveBeenLastCalledWith({ url: "https://linkresume.example.test/career/applications/application-42" });
  });

  it("keeps a saved job usable when its logo cannot be saved", async () => {
    mocks.importJob.mockResolvedValueOnce({ job_description: { id: "42", job_title: "后端工程师" } });
    mocks.saveLogo.mockResolvedValueOnce("公司图标未保存，岗位已保存。再次导入可重试补图。");
    await renderApp();
    await clickButton("保存到求职记录");
    expect(document.body.textContent).toContain("公司图标未保存，岗位已保存");
    expect(mocks.saveLogo).toHaveBeenCalledWith("https://linkresume.example.test", expect.objectContaining({ id: "42" }), "https://cdn.example.test/company.png");
    await clickButton("查看岗位详情");
    expect(mocks.create).toHaveBeenCalledWith({ url: "https://linkresume.example.test/career/jobs/42" });
  });

  it.each([undefined, null])("supports an older response with application=%s", async (application) => {
    mocks.importJob.mockResolvedValueOnce({ job_description: { id: "job-42", job_title: "后端工程师" }, application });
    await renderApp();
    await clickButton("保存到求职记录");
    expect(document.body.textContent).toContain("岗位已保存");
    expect(document.body.textContent).not.toContain("已加入求职记录");
    await clickButton("查看岗位详情");
    expect(mocks.create).toHaveBeenLastCalledWith({ url: "https://linkresume.example.test/career/jobs/job-42" });
  });

  it("does not lose edits on a failed save and allows retry", async () => {
    mocks.importJob.mockRejectedValueOnce(new Error("network"));
    mocks.importJob.mockResolvedValueOnce({ job_description: { id: "42", job_title: "修改后的岗位" } });
    await renderApp();
    await clickButton("编辑");
    await changeField("岗位名称", "修改后的岗位");
    await clickButton("完成编辑");
    await clickButton("保存到求职记录");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("网络请求失败");
    expect(document.body.textContent).toContain("修改后的岗位");
    await clickButton("保存到求职记录");
    expect(document.body.textContent).toContain("岗位已保存");
  });

  it("deduplicates rapid save clicks", async () => {
    let resolve!: (value: unknown) => void;
    mocks.importJob.mockReturnValue(new Promise(done => { resolve = done; }));
    await renderApp();
    const button = findButton("保存到求职记录");
    await act(async () => { button.click(); button.click(); });
    expect(mocks.importJob).toHaveBeenCalledTimes(1);
    await act(async () => { resolve({ job_description: { id: "42", job_title: "后端工程师" } }); });
  });

  it("requires login before importing", async () => {
    mocks.connect.mockResolvedValue({ origin: "http://127.0.0.1:5173", user: null });
    await renderApp();
    await clickButton("去登录");
    expect(mocks.create).toHaveBeenCalledWith({ url: "http://127.0.0.1:5173/login" });
    expect(mocks.importJob).not.toHaveBeenCalled();
  });

  it("requests the selected BOSS list detail", async () => {
    mocks.query.mockResolvedValue([{ id: 9, url: "https://www.zhipin.com/web/geek/jobs?ka=header-jobs" }]);
    await renderApp();
    expect(mocks.sendMessage).toHaveBeenCalledWith(9, { type: "LINKRESUME_CAPTURE_BOSS_JOB" });
    expect(document.body.textContent).toContain("保存到求职记录");
  });

  it("keeps the legacy duplicate resolution and lock version", async () => {
    mocks.importJob.mockRejectedValueOnce(new LinkResumeApiError(409, "JD_SOURCE_DUPLICATE", { duplicate: {
      existing: { id: "42", job_title: "后端工程师", company_name: "示例公司", lock_version: 3 }, allowed_actions: ["update", "cancel"],
    } }));
    mocks.importJob.mockResolvedValueOnce({ job_description: { id: "42", job_title: "后端工程师" } });
    await renderApp();
    await clickButton("保存到求职记录");
    expect(document.body.textContent).toContain("发现重复来源");
    await clickButton("用本次内容更新");
    expect(mocks.importJob).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({
      duplicate_resolution: { action: "update", job_description_id: "42", base_lock_version: 3 },
    }));
  });
});

async function renderApp() {
  const container = document.getElementById("root");
  if (!container) throw new Error("missing test root");
  root = createRoot(container);
  await act(async () => {
    root?.render(<App />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function findButton(label: string) {
  const button = [...document.querySelectorAll("button")].find(candidate => candidate.textContent === label);
  if (!button) throw new Error(`missing button: ${label}`);
  return button;
}

async function clickButton(label: string) {
  await act(async () => { findButton(label).click(); });
}

async function changeField(label: string, value: string) {
  const field = [...document.querySelectorAll("label")].find(node => node.querySelector("span")?.textContent === label)?.querySelector("input");
  if (!field) throw new Error(`missing field: ${label}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
