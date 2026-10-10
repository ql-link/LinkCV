import { apiRequest, type LinkResumeConnection } from './linkresume';
import type { Profile } from '../autofill/profile/profile';

export interface ExtensionResume { id: string; title: string; lock_version: number; updated_at: string }
export interface AutofillSnapshot {
  version: 1; user_id: string; resume_id: string; title: string; lock_version: number;
  profile_lock_version: number | null; updated_at: string; profile: Profile; warnings: string[]; missing: string[];
}
export const SNAPSHOT_KEY = 'autofill.snapshot';
export type SelectedSnapshot = { origin: string; snapshot: AutofillSnapshot };
export async function loadResumeList(connection: LinkResumeConnection) {
  const result = await apiRequest<{ user_id: string; resumes: ExtensionResume[] }>(connection.origin, '/api/browser-extension/resumes');
  if (result.user_id !== connection.user?.id) throw new Error('账户已切换，请重新连接');
  return result.resumes;
}
export async function loadSnapshot(connection: LinkResumeConnection, resumeId: string, signal?: AbortSignal) {
  const snapshot = await apiRequest<AutofillSnapshot>(connection.origin, `/api/resumes/${encodeURIComponent(resumeId)}/autofill-profile`, { signal });
  if (snapshot.version !== 1 || snapshot.user_id !== connection.user?.id || snapshot.resume_id !== resumeId) {
    await clearSnapshot();
    throw new Error('账户或资料已变化，请重新选择简历');
  }
  return snapshot;
}
export const clearSnapshot = () => browser.storage.session.remove(SNAPSHOT_KEY);
export const saveSnapshot = (origin: string, snapshot: AutofillSnapshot) => browser.storage.session.set({ [SNAPSHOT_KEY]: { origin, snapshot } });
export async function selectedSnapshot(): Promise<SelectedSnapshot | null> {
  return ((await browser.storage.session.get(SNAPSHOT_KEY))[SNAPSHOT_KEY] as SelectedSnapshot | undefined) ?? null;
}
