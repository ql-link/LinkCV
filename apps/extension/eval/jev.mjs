// 在同一批字段上测 Jev：J1 从全部 key 中选；J2 只在 bge-small-zh 的前 5 名候选中选。两者都带“无对应项”。
import { pipeline, env } from '@huggingface/transformers';
import fs from 'node:fs';
import path from 'node:path';
import { KEYS } from '../src/autofill/profile/keys.ts';

const HERE = path.dirname(new URL(import.meta.url).pathname);

env.cacheDir = path.join(HERE, 'models');
const API = process.env.JEV_ENDPOINT || 'https://aihubmix.com/v1/systemone';
const KEY = process.env.AHM_KEY;
const MODEL = process.env.JEV_MODEL || 'jev-1.13';
if (!KEY) throw new Error('请设置环境变量 AHM_KEY');
const NONE = 'none';
const NONE_DESC = '不对应简历中的任何一项（如验证码、声明勾选、与求职者无关或简历没有记录的信息）';

const fields = JSON.parse(fs.readFileSync(path.join(HERE, 'results/fields.json'), 'utf8'));
const SKIP_KINDS = /^input:(file|submit|button|checkbox|radio|password)$/;
const usable = fields.filter((f) => !f.disabled && !SKIP_KINDS.test(f.kind));
const keyNames = Object.keys(KEYS);

// 向量模型候选
const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', { dtype: 'q8' });
const embed = async (t) => (await extractor(t, { pooling: 'cls', normalize: true })).tolist();
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const keyVecs = await embed(keyNames.map((k) => KEYS[k]));
const fieldText = (f) =>
  [f.section, f.label, f.placeholder && f.placeholder !== f.label ? f.placeholder : '', f.options.length ? `选项：${f.options.slice(0, 4).join('/')}` : '']
    .filter(Boolean)
    .join(' | ');
const fieldVecs = await embed(usable.map(fieldText));
const top5 = fieldVecs.map((v) =>
  keyNames
    .map((k, j) => ({ key: k, score: dot(v, keyVecs[j]) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5),
);

function stateOf(f) {
  const s = { 页面模块标题: f.section || '（无）', 字段标签: f.label || '（无）' };
  if (f.placeholder) s.输入提示 = f.placeholder;
  s.控件类型 = f.kind;
  if (f.options.length) s.下拉选项 = f.options.slice(0, 6);
  return s;
}

async function ask(f, candidates) {
  const criteria = {};
  for (const k of candidates) criteria[k] = KEYS[k];
  criteria[NONE] = NONE_DESC;
  const body = {
    model: MODEL,
    state: stateOf(f),
    questions: {
      slot: {
        type: 'choice',
        instructions: '这是网申表单中的一个输入框。求职者应在这里填写其简历中的哪一项信息？',
        criteria,
      },
    },
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = performance.now();
    try {
      const res = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      const ms = performance.now() - t;
      const a = json?.answers?.slot;
      if (!a) throw new Error(JSON.stringify(json).slice(0, 200));
      const ranked = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]);
      return { choice: a.choice, confidence: a.confidence, prob: ranked[0][1], top3: ranked.slice(0, 3).map(([k]) => k), ms, tokens: json.usage?.input_tokens || 0 };
    } catch (e) {
      if (attempt === 2) return { error: String(e).slice(0, 200) };
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function runAll(mode) {
  const out = new Array(usable.length);
  let next = 0;
  const worker = async () => {
    while (next < usable.length) {
      const i = next++;
      const cands = mode === 'J1' ? keyNames : top5[i].map((x) => x.key);
      out[i] = { f: usable[i], ...(await ask(usable[i], cands)), cands };
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-');
function report(name, rs) {
  const errs = rs.filter((r) => r.error);
  const ok = rs.filter((r) => !r.error);
  const scored = ok.filter((r) => r.f.expected);
  const noSlot = ok.filter((r) => !r.f.expected);
  const right = (r) => r.f.expected.includes(r.choice);
  const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`\n### ${name}  请求 ${rs.length}，失败 ${errs.length}；延迟 中位 ${ms[Math.floor(ms.length / 2)].toFixed(0)}ms / P90 ${ms[Math.floor(ms.length * 0.9)].toFixed(0)}ms；平均输入 ${(ok.reduce((s, r) => s + r.tokens, 0) / ok.length).toFixed(0)} tokens`);
  for (const lang of ['cn', 'en']) {
    const s = scored.filter((r) => r.f.lang === lang);
    const top3 = s.filter((r) => r.top3.some((k) => r.f.expected.includes(k))).length;
    const none = s.filter((r) => r.choice === NONE).length;
    console.log(`  ${lang} 有答案 n=${s.length} 第一名正确 ${pct(s.filter(right).length, s.length)} 前三命中 ${pct(top3, s.length)}（其中判为“无对应” ${none}）`);
    const ns = noSlot.filter((r) => r.f.lang === lang);
    console.log(`  ${lang} 无对应项 n=${ns.length} 判为“无对应” ${pct(ns.filter((r) => r.choice === NONE).length, ns.length)}`);
  }
  const cn = scored.filter((r) => r.f.lang === 'cn');
  const cnNo = noSlot.filter((r) => r.f.lang === 'cn');
  console.log('  中文按 Jev 概率阈值自动填写：');
  for (const t of [0.5, 0.7, 0.8, 0.9, 0.95]) {
    const auto = cn.filter((r) => r.choice !== NONE && r.prob >= t);
    const mis = cnNo.filter((r) => r.choice !== NONE && r.prob >= t).length;
    console.log(`    概率 ≥ ${t}: 自动填 ${pct(auto.length, cn.length)}，其中正确 ${pct(auto.filter(right).length, auto.length)}；无对应字段被误填 ${mis}/${cnNo.length}`);
  }
  if (errs.length) console.log('  失败示例：', errs[0].error);
  return rs;
}

const j1 = report('J1 Jev 从全部 103 个 key 中选', await runAll('J1'));
const j2 = report('J2 bge-small-zh 前 5 名 + Jev 选', await runAll('J2'));
const cand5 = usable.filter((f, i) => f.expected && top5[i].some((x) => f.expected.includes(x.key)));
console.log(`\n（参考：bge-small-zh 前 5 名包含正确答案的比例 中文 ${pct(cand5.filter((f) => f.lang === 'cn').length, usable.filter((f) => f.expected && f.lang === 'cn').length)}，英文 ${pct(cand5.filter((f) => f.lang === 'en').length, usable.filter((f) => f.expected && f.lang === 'en').length)}）`);

for (const [name, rs] of [['J1', j1], ['J2', j2]]) {
  console.log(`\n### ${name} 中文错误明细`);
  for (const r of rs.filter((r) => !r.error && r.f.lang === 'cn' && (r.f.expected ? !r.f.expected.includes(r.choice) : r.choice !== NONE))) {
    console.log(`  [${r.f.form}/${r.f.id}] ${fieldText(r.f)} → ${r.choice}(${r.prob.toFixed(2)})  应为 ${r.f.expected ? r.f.expected.join('|') : '无对应'}`);
  }
}
fs.writeFileSync(path.join(HERE, 'results/jev.json'), JSON.stringify({ j1: j1.map(({ f, ...r }) => ({ id: `${f.form}/${f.id}`, ...r })), j2: j2.map(({ f, ...r }) => ({ id: `${f.form}/${f.id}`, ...r })) }, null, 1));
