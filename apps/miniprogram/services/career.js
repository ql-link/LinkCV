const { request, download } = require("../utils/request");
const root = "/api/miniprogram/career";
const id = encodeURIComponent;
function query(options = {}) {
  const names = {
    applicationId: "application_id",
    startAt: "start_at",
    endAt: "end_at",
    stageType: "stage_type",
  };
  const params = Object.keys(options)
    .filter((key) => options[key] !== undefined && options[key] !== "")
    .map((key) => `${names[key] || key}=${encodeURIComponent(options[key])}`);
  return params.length ? `?${params.join("&")}` : "";
}
const write = (path, data, method = "POST") =>
  request(root + path, { method, data });
module.exports = {
  listApplications: (options) =>
    request(`${root}/applications${query(options)}`),
  listSessions: (options) => request(`${root}/sessions${query(options)}`),
  getApplication: (value) => request(`${root}/applications/${id(value)}`),
  getSession: (value) => request(`${root}/sessions/${id(value)}`),
  addStage: (value, data) => write(`/applications/${id(value)}/stages`, data),
  saveOffer: (value, data) => write(`/applications/${id(value)}/offer`, data),
  terminateApplication: (value, data) =>
    write(`/applications/${id(value)}/terminate`, data),
  createSession: (value, data) =>
    write(`/applications/${id(value)}/sessions`, data),
  updateSession: (value, data) => write(`/sessions/${id(value)}`, data, "PUT"),
  rescheduleSession: (value, data) =>
    write(`/sessions/${id(value)}/reschedule`, data),
  completeSession: (value, data) =>
    write(`/sessions/${id(value)}/complete`, data),
  cancelSession: (value, data) => write(`/sessions/${id(value)}/cancel`, data),
  downloadApplicationResume: (value) =>
    download(`${root}/applications/${id(value)}/resume-preview.png`),
};
