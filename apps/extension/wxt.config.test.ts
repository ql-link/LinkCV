import { expect, it, vi } from 'vitest';

vi.mock('wxt', () => ({ defineConfig: (config: unknown) => config }));
import config from './wxt.config';

it('can read tab URLs before site access is granted while retaining per-site optional access', async () => {
  const manifest = await config.manifest;
  if (!manifest || typeof manifest === 'function') throw new Error('Expected a static extension manifest');
  expect(manifest.permissions).toContain('tabs');
  expect(manifest.optional_host_permissions).toEqual(['https://*/*', 'http://*/*']);
  expect(manifest.host_permissions).not.toContain('https://*/*');
  expect(manifest.host_permissions).not.toContain('http://*/*');
});
