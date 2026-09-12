import { describe, expect, it, vi } from "vitest";
import { installCryptoRandomUuid } from "./randomUuid";

describe("random UUID compatibility", () => {
  it("keeps the browser native implementation when it is available", () => {
    const nativeUuid = vi.fn<Crypto["randomUUID"]>(
      () => "11111111-1111-4111-8111-111111111111",
    );
    const getRandomValues = vi.fn() as unknown as Crypto["getRandomValues"];
    const cryptoApi = {
      randomUUID: nativeUuid,
      getRandomValues,
    };

    installCryptoRandomUuid(cryptoApi);

    expect(cryptoApi.randomUUID()).toBe("11111111-1111-4111-8111-111111111111");
    expect(nativeUuid).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("installs a valid UUID v4 implementation when randomUUID is unavailable", () => {
    const cryptoApi: {
      randomUUID?: Crypto["randomUUID"];
      getRandomValues: Crypto["getRandomValues"];
    } = {
      getRandomValues: ((bytes: Uint8Array) => {
        bytes.fill(0);
        return bytes;
      }) as Crypto["getRandomValues"],
    };

    installCryptoRandomUuid(cryptoApi);

    expect(cryptoApi.randomUUID?.()).toBe("00000000-0000-4000-8000-000000000000");
  });
});
