const auth = require("../services/auth");

let refreshPromise = null;

function send(path, options, accessToken) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: auth.apiUrl(path),
      method: options.method || "GET",
      data: options.data,
      header: {
        "content-type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      success: resolve,
      fail: reject,
    });
  });
}

async function renewAccess() {
  if (!refreshPromise) {
    refreshPromise = auth.refreshSession()
      .catch(async (error) => {
        if (error.statusCode !== 401) throw error;
        await auth.loginExistingAccount();
        return auth.getAccessToken();
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request(path, options = {}) {
  await auth.ensureSession();
  let response = await send(path, options, auth.getAccessToken());
  if (response.statusCode === 401) {
    const accessToken = await renewAccess();
    response = await send(path, options, accessToken);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error((response.data && response.data.error) || `HTTP_${response.statusCode}`);
    error.statusCode = response.statusCode;
    throw error;
  }
  return response.data;
}

function sendDownload(path, filePath, accessToken, onProgress) {
  return new Promise((resolve, reject) => {
    const task = wx.downloadFile({
      url: auth.apiUrl(path),
      filePath,
      header: { Authorization: `Bearer ${accessToken}` },
      success: resolve,
      fail: (result) => reject(new Error(result.errMsg || "简历下载失败")),
    });
    if (onProgress && task && typeof task.onProgressUpdate === "function") {
      task.onProgressUpdate(onProgress);
    }
  });
}

async function download(path, filePath, onProgress) {
  await auth.ensureSession();
  let response = await sendDownload(path, filePath, auth.getAccessToken(), onProgress);
  if (response.statusCode === 401) {
    const accessToken = await renewAccess();
    response = await sendDownload(path, filePath, accessToken, onProgress);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error(`HTTP_${response.statusCode}`);
    error.statusCode = response.statusCode;
    throw error;
  }
  return response.filePath || filePath || response.tempFilePath;
}

module.exports = { download, request };
