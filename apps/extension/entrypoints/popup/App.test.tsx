import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  sendMessage: vi.fn(),
  create: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    tabs: {
      query: mocks.query,
      sendMessage: mocks.sendMessage,
      create: mocks.create,
    },
  },
}));

vi.mock("../../src/api/linkcv", () => ({
  LinkCVApiError: class LinkCVApiError extends Error {},
  connectToLinkCV: mocks.connect,
  importJob: vi.fn(),
  linkCVUrl: (origin: string, path: string) => `${origin}${path}`,
}));

let root: Root | null = null;

beforeEach(() => {
  vi.clearAllMocks();
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
});

describe("extension popup", () => {
  it("shows an editable confirmation preview for an authenticated capture", async () => {
    mocks.connect.mockResolvedValue({
      origin: "http://127.0.0.1:5173",
      user: { id: "7", email: "user@example.test" },
    });

    await renderApp();

    expect(document.body.textContent).toContain("导入预览");
    expect(document.body.textContent).toContain("确认导入");
    const inputs = [...document.querySelectorAll("input")];
    expect(inputs.map((input) => input.value)).toContain("后端工程师");
    expect(inputs.map((input) => input.value)).toContain("示例公司");
    expect(document.body.textContent).toContain("工作/实习安排");
    expect(inputs.map((input) => input.value)).toContain("5天/周 6个月");
    expect(document.querySelector("textarea")?.value).toBe("负责 API 开发");
  });

  it("asks the user to log in instead of attempting an import anonymously", async () => {
    mocks.connect.mockResolvedValue({ origin: "http://127.0.0.1:5173", user: null });

    await renderApp();

    expect(document.body.textContent).toContain("请先在 LinkCV 登录");
    expect(document.body.textContent).toContain("打开 LinkCV 登录");
  });

  it("allows the BOSS list page to request the selected detail capture", async () => {
    mocks.connect.mockResolvedValue({
      origin: "http://127.0.0.1:5173",
      user: { id: "7", email: "user@example.test" },
    });
    mocks.query.mockResolvedValue([
      { id: 9, url: "https://www.zhipin.com/web/geek/jobs?ka=header-jobs" },
    ]);

    await renderApp();

    expect(mocks.sendMessage).toHaveBeenCalledWith(9, { type: "LINKCV_CAPTURE_BOSS_JOB" });
    expect(document.body.textContent).toContain("导入预览");
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
