import { candidateOrigins } from '../src/api/linkresume';
import { parseBridgeCommand } from '../src/bridge';

export default defineContentScript({
  matches: candidateOrigins().map((origin) => `${origin}/*`),
  main() {
    if (window.top !== window || !candidateOrigins().includes(location.origin)) return;
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'linkresume:web') return;
      const id = event.data.requestId;
      const command = parseBridgeCommand(event.data);
      if (!command || typeof id !== 'string' || id.length > 100) return;
      browser.runtime.sendMessage({ type: 'lr:bridge', ...command }).then((result) => {
        window.postMessage({ source: 'linkresume:extension', requestId: id, result }, location.origin);
      }).catch(() => {
        window.postMessage({ source: 'linkresume:extension', requestId: id, result: { ok: false, error: '插件连接失败，请重新加载插件' } }, location.origin);
      });
    });
  },
});
