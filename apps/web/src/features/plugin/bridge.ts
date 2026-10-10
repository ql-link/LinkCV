interface PluginResult { ok: boolean; version?: string; title?: string; error?: string }
export function sendPluginCommand(command: 'PING' | 'SELECT_RESUME' | 'AUTH_CHANGED', resumeId?: string): Promise<PluginResult> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'linkresume:extension' || event.data.requestId !== requestId) return;
      cleanup();
      const result = event.data.result as PluginResult | undefined;
      if (!result || typeof result.ok !== 'boolean') { reject(new Error('插件响应无效，请更新插件')); return; }
      if (!result.ok) { reject(new Error(result.error || '插件操作失败')); return; }
      resolve(result);
    };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('未连接到 LinkResume 插件，请安装或更新插件，并刷新当前页面')); }, 5000);
    const cleanup = () => { window.clearTimeout(timer); window.removeEventListener('message', onMessage); };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: 'linkresume:web', requestId, command, ...(resumeId ? { resumeId } : {}) }, location.origin);
  });
}
