// Prepare the next native page environment before the user taps a tab.
let assetsStarted = false;
function prepare() {
  if (typeof wx.preloadWebview === 'function') {
    try { wx.preloadWebview({ fail() {} }); } catch (_) { /* Optional optimization. */ }
  }
  if (assetsStarted || typeof wx.preloadAssets !== 'function') return;
  assetsStarted = true;
  const paths = ['/assets/linkresume-wordmark.png'];
  for (const icon of ['resume', 'career', 'profile']) {
    paths.push(`/assets/career/tab-${icon}.svg`, `/assets/career/tab-${icon}-active.svg`);
  }
  try {
    wx.preloadAssets({
      data: paths.map(src => ({ type: 'image', src })),
      fail() { assetsStarted = false; },
    });
  } catch (_) { assetsStarted = false; }
}
module.exports = { prepare };
