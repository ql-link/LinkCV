const { request } = require("../utils/request");

async function getOverview(options = {}) {
  const params = [];
  if (options.weekStart) params.push(`week_start=${encodeURIComponent(options.weekStart)}`);
  if (options.timezone) params.push(`timezone=${encodeURIComponent(options.timezone)}`);
  const qs = params.length > 0 ? `?${params.join("&")}` : "";
  return request(`/api/miniprogram/career/overview${qs}`);
}

async function listSessions(options = {}) {
  const params = [];
  if (options.scope) params.push(`scope=${encodeURIComponent(options.scope)}`);
  if (options.status) params.push(`status=${encodeURIComponent(options.status)}`);
  if (options.stageType) params.push(`stage_type=${encodeURIComponent(options.stageType)}`);
  if (typeof options.upcoming === "boolean") params.push(`upcoming=${options.upcoming ? "true" : "false"}`);
  if (options.cursor) params.push(`cursor=${encodeURIComponent(options.cursor)}`);
  if (options.limit) params.push(`limit=${options.limit}`);
  const qs = params.length > 0 ? `?${params.join("&")}` : "";
  return request(`/api/miniprogram/career/sessions${qs}`);
}

async function listApplications(options = {}) {
  const params = [];
  if (options.scope) params.push(`scope=${encodeURIComponent(options.scope)}`);
  if (options.keyword) params.push(`keyword=${encodeURIComponent(options.keyword)}`);
  if (options.status) params.push(`status=${encodeURIComponent(options.status)}`);
  if (options.stageType) params.push(`stage_type=${encodeURIComponent(options.stageType)}`);
  if (options.cursor) params.push(`cursor=${encodeURIComponent(options.cursor)}`);
  if (options.limit) params.push(`limit=${options.limit}`);
  const qs = params.length > 0 ? `?${params.join("&")}` : "";
  return request(`/api/miniprogram/career/applications${qs}`);
}

async function advanceApplication(applicationId, payload) {
  return request(`/api/miniprogram/career/applications/${encodeURIComponent(applicationId)}/advance`, {
    method: "POST",
    data: payload,
  });
}

async function closeApplication(applicationId, payload) {
  return request(`/api/miniprogram/career/applications/${encodeURIComponent(applicationId)}/close`, {
    method: "POST",
    data: payload,
  });
}

async function completeSession(sessionId, payload) {
  return request(`/api/miniprogram/career/sessions/${encodeURIComponent(sessionId)}/complete`, {
    method: "POST",
    data: payload,
  });
}

module.exports = {
  getOverview,
  listSessions,
  listApplications,
  advanceApplication,
  closeApplication,
  completeSession,
};
