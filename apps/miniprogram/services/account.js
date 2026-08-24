const { download, request } = require("../utils/request");

async function getProfile() {
  return request("/api/miniprogram/account/profile");
}

async function updateNickname(nickname) {
  return request("/api/miniprogram/account/profile", {
    method: "PATCH",
    data: { nickname },
  });
}

async function uploadAvatarDataUrl(dataUrl, fileName) {
  return request("/api/miniprogram/account/avatar", {
    method: "PUT",
    data: { dataUrl, fileName },
  });
}

function downloadAvatar(filePath) {
  return download("/api/miniprogram/account/avatar", filePath);
}

module.exports = {
  downloadAvatar,
  getProfile,
  updateNickname,
  uploadAvatarDataUrl,
};
