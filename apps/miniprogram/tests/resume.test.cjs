const test = require("node:test");
const assert = require("node:assert/strict");
const { formatUpdatedAt } = require("../utils/resume");

test("resume service uses metadata and PNG preview download APIs", async () => {
  const requests = [];
  const downloads = [];
  require.cache[require.resolve("../utils/request")] = {
    exports: {
      request: async (path) => {
        requests.push(path);
        return path === "/api/miniprogram/resumes" ? { resumes: [] } : { resume: { id: "42" } };
      },
      download: async (...args) => { downloads.push(args); return args[1]; },
    },
  };
  delete require.cache[require.resolve("../services/resumes")];
  const resumes = require("../services/resumes");

  await resumes.listResumes();
  await resumes.getResume("42");
  await resumes.downloadResumePreview("42", "9", "/data/resume.png");

  assert.deepEqual(requests, [
    "/api/miniprogram/resumes",
    "/api/miniprogram/resumes/42",
  ]);
  assert.deepEqual(downloads[0].slice(0, 2), [
    "/api/miniprogram/resumes/42/preview.png?version_id=9",
    "/data/resume.png",
  ]);
});

test("preview cache hits only the same owner, resume and version", async () => {
  const storage = {};
  const files = new Set();
  const legacyPath = "/user/linkcv-resume-7-42-8.pdf";
  storage.linkcv_resume_pdf_cache_v1 = {
    "7:42": { ownerId: "7", versionId: "8", filePath: legacyPath },
  };
  files.add(legacyPath);
  global.wx = {
    env: { USER_DATA_PATH: "/user" },
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    removeStorageSync: (key) => { delete storage[key]; },
    getImageInfo({ src, success, fail }) {
      if (files.has(src) && src.endsWith(".png")) success({ width: 1440, height: 2037 });
      else fail();
    },
    getFileSystemManager: () => ({
      access({ path, success, fail }) { files.has(path) ? success() : fail(); },
      unlink({ filePath, success }) { files.delete(filePath); success(); },
    }),
  };
  delete require.cache[require.resolve("../services/resumePreviewCache")];
  const cache = require("../services/resumePreviewCache");
  const path = cache.resumePreviewPath("7", "42", "9");
  assert.match(path, /linkcv-preview-v1-/);
  files.add(path);
  await cache.commitResumePreview("7", "42", "9", path);

  assert.equal(storage.linkcv_resume_pdf_cache_v1, undefined);
  assert.equal(files.has(legacyPath), false);
  assert.equal(await cache.getCachedResumePreview("7", "42", "9"), path);
  assert.equal(await cache.getCachedResumePreview("8", "42", "9"), null);
  assert.equal(await cache.getCachedResumePreview("7", "42", "10"), null);
  await cache.validateResumePreview(path);
  await assert.rejects(cache.validateResumePreview("/user/invalid.png"), /无法读取/);

  await cache.clearResumePreviewCache();
  assert.equal(files.has(path), false);
  delete global.wx;
});

test("formats resume update time for the list and handles invalid values", () => {
  assert.equal(formatUpdatedAt("2026-08-21T08:00:00Z"), "更新于 2026年8月21日");
  assert.equal(formatUpdatedAt("not-a-date"), "更新时间未知");
  assert.equal(formatUpdatedAt(null), "更新时间未知");
});
