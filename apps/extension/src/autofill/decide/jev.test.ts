import { afterEach, expect, it, vi } from 'vitest';
import { decideAll } from './jev';
import { apiRequest } from '../../api/linkresume';
import type { ScannedField } from '../scan/scanner';

vi.mock('../../api/linkresume', () => ({ apiRequest: vi.fn(), LinkResumeApiError: class extends Error {} }));
afterEach(() => vi.resetAllMocks());
const field = (uid: string, label: string, section: string): ScannedField => ({ uid, label, section, placeholder: '', kind: 'input:text', options: [], isChoice: false, group: null, hasValue: false });

it('skips applicant choices without sending them to the model', async () => {
  vi.mocked(apiRequest).mockResolvedValue({ choice: 'basics.name', prob: 1, ranked: [] });
  const progress = vi.fn();
  const results = await decideAll([field('job', '第一志愿', '校招意向'), field('name', '姓名', '基础信息')], 'http://localhost:5173', { onProgress: progress });
  expect(results.get('job')).toMatchObject({ choice: 'none' });
  expect(results.get('name')).toMatchObject({ choice: 'basics.name' });
  expect(apiRequest).toHaveBeenCalledTimes(1);
  expect(JSON.parse(vi.mocked(apiRequest).mock.calls[0]![2]!.body as string).field.uid).toBe('name');
  expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
});
