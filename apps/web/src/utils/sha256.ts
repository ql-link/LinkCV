export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    try {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    } catch {
      // Use the same SHA-256 algorithm when Web Crypto is unavailable or refuses the operation.
    }
  }
  const { sha256 } = await import("@noble/hashes/sha2.js");
  return Array.from(sha256(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}
