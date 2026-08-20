import assert from "node:assert/strict";
import test from "node:test";

import { bearerToken, tokensEqual } from "../src/auth.js";
import { isUnsafeSecret, loadConfig } from "../src/config.js";

test("service authentication requires an exact bearer token", () => {
  assert.equal(bearerToken({ authorization: "Bearer abc" }), "abc");
  assert.equal(bearerToken({ authorization: "Basic abc" }), null);
  assert.equal(tokensEqual("same", "same"), true);
  assert.equal(tokensEqual("same", "different"), false);
});

test("production rejects missing or placeholder service tokens", () => {
  assert.equal(isUnsafeSecret("replace-with-a-real-token"), true);
  assert.throws(() => loadConfig({ APP_ENV: "production" }), /missing or unsafe/);
});
