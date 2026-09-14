// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { readBossLogo, saveCapturedCompanyLogo } from "./company-logo";
import { uploadCompanyLogo } from "./linkresume";
import type { JobRecord } from "../contracts";

vi.mock("./linkresume", () => ({ uploadCompanyLogo: vi.fn() }));
const url = "https://img.bosszhipin.com/beijin/upload/com/logo/example.png";
const job = { id: "42", job_title: "工程师" } as JobRecord;
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.useRealTimers(); });

describe("company logo acquisition", () => {
  it.each([url, "https://img2.bosszhipin.com/mcs/chatphoto/company.jpg?x-oss-process=image/resize,w_100,limit_0"])("reads bytes from %s with no cookies or redirects", async (source) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetcher);
    const blob = await readBossLogo(source);
    expect(blob.size).toBe(3);
    expect(fetcher).toHaveBeenCalledWith(source, expect.objectContaining({
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", signal: expect.any(AbortSignal),
    }));
  });
  it.each([
    "https://example.test/image.png", "http://img.bosszhipin.com/a",
    "https://img.bosszhipin.com.evil.test/a", "https://user@img.bosszhipin.com/a",
    "https://img.bosszhipin.com:9000/a", "data:image/png;base64,AA==",
    "https://img2.bosszhipin.com.evil.test/a", "http://img2.bosszhipin.com/a",
    "https://user@img2.bosszhipin.com/a", "https://img2.bosszhipin.com:9000/a",
  ])("rejects an untrusted URL before requesting it: %s", async (value) => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(readBossLogo(value)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([403, 500])("reports HTTP %i without affecting job success", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("error", { status })));
    expect(await saveCapturedCompanyLogo("https://linkresume.example.test", job, url)).toContain("岗位已保存");
    expect(uploadCompanyLogo).not.toHaveBeenCalled();
  });
  it("enforces the actual streamed byte limit even without Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array(2 * 1024 * 1024 + 1))));
    await expect(readBossLogo(url)).rejects.toThrow("LOGO_TOO_LARGE");
  });
  it("rejects an advertised oversized response and an empty file", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('x', { headers: { 'content-length': '9999999' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array()));
    vi.stubGlobal('fetch', fetcher);
    await expect(readBossLogo(url)).rejects.toThrow('LOGO_TOO_LARGE');
    await expect(readBossLogo(url)).rejects.toThrow('LOGO_EMPTY');
  });
  it("times out a stalled request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    })));
    const result = saveCapturedCompanyLogo("https://linkresume.example.test", job, url);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await result).toContain("岗位已保存");
  });
  it("does not download again for an already hosted job", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    expect(await saveCapturedCompanyLogo("https://linkresume.example.test", { ...job, logo_revision: "a".repeat(64) }, url)).toBe("");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("treats upload rejection or an old backend as partial success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1]))));
    vi.mocked(uploadCompanyLogo).mockRejectedValueOnce(new Error("HTTP_404"));
    expect(await saveCapturedCompanyLogo("https://linkresume.example.test", job, url)).toContain("公司图标未保存");
  });
});
