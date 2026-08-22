const { download, request } = require("../utils/request");

async function listResumes() {
  const body = await request("/api/miniprogram/resumes");
  return body.resumes || [];
}

async function getResume(id) {
  const body = await request(`/api/miniprogram/resumes/${encodeURIComponent(id)}`);
  return body.resume;
}

async function downloadResumePreview(id, versionId, filePath, onProgress) {
  const query = `version_id=${encodeURIComponent(versionId)}`;
  return download(
    `/api/miniprogram/resumes/${encodeURIComponent(id)}/preview.png?${query}`,
    filePath,
    onProgress,
  );
}

module.exports = { downloadResumePreview, getResume, listResumes };
