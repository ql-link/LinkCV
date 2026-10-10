// 自动填写只接受明确的事实字段；招聘偏好和模糊字段留给用户。
import { KEYS } from '../profile/keys';
import type { ScannedField } from '../scan/scanner';

const normalized = (text: string) => text.toLowerCase().replace(/[\s*＊:：]/g, '').replace(/^请(?:选择|输入|填写)(?:你的|您(?:的)?)?/, '');
const factualGroup = /^(basics|contact|education|work|internship|projects|awards|certificates|languages|campus|skills|others)\./;
const equivalent = (key: string) => key.replace(/^internship\./, 'work.');

export function manualReason(field: ScannedField): string | null {
  if (/家庭|配偶|家属|family|spouse/i.test(field.section)) return '他人的资料需要你确认，不自动填写';
  if (/志愿|意向部门|调剂|应聘职位|申请职位|选择职位/.test(`${field.label} ${field.placeholder}`)
    || /校招意向|求职意向|应聘意向|岗位选择/.test(field.section)) {
    return '需要你选择应聘意向，不自动填写';
  }
  if (/工作类型|工作性质|雇佣类型/.test(field.label)) return '经历的工作性质需要逐段确认，不自动填写';
  if (field.isMultiple) return '多选项需要你确认，不自动填写';
  return null;
}

/** 高概率也不能替代页面标签和字段语义的一致性。 */
export function hasExplicitMeaning(field: ScannedField, key: string): boolean {
  if (!factualGroup.test(key)) return false;
  const hints = new Set([normalized(field.label), normalized(field.placeholder)].filter(Boolean));
  const section = field.section;
  const group = /教育|学历|education/i.test(section) ? 'education'
    : /工作|实习|employment|internship/i.test(section) ? 'work'
      : /项目|project/i.test(section) ? 'projects'
        : /校园|社团|学生组织|campus/i.test(section) ? 'campus'
          : /证书|certificate/i.test(section) ? 'certificates'
            : /奖项|获奖|荣誉|award/i.test(section) ? 'awards'
              : /语言|外语|language/i.test(section) ? 'languages' : null;
  if (group && equivalent(key).split('.')[0] !== group) return false;
  const matches = Object.entries(KEYS).filter(([candidate, description]) => {
    if (!factualGroup.test(candidate)) return false;
    if (group && equivalent(candidate).split('.')[0] !== group) return false;
    return description.split(/[；;]/).some((alias) => hints.has(normalized(alias)));
  }).map(([candidate]) => equivalent(candidate));
  if (group && (hints.has('开始时间') || hints.has('在开始时间'))) matches.push(`${group}.${group === 'education' ? 'enrollDate' : 'startDate'}`);
  if (group && hints.has('结束时间')) matches.push(`${group}.${group === 'education' ? 'gradDate' : 'endDate'}`);
  if (hints.has('当前居住城市')) matches.push('contact.city');
  if (group === 'education' && hints.has('是否全日制')) matches.push('education.studyMode');
  const distinct = new Set(matches);
  return distinct.size === 1 && distinct.has(equivalent(key));
}
