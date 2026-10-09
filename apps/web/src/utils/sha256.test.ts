import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Text } from "./sha256";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sha256Text", () => {
  it("uses native Web Crypto when available", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const digest = vi.spyOn(webcrypto.subtle, "digest");

    expect(await sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(digest).toHaveBeenCalledOnce();
  });

  it.each(["", "abc", "中文简历\n项目经验 😀", "a".repeat(55), "a".repeat(56), "a".repeat(64), "项目".repeat(500)])(
    "matches SHA-256 for UTF-8 text without Web Crypto (case %#)",
    async (text) => {
      vi.stubGlobal("crypto", {});
      expect(await sha256Text(text)).toBe(createHash("sha256").update(text, "utf8").digest("hex"));
    },
  );

  it("falls back when native digest rejects", async () => {
    vi.stubGlobal("crypto", { subtle: { digest: vi.fn().mockRejectedValue(new Error("Unavailable")) } });
    expect(await sha256Text("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
