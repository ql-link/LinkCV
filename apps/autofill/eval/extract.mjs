// 从仿真网申页抽取每个字段在真实插件里能拿到的上下文，并附上标准答案。
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATA = path.join(HERE, '.data');
const clean = (s) => (s || '').replace(/\s+/g, ' ').replace(/[*＊:：]/g, '').trim();
const collapse = (p) => p.replace(/\.\d+\./, '.');

const HEADING = 'h1,h2,h3,h4,h5,legend,caption,[class*="title" i],[class*="section" i]:not(section),[class*="header" i],[role="heading"]';

function ownText(el) {
  return clean(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(''));
}

function labelOf(el, doc) {
  if (el.id) {
    const l = doc.querySelector(`label[for="${el.id}"]`);
    if (l) return clean(l.textContent);
  }
  const wrap = el.closest('label');
  if (wrap) {
    const t = ownText(wrap) || clean(wrap.textContent);
    if (t) return t;
  }
  const aria = el.getAttribute('aria-label');
  if (aria) return clean(aria);
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => doc.getElementById(id)?.textContent).join(' ');
    if (clean(t)) return clean(t);
  }
  // 向上找最近一个“带 label 字样类名或 label/th/dt 标签”的元素，且它不包含当前控件
  let node = el;
  for (let i = 0; i < 5 && node; i++) {
    node = node.parentElement;
    if (!node) break;
    const cand = Array.from(node.querySelectorAll('label,th,dt,[class*="label" i],[class*="name" i]')).find(
      (c) => !c.contains(el) && clean(c.textContent) && !c.querySelector('input,select,textarea'),
    );
    if (cand) return clean(cand.textContent);
    const prev = node.previousElementSibling;
    if (prev && !prev.querySelector('input,select,textarea') && clean(prev.textContent) && clean(prev.textContent).length <= 30) return clean(prev.textContent);
  }
  return '';
}

function sectionOf(el, doc) {
  let best = '';
  for (const h of doc.querySelectorAll(HEADING)) {
    if (h.contains(el) || h.querySelector('input,select,textarea')) continue;
    if (h.compareDocumentPosition(el) & 4) {
      const t = clean(h.textContent);
      if (t && t.length <= 40) best = t;
    }
  }
  return best;
}

function kindOf(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'select') return 'select';
  if (tag === 'textarea') return 'textarea';
  if (el.getAttribute('role') === 'combobox' || el.closest('[role="combobox"]')) return 'combobox';
  return `input:${(el.getAttribute('type') || 'text').toLowerCase()}`;
}

const out = [];
for (const file of fs.readdirSync(path.join(DATA, 'tools/expected'))) {
  const name = file.replace(/\.json$/, '');
  const exp = JSON.parse(fs.readFileSync(path.join(DATA, 'tools/expected', file), 'utf8'));
  const html = fs.readFileSync(path.join(DATA, 'test-forms', `${name}.html`), 'utf8');
  const doc = new JSDOM(html).window.document;
  const lang = /-en$/.test(name) ? 'en' : 'cn';
  for (const el of doc.querySelectorAll('[data-nw-test]')) {
    const id = el.getAttribute('data-nw-test');
    const raw = exp.expect[id];
    const options = el.tagName === 'SELECT' ? Array.from(el.options).map((o) => clean(o.textContent)).filter((t) => t && !/^请选择|^--|^select/i.test(t)).slice(0, 6) : [];
    out.push({
      form: name,
      lang,
      id,
      section: sectionOf(el, doc),
      label: labelOf(el, doc),
      placeholder: clean(el.getAttribute('placeholder')),
      kind: kindOf(el),
      options,
      disabled: el.hasAttribute('disabled') || el.hasAttribute('readonly'),
      expected: raw == null ? null : [...new Set((Array.isArray(raw) ? raw : [raw]).map(collapse))],
      mustNotTouch: (exp.mustNotTouch || []).includes(id),
    });
  }
}
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.writeFileSync(path.join(HERE, 'results/fields.json'), JSON.stringify(out, null, 1));
console.log(out.length, 'fields');
