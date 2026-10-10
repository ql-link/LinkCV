import { cleanText, currentValue, elementByUid, scanPage } from '../scan/scanner';
import { isVisible, sleep } from './dom.js';
import { typeText } from './input.js';
import type { SiteConfig } from './types';

export interface ClearReport {
  cleared: number;
  empty: number;
  failed: string[];
}

const CHOICE = '.ant-select, .ant-cascader, .ant-picker, .el-select, .el-cascader, .el-date-editor, .ivu-select, .ivu-date-picker, .mtd-select, .mtd-date-picker, .atsx-select, [role="combobox"]';
const SELECTED = '.ant-select-selection-item, .ant-select-selection-selected-value, .el-select__selected-item:not(.is-transparent), .ivu-select-selected-value, .mtd-select-filter-label:not(.mtd-select-filter-hint)';
const CLEAR = '.ant-select-clear, .ant-picker-clear, .ant-cascader-picker-clear, .el-select__clear, .el-input__clear, .ivu-select-arrow .ivu-icon-ios-close, .mtd-select-filter-delete, .mtd-input-clear, .atsx-select-clear';

function valueOf(el: HTMLElement) {
  if (el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type)) return el.checked ? 'checked' : '';
  const owner = el.closest(CHOICE);
  const selected = owner && Array.from(owner.querySelectorAll(SELECTED)).map((n) => cleanText(n.textContent)).filter(Boolean).join('、');
  return selected || currentValue(el);
}

function disabled(el: HTMLElement) {
  return el.matches(':disabled, [aria-disabled="true"]') || !!el.closest('.mtd-select-disabled, .ant-select-disabled, .el-select.is-disabled, .ivu-select-disabled');
}

async function clearField(el: HTMLElement) {
  if (disabled(el)) return false;
  if (el instanceof HTMLInputElement && /^(checkbox|radio)$/.test(el.type)) {
    // checkbox.click() updates both the browser state and the owning framework.
    if (el.type === 'radio') return false;
    el.click();
  } else if (el instanceof HTMLSelectElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(el, '');
    if (el.multiple) Array.from(el.options).forEach((option) => { option.selected = false; });
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    const owner = el.closest(CHOICE);
    const clear = owner?.querySelector<HTMLElement>(CLEAR);
    if (clear) clear.click();
    else if (!owner || !owner.querySelector(SELECTED)) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || el.readOnly) return false;
      await typeText(el, '');
      el.blur();
    } else return false;
  }
  await sleep(60);
  return !valueOf(el);
}

/** Clear the current page, independent of previous runs. Never reset hidden data or uploaded files. */
export async function clearAllFields(site: SiteConfig | null, signal: AbortSignal): Promise<ClearReport> {
  type Field = { element: HTMLElement | null; label: string };
  const toggles: Field[] = [];
  // Form checkboxes such as "至今" are not scanned for model decisions.
  document.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]').forEach((element) => {
    const owner = element.closest('label, [class*="checkbox"], [class*="radio"]') ?? element;
    if (!isVisible(owner) || disabled(element)) return;
    toggles.push({ element, label: cleanText(owner.textContent) || '勾选项' });
  });
  const report: ClearReport = { cleared: 0, empty: 0, failed: [] };
  const cleared: Field[] = [];
  const process = async (field: Field) => {
    if (signal.aborted) throw new Error('页面已刷新或切换，清除已停止');
    const el = field.element;
    if (!el?.isConnected) return;
    if (!valueOf(el)) { report.empty++; return; }
    try {
      if (await clearField(el)) cleared.push(field);
      else report.failed.push(field.label);
    } catch { report.failed.push(field.label); }
  };
  // Unchecking "至今" can re-enable a date field, so scan after toggles settle.
  for (const field of toggles) await process(field);
  const fields = scanPage(site).map((field): Field => ({
    element: elementByUid(field.uid),
    label: [field.section, field.label || field.placeholder || '未命名字段'].filter(Boolean).join(' · '),
  }));
  // Clear dependent children first: resetting the job can disable its department/city controls.
  for (const field of fields.reverse()) await process(field);
  // Dependent controls may restore defaults after another field changes.
  for (const field of cleared) {
    if (field.element?.isConnected && valueOf(field.element)) report.failed.push(field.label);
    else report.cleared++;
  }
  return report;
}
