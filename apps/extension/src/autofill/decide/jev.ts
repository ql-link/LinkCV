// Only bounded page metadata reaches LinkResume; profile values stay in the extension.
import { apiRequest, LinkResumeApiError } from '../../api/linkresume';
import type { ScannedField } from '../scan/scanner';
export const NONE = 'none';
export interface Decision { choice: string; prob: number; ranked: [string, number][] }
export type DecisionResult = Decision | { error: string };
export async function decideAll(fields: ScannedField[], origin: string,
  { onProgress, signal }: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
): Promise<Map<string, DecisionResult>> {
  const results = new Map<string, DecisionResult>();
  let next = 0;
  let done = 0;
  let fatal: string | null = null;
  const worker = async () => {
    while (next < fields.length && !signal?.aborted) {
      const field = fields[next++]!;
      try {
        if (fatal) throw new Error(fatal);
        const result = await apiRequest<Decision>(origin, '/api/browser-extension/autofill/decisions', {
          method: 'POST', body: JSON.stringify({ version: 1, field: {
            uid: field.uid.slice(0, 128), section: field.section.slice(0, 200), label: field.label.slice(0, 300),
            placeholder: field.placeholder.slice(0, 300), kind: field.kind.slice(0, 80),
            options: field.options.slice(0, 6).map((option) => option.slice(0, 200)),
          } }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
        });
        results.set(field.uid, result);
      } catch (error) {
        const messages: Record<string, string> = { LLM_MODEL_NOT_CONFIGURED: '管理员尚未配置网申字段识别模型', AUTOFILL_RATE_LIMITED: '识别次数较多，请稍后重试', SESSION_INVALID: '登录已失效，请重新登录' };
        const message = error instanceof LinkResumeApiError ? messages[error.code] ?? '字段识别暂时不可用'
          : error instanceof Error ? error.message : '字段识别失败';
        if (error instanceof LinkResumeApiError && [401, 429, 503].includes(error.status)) fatal = message;
        results.set(field.uid, { error: message });
      }
      onProgress?.(++done, fields.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, fields.length) }, worker));
  return results;
}
