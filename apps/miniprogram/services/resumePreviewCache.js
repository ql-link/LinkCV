const CACHE_KEY = "linkcv_resume_preview_cache_v1";
const LEGACY_CACHE_KEYS = ["linkcv_resume_pdf_cache_v1", "linkcv_resume_pdf_cache_v2"];
let legacyCleanupPromise;

function cacheIndex() {
  const value = wx.getStorageSync(CACHE_KEY);
  return value && typeof value === "object" ? value : {};
}

function saveIndex(index) {
  wx.setStorageSync(CACHE_KEY, index);
}

function entryKey(ownerId, resumeId) {
  return `${ownerId}:${resumeId}`;
}

function safePart(value) {
  return String(value).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

function resumePreviewPath(ownerId, resumeId, versionId) {
  return `${wx.env.USER_DATA_PATH}/linkcv-preview-v1-${safePart(ownerId)}-${safePart(resumeId)}-${safePart(versionId)}.png`;
}

function accessFile(filePath) {
  if (!wx.getFileSystemManager) return Promise.resolve(false);
  return new Promise((resolve) => {
    wx.getFileSystemManager().access({
      path: filePath,
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

function removeFile(filePath) {
  if (!filePath || !wx.getFileSystemManager) return Promise.resolve();
  return new Promise((resolve) => {
    wx.getFileSystemManager().unlink({
      filePath,
      success: resolve,
      fail: resolve,
    });
  });
}

function validateResumePreview(filePath) {
  if (!filePath || typeof wx.getImageInfo !== "function") {
    return Promise.reject(new Error("预览图无法读取"));
  }
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: filePath,
      success: ({ width, height }) => {
        if (width > 0 && height > 0) resolve();
        else reject(new Error("预览图尺寸无效"));
      },
      fail: () => reject(new Error("预览图无法读取")),
    });
  });
}

function clearLegacyCaches() {
  if (legacyCleanupPromise) return legacyCleanupPromise;
  const filePaths = LEGACY_CACHE_KEYS.flatMap((key) => {
    const value = wx.getStorageSync(key);
    wx.removeStorageSync(key);
    return value && typeof value === "object"
      ? Object.values(value).map((entry) => entry && entry.filePath).filter(Boolean)
      : [];
  });
  legacyCleanupPromise = Promise.all(filePaths.map(removeFile)).then(() => undefined);
  return legacyCleanupPromise;
}

async function getCachedResumePreview(ownerId, resumeId, versionId) {
  await clearLegacyCaches();
  const index = cacheIndex();
  const key = entryKey(ownerId, resumeId);
  const entry = index[key];
  if (!entry || String(entry.versionId) !== String(versionId)) return null;
  if (await accessFile(entry.filePath)) return entry.filePath;
  delete index[key];
  saveIndex(index);
  return null;
}

async function commitResumePreview(ownerId, resumeId, versionId, filePath) {
  await clearLegacyCaches();
  const index = cacheIndex();
  const key = entryKey(ownerId, resumeId);
  const previous = index[key];
  index[key] = { ownerId: String(ownerId), versionId: String(versionId), filePath };
  saveIndex(index);
  if (previous && previous.filePath !== filePath) await removeFile(previous.filePath);
}

async function invalidateResumePreview(ownerId, resumeId) {
  await clearLegacyCaches();
  const index = cacheIndex();
  const key = entryKey(ownerId, resumeId);
  const entry = index[key];
  delete index[key];
  saveIndex(index);
  if (entry) await removeFile(entry.filePath);
}

async function clearResumePreviewCache() {
  await clearLegacyCaches();
  const index = cacheIndex();
  wx.removeStorageSync(CACHE_KEY);
  await Promise.all(Object.values(index).map((entry) => removeFile(entry && entry.filePath)));
}

module.exports = {
  clearResumePreviewCache,
  commitResumePreview,
  getCachedResumePreview,
  invalidateResumePreview,
  removeFile,
  resumePreviewPath,
  validateResumePreview,
};
