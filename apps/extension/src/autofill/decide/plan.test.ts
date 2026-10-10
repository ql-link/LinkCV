import { expect, it } from 'vitest';
import { buildPlan, DEFAULT_PREFS, formatDate, formatValue } from './plan';
import type { ScannedField } from '../scan/scanner';

const field = (overrides: Partial<ScannedField> = {}): ScannedField => ({ uid: 'one', label: '姓名', section: '基础信息', placeholder: '', kind: 'input:text', options: [], isChoice: false, group: null, hasValue: false, ...overrides });
const decision = (choice: string, prob = 1) => ({ choice, prob, ranked: [] });
const plan = (f: ScannedField, key: string, profile: Parameters<typeof buildPlan>[2], prob = 1) => buildPlan([f], new Map([[f.uid, decision(key, prob)]]), profile, DEFAULT_PREFS)[0]!;

it.each(['第一志愿', '意向部门', '接受调剂'])('skips %s even when the model confidently chooses name', label => {
  expect(plan(field({ label, section: '校招意向' }), 'basics.name', { basics: { name: '张三' } })).toMatchObject({ status: 'none', value: null });
});

it('does not substitute job preferences for the type of a past work entry', () => {
  expect(plan(field({ label: '工作类型', section: '工作/实习经历' }), 'intent.jobType', { intent: { jobType: ['全职'] } })).toMatchObject({ status: 'none', value: null });
});

it('requires label semantics as well as model probability and never infers an unknown field', () => {
  expect(plan(field({ label: '学校名称', section: '教育经历' }), 'basics.name', { basics: { name: '张三' } }).status).toBe('pending');
  expect(plan(field({ label: '内容', section: '工作经历' }), 'work.summary', { work: [{ summary: '示例工作' }] }).status).toBe('pending');
  expect(plan(field(), 'basics.name', { basics: { name: '张三' } }, 0.89).status).toBe('pending');
  expect(plan(field(), 'basics.name', { basics: { name: '张三' } }).value).toBe('张三');
  expect(buildPlan([field()], new Map([['one', decision('basics.name', 0.89)]]), { basics: { name: '张三' } }, { ...DEFAULT_PREFS, minProb: 0.5 })[0]!.status).toBe('pending');
});

it('uses a specific placeholder to distinguish ID type from number', () => {
  const f = field({ label: '证件号码', placeholder: '请选择证件类型', isChoice: true });
  expect(plan(f, 'basics.idType', { basics: { idType: '身份证' } }).status).toBe('pending');
  // Conflicting metadata remains pending until the scanner supplies a clear label.
  expect(plan({ ...f, label: '证件类型' }, 'basics.idType', { basics: { idType: '身份证' } }).status).toBe('fill');
});

it('keeps work/internship wording variations from duplicating the first entry', () => {
  const fields = [field({ uid: 'a', label: '公司名称', section: '工作/实习经历' }), field({ uid: 'b', label: '公司名称', section: '工作/实习经历' })];
  const items = buildPlan(fields, new Map([['a', decision('work.company')], ['b', decision('internship.company')]]), { internship: [{ company: '示例甲公司' }, { company: '示例乙公司' }] }, DEFAULT_PREFS);
  expect(items.map(i => i.value)).toEqual(['示例甲公司', '示例乙公司']);
});

it('does not spill internship entries into extra rows when work entries exist', () => {
  const fields = [field({ uid: 'a', label: '公司名称', section: '工作经历' }), field({ uid: 'b', label: '公司名称', section: '工作经历' })];
  const items = buildPlan(fields, new Map([['a', decision('work.company')], ['b', decision('work.company')]]), { work: [{ company: '示例甲公司' }], internship: [{ company: '示例乙公司' }] }, DEFAULT_PREFS);
  expect(items.map(i => i.value)).toEqual(['示例甲公司', null]);
  expect(items[1]!.status).toBe('pending');
});

it('does not swap repeated start dates from two entries into a start/end range', () => {
  const fields = [field({ uid: 'a', label: '开始时间', section: '实习经历' }), field({ uid: 'b', label: '开始时间', section: '实习经历' })];
  const items = buildPlan(fields, new Map([['a', decision('internship.startDate')], ['b', decision('internship.startDate')]]), { internship: [{ startDate: '2024-09', endDate: '2024-12' }, { startDate: '2025-01', endDate: '2025-03' }] }, DEFAULT_PREFS);
  expect(items.map(i => i.value)).toEqual(['2024-09', '2025-01']);
});

it('keeps explicit year/month parts together without guessing an ambiguous date range', () => {
  const fields = [field({ uid: 'a', label: '入学时间', section: '教育经历', placeholder: '年' }), field({ uid: 'b', label: '入学时间', section: '教育经历', placeholder: '月' })];
  const items = buildPlan(fields, new Map([['a', decision('education.enrollDate')], ['b', decision('education.enrollDate')]]), { education: [{ enrollDate: '2024-09' }] }, DEFAULT_PREFS);
  expect(items.map(i => i.value)).toEqual(['2024', '9']);
  expect(plan(field({ label: '起止时间', section: '教育经历' }), 'education.enrollDate', { education: [{ enrollDate: '2024-09' }] }).status).toBe('pending');
});

it('does not guess a date day, a surname split, or one item from several choices', () => {
  expect(formatDate('2024-09', field({ kind: 'input:date' }))).toBeNull();
  expect(formatDate('2024-09-12', field({ kind: 'input:date' }))).toBe('2024-09-12');
  expect(formatValue('contact.city', ['示例甲市', '示例乙市'], field({ isChoice: true }))).toBeNull();
  expect(plan(field({ label: '中文姓氏' }), 'basics.lastNameZh', { basics: { name: '欧阳示例' } }).value).toBeNull();
  expect(plan(field({ isMultiple: true }), 'basics.name', { basics: { name: '张三' } }).status).toBe('none');
});

it('separates study mode from admission mode and native place from exam origin', () => {
  const profile = { education: [{ studyMode: '全日制', trainingMode: '统招' }], basics: { hometown: '示例市', gaokaoOrigin: '示例省' } };
  expect(plan(field({ label: '学习形式', section: '教育经历' }), 'education.studyMode', profile).value).toBe('全日制');
  expect(plan(field({ label: '培养方式', section: '教育经历' }), 'education.trainingMode', profile).value).toBe('统招');
  expect(plan(field({ label: '是否全日制', section: '教育经历' }), 'education.studyMode', profile).value).toBe('是');
  expect(plan(field({ label: '是否全日制', section: '教育经历' }), 'education.trainingMode', profile).status).toBe('pending');
  expect(plan(field({ label: '培养方式', section: '教育经历' }), 'education.trainingMode', { education: [{ trainingMode: '全日制' }] }).value).toBeNull();
  expect(plan(field({ label: '生源地' }), 'basics.hometown', profile).status).toBe('pending');
  expect(plan(field({ label: '高考生源地' }), 'basics.gaokaoOrigin', profile).value).toBe('示例省');
});

it('fills explicitly confirmed campus and exam facts while preserving date precision', () => {
  expect(plan(field({ label: '担任职务', section: '校园经历' }), 'campus.title', { campus: [{ title: '示例社团干事' }] }).value).toBe('示例社团干事');
  expect(plan(field({ label: '考试分数', section: '语言能力' }), 'languages.score', { languages: [{ score: '520' }] }).value).toBe('520');
  expect(plan(field({ label: '发证日期', section: '资格证书', kind: 'input:date' }), 'certificates.date', { certificates: [{ date: '2024-09' }] }).value).toBeNull();
});

it('does not fill an ID card number into a passport field or an exam name into a score field', () => {
  const profile = { basics: { idType: '居民身份证', idNumber: 'fictional-id' }, languages: [{ cert: 'CET-6', score: '520' }] };
  expect(plan(field({ label: '护照号' }), 'basics.idNumber', profile).value).toBeNull();
  expect(plan(field({ label: '身份证号' }), 'basics.idNumber', profile).value).toBe('fictional-id');
  expect(plan(field({ label: '语言成绩', section: '语言能力' }), 'languages.cert', profile).value).toBeNull();
  expect(plan(field({ label: '语言考试名称', section: '语言能力' }), 'languages.cert', profile).value).toBe('CET-6');
});
