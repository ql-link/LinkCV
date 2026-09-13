import type { JobRecord } from "../contracts";
import { uploadCompanyLogo } from "./linkresume";

const MAX_BYTES = 2 * 1024 * 1024;
const BOSS_IMAGE_HOSTS = new Set(["img.bosszhipin.com", "img2.bosszhipin.com"]);

export async function readBossLogo(value: string): Promise<Blob> {
  const url = new URL(value);
  if (url.protocol !== "https:" || !BOSS_IMAGE_HOSTS.has(url.hostname)
    || url.username || url.password || url.port) {
    throw new Error("UNSUPPORTED_LOGO_URL");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url.href, {
      credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error("LOGO_DOWNLOAD_FAILED");
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      await response.body.cancel();
      throw new Error("LOGO_TOO_LARGE");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        total += chunk.byteLength;
        if (total > MAX_BYTES) throw new Error("LOGO_TOO_LARGE");
        chunks.push(new Uint8Array(chunk));
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (!total) throw new Error("LOGO_EMPTY");
    // The server validates actual bytes; neither the URL suffix nor MIME is trusted.
    return new Blob(chunks, { type: "application/octet-stream" });
  } finally {
    clearTimeout(timer);
  }
}

export async function saveCapturedCompanyLogo(
  origin: string, job: JobRecord, sourceUrl: string | undefined,
): Promise<string> {
  if (job.logo_revision) return "";
  if (!sourceUrl) return "未读取到公司图标，岗位已保存。";
  try {
    const file = await readBossLogo(sourceUrl);
    await uploadCompanyLogo(origin, job.id, file);
    return "公司图标已保存。";
  } catch {
    return "公司图标未保存，岗位已保存。再次导入可重试补图。";
  }
}
