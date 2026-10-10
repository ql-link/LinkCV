// 侧边栏与页面内容脚本之间的消息。
import type { ListGroup } from './profile/keys';
import type { ScannedField } from './scan/scanner';
import type { AddRowsReport } from './scan/add-rows';
import type { FillStatus } from './writer/types';
import type { PlanStatus } from './decide/plan';

export type ToContent = (
  | { type: 'af:ping' }
  | { type: 'af:prepare'; wanted: Partial<Record<ListGroup, number>>; addRows: boolean }
  | { type: 'af:scan' }
  | { type: 'af:fill'; keepExisting: boolean; items: { uid: string; value: string; label: string }[] }
  | { type: 'af:mark'; marks: { uid: string; status: MarkStatus }[] }
  | { type: 'af:focus'; uid: string }
  | { type: 'af:clear' }
  | { type: 'af:clear-values' }
  | { type: 'af:stop' }
) & { documentToken?: string; pageUrl?: string; runId?: string };

export type MarkStatus = 'filled' | 'pending' | 'none';

export interface PrepareResult {
  site: string | null;
  rows: AddRowsReport[];
}

export type ScanResult = ScannedField[];

export type FillResult = Record<string, FillStatus>;

export interface FillProgress {
  type: 'af:progress';
  documentToken: string;
  runId: string;
  done: number;
  total: number;
}

export function markOf(plan: PlanStatus, fill?: FillStatus): MarkStatus {
  if (plan === 'none') return 'none';
  if (plan === 'kept') return 'filled';
  if (plan === 'fill' && (fill === 'filled' || fill === 'kept')) return 'filled';
  return 'pending';
}
