import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { currentValue, scanPage } from './scanner';

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON() {} });
});
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
const site = { level2_class: '.mtd-form-item-body .label' };

it('does not borrow a later name label for referral or job choices', () => {
  document.body.innerHTML = '<input placeholder="请输入内推码"><h2>校招意向</h2><div class="mtd-form-item"><label class="mtd-form-item-label">第一志愿 *</label><div class="mtd-form-item-body"><div class="mtd-select"><input><span class="mtd-select-filter-label mtd-select-filter-hint">请选择职位</span></div></div></div><h2>基础信息</h2><div class="mtd-form-item"><div class="mtd-form-item-body"><span class="label">姓名 *</span><input placeholder="请输入你的真实姓名"></div></div>';
  const fields = scanPage(site);
  expect(fields.map(f => f.label)).toEqual(['', '第一志愿', '姓名']);
  expect(fields[1]).toMatchObject({ kind: 'custom-select', placeholder: '请选择职位', section: '校招意向' });
});

it('uses explicit accessibility labels and captures the certificate-type placeholder', () => {
  document.body.innerHTML = '<div class="mtd-form-item"><div class="mtd-form-item-body"><span class="label">证件号码</span><div class="mtd-select"><input aria-label="证件类型"><span class="mtd-select-filter-hint">请选择证件类型</span></div></div></div>';
  expect(scanPage(site)[0]).toMatchObject({ label: '证件类型', placeholder: '请选择证件类型', kind: 'custom-select' });
});

it('preserves committed select labels even when its search input is empty', () => {
  document.body.innerHTML = '<div class="mtd-select"><input aria-label="学校名称"><span class="mtd-select-filter-label">示例大学</span></div><div class="mtd-select mtd-select-multiple"><input aria-label="城市"></div>';
  expect(currentValue(document.querySelector('input')!)).toBe('示例大学');
  expect(scanPage(site).map(f => ({ hasValue: f.hasValue, isMultiple: f.isMultiple }))).toEqual([
    { hasValue: true, isMultiple: false }, { hasValue: false, isMultiple: true },
  ]);
});
