import { apiRequest, candidateOrigins } from '../src/api/linkresume';
import { clearSnapshot, loadSnapshot, saveSnapshot, selectedSnapshot } from '../src/api/autofill';
import { parseBridgeCommand } from '../src/bridge';

export default defineBackground(() => {
  browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  void browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  void browser.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  let authRevision = 0;
  let selectionRevision = 0;
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if ((message as { type?: string } | null)?.type !== 'lr:bridge' || !sender.tab || sender.frameId !== 0 || !sender.url) return;
    const origin = new URL(sender.url).origin;
    if (!candidateOrigins().includes(origin)) return;
    const command = parseBridgeCommand(message);
    if (!command) return;
    if (command.command === 'PING') return Promise.resolve({ ok: true, version: browser.runtime.getManifest().version });
    if (command.command === 'AUTH_CHANGED') authRevision++;
    if (command.command === 'SELECT_RESUME') selectionRevision++;
    const revision = authRevision;
    const selection = selectionRevision;
    return (async () => {
      try {
        const { user } = await apiRequest<{ user: { id: string; email: string | null } | null }>(origin, '/api/auth/me');
        if (command.command === 'AUTH_CHANGED') {
          const selected = await selectedSnapshot();
          if (selected?.origin === origin && selected.snapshot.user_id !== user?.id) await clearSnapshot();
          return { ok: true };
        }
        if (!user) { await clearSnapshot(); return { ok: false, error: '请先登录 LinkResume' }; }
        const snapshot = await loadSnapshot({ origin, user }, command.resumeId);
        if (revision !== authRevision || selection !== selectionRevision) return { ok: false, error: '账户或所选简历已变化，请重试' };
        await saveSnapshot(origin, snapshot);
        return { ok: true, title: snapshot.title };
      } catch {
        return { ok: false, error: '无法导入简历，请检查登录状态后重试' };
      }
    })();
  });
});
