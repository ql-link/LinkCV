import { DEFAULT_PREFS, type PlanPrefs } from './decide/plan';
export type Settings = PlanPrefs & { addRows: boolean };
export const DEFAULT_SETTINGS: Settings = { ...DEFAULT_PREFS };
const SETTINGS_KEY = 'autofill.settings';
export async function getSettings(): Promise<Settings> {
  const stored = (await browser.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}
export const saveSettings = (settings: Settings) => browser.storage.local.set({ [SETTINGS_KEY]: settings });
export function onStorageChange(listener: () => void) {
  const handler = (_: unknown, area: string) => { if (area === 'local' || area === 'session') listener(); };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}
