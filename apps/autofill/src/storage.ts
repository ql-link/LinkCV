// 设置与简历都只存在本机 browser.storage.local。
import { DEFAULT_JEV, type JevSettings } from './decide/jev';
import { DEFAULT_PREFS, type PlanPrefs } from './decide/plan';
import type { Profile } from './profile/profile';

export type Settings = JevSettings & PlanPrefs & { addRows: boolean };

export const DEFAULT_SETTINGS: Settings = { ...DEFAULT_JEV, ...DEFAULT_PREFS };

const SETTINGS_KEY = 'settings';
const PROFILE_KEY = 'profile';

export async function getSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(settings: Settings) {
  return browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getProfile(): Promise<Profile | null> {
  return ((await browser.storage.local.get(PROFILE_KEY))[PROFILE_KEY] as Profile | undefined) ?? null;
}

export function saveProfile(profile: Profile) {
  return browser.storage.local.set({ [PROFILE_KEY]: profile });
}

export function clearProfile() {
  return browser.storage.local.remove(PROFILE_KEY);
}

export function onStorageChange(listener: () => void) {
  const handler = (_: unknown, area: string) => {
    if (area === 'local') listener();
  };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}

// 默认接口已在 manifest 中声明；自定义接口需要额外授权，必须在用户点击时调用。
export async function ensureEndpointPermission(endpoint: string) {
  const origin = new URL(endpoint).origin;
  const origins = [`${origin}/*`];
  if (await browser.permissions.contains({ origins })) return true;
  return browser.permissions.request({ origins });
}
