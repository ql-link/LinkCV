import { timingSafeEqual } from "node:crypto";

export function bearerToken(headers) {
  const [scheme, value, ...rest] = (headers.authorization ?? "").split(" ");
  return scheme?.toLowerCase() === "bearer" && value && rest.length === 0 ? value : null;
}

export function tokensEqual(actual, expected) {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
