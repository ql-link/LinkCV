const { request } = require("../utils/request");

async function listResumes() {
  const body = await request("/api/resumes");
  return body.resumes || [];
}

async function getResume(id) {
  const body = await request(`/api/resumes/${encodeURIComponent(id)}`);
  return body.resume;
}

module.exports = { getResume, listResumes };
