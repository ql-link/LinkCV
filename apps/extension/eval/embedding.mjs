import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';
import { KEYS } from '../src/autofill/profile/keys.ts';

const HERE = path.dirname(new URL(import.meta.url).pathname);

env.cacheDir = path.join(HERE, 'models');
const MODEL = process.env.MODEL || 'Xenova/bge-small-zh-v1.5';
const QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：';
const POOL = process.env.POOL || 'cls';
const FIELD_PREFIX = process.env.FIELD_PREFIX || '';
const KEY_PREFIX = process.env.KEY_PREFIX || '';

const fields = JSON.parse(fs.readFileSync(path.join(HERE, 'results/fields.json'), 'utf8'));
const SKIP_KINDS = /^input:(file|submit|button|checkbox|radio|password)$/;
const usable = fields.filter((f) => !f.disabled && !SKIP_KINDS.test(f.kind));
const scored = usable.filter((f) => f.expected);
const noSlot = usable.filter((f) => !f.expected);

const keyNames = Object.keys(KEYS);
const t0 = performance.now();
const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
const loadMs = performance.now() - t0;

async function embed(texts) {
  const out = await extractor(texts, { pooling: POOL, normalize: true });
  return out.tolist();
}
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

const keyVecs = await embed(keyNames.map((k) => KEY_PREFIX + KEYS[k]));

const START = new Set(['education.enrollDate', 'work.startDate', 'internship.startDate', 'projects.startDate']);
const END = new Set(['education.gradDate', 'work.endDate', 'internship.endDate', 'projects.endDate']);
const START_RE = /开始|起始|入学|入职|^自$|\b(start|from)\b/i;
const END_RE = /结束|毕业|离职|^至|截止|\b(end|completion)\b|^to$/i;

const textA = (f) => f.label || f.placeholder;
const textB = (f) =>
  [f.section, f.label, f.placeholder && f.placeholder !== f.label ? f.placeholder : '', f.options.length ? `选项：${f.options.slice(0, 4).join('/')}` : '']
    .filter(Boolean)
    .join(' | ');

async function rank(list, toText, { prefix = '', rule = false } = {}) {
  const texts = list.map((f) => FIELD_PREFIX + prefix + toText(f));
  const s = performance.now();
  const vecs = await embed(texts);
  const ms = (performance.now() - s) / list.length;
  const results = list.map((f, i) => {
    let scores = keyNames.map((k, j) => ({ key: k, score: dot(vecs[i], keyVecs[j]) }));
    if (rule) {
      const l = f.label || '';
      if (START_RE.test(l) && !END_RE.test(l)) scores = scores.filter((x) => !END.has(x.key));
      else if (END_RE.test(l) && !START_RE.test(l)) scores = scores.filter((x) => !START.has(x.key));
    }
    scores.sort((a, b) => b.score - a.score);
    return { f, text: texts[i], top: scores.slice(0, 3) };
  });
  return { results, ms };
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
function summarize(name, { results, ms }) {
  const by = (lang) => results.filter((r) => !lang || r.f.lang === lang);
  const line = (lang) => {
    const rs = by(lang);
    const top1 = rs.filter((r) => r.f.expected.includes(r.top[0].key)).length;
    const top3 = rs.filter((r) => r.top.some((t) => r.f.expected.includes(t.key))).length;
    return `${lang || 'all'} n=${rs.length} top1=${pct(top1, rs.length)} top3=${pct(top3, rs.length)}`;
  };
  console.log(`\n### ${name}  (${ms.toFixed(1)} ms/字段)`);
  for (const l of ['cn', 'en', null]) console.log('  ' + line(l));
}

const A = await rank(scored, textA);
const B = await rank(scored, textB);
const C = await rank(scored, textB, { prefix: QUERY_PREFIX });
const D = await rank(scored, textB, { rule: true });
console.log(`模型 ${MODEL} 加载 ${(loadMs / 1000).toFixed(1)}s；key 数 ${keyNames.length}；有答案字段 ${scored.length}；无对应槽位字段 ${noSlot.length}；规则过滤 ${fields.length - usable.length}`);
summarize('A 只用标签', A);
summarize('B 标题+标签+placeholder+选项', B);
summarize('C = B + 检索前缀', C);
summarize('D = B + 开始/结束规则', D);

// 以 D 为准：看分数能否区分对错，以及按阈值自动填写时的覆盖率与正确率
const best = D.results;
const cnOnly = best.filter((r) => r.f.lang === 'cn');
const ok = (r) => r.f.expected.includes(r.top[0].key);
const stat = (arr) => (arr.length ? `min ${Math.min(...arr).toFixed(3)} / 中位 ${arr.sort((a, b) => a - b)[Math.floor(arr.length / 2)].toFixed(3)} / max ${Math.max(...arr).toFixed(3)}` : '-');
console.log('\n### D 的分数分布（中文）');
console.log('  正确：' + stat(cnOnly.filter(ok).map((r) => r.top[0].score)));
console.log('  错误：' + stat(cnOnly.filter((r) => !ok(r)).map((r) => r.top[0].score)));
const noSlotRanked = await rank(noSlot, textB, { rule: true });
console.log('  无对应槽位：' + stat(noSlotRanked.results.map((r) => r.top[0].score)));

console.log('\n### 按“top1 分数 ≥ 阈值 且 与第二名差距 ≥ 0.02”自动填写（中文有答案字段）');
for (const t of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75]) {
  const auto = cnOnly.filter((r) => r.top[0].score >= t && r.top[0].score - r.top[1].score >= 0.02);
  const wrongNoSlot = noSlotRanked.results.filter((r) => r.f.lang === 'cn' && r.top[0].score >= t && r.top[0].score - r.top[1].score >= 0.02).length;
  console.log(`  阈值 ${t}: 自动填 ${pct(auto.length, cnOnly.length)}，其中正确 ${pct(auto.filter(ok).length, auto.length)}；无槽位字段被误填 ${wrongNoSlot}`);
}

console.log('\n### D 的错误明细');
for (const r of best.filter((r) => !ok(r))) {
  console.log(`  [${r.f.form}/${r.f.id}] ${r.text}\n     → ${r.top.map((t) => `${t.key}(${t.score.toFixed(3)})`).join('  ')}   应为 ${r.f.expected.join('|')}`);
}
fs.writeFileSync(path.join(HERE, `results/embedding-${MODEL.split('/')[1]}.json`), JSON.stringify(best.map((r) => ({ id: `${r.f.form}/${r.f.id}`, text: r.text, top: r.top, expected: r.f.expected })), null, 1));
