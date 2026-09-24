const { download, request } = require("../utils/request");

async function listResumes() {
  const body = await request("/api/miniprogram/v2/resumes");
  return body.resumes || [];
}

async function getResume(id) {
  const body = await request(`/api/miniprogram/v2/resumes/${encodeURIComponent(id)}`);
  return body.resume;
}

async function downloadResumePreview(id, lockVersion, filePath, onProgress) {
  const query = `lock_version=${encodeURIComponent(lockVersion)}`;
  return download(
    `/api/miniprogram/v2/resumes/${encodeURIComponent(id)}/preview.png?${query}`,
    filePath,
    onProgress,
  );
}

module.exports = { downloadResumePreview, getResume, listResumes };
