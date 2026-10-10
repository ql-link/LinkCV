import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addMissingRows } from './add-rows';
import type { SiteConfig } from '../writer/types';

// 行数策略测试只替换鼠标/时间边界；计数、模块识别和 DOM 增加均使用真实实现。
vi.mock('../writer/dom.js', async (load) => ({ ...(await load<object>()), realClick: async (el: HTMLElement) => el.click(), sleep: async () => {} }));
const site: SiteConfig = { level1_class: 'h2', group_class: '.entry' };
beforeEach(() => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON() {} }));
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('does not add a duplicate row when a stale selector cannot identify existing entries', async () => {
  document.body.innerHTML = '<h2>教育经历</h2><div class="new-entry"><input></div><button>添加教育经历</button>';
  const clicked = vi.fn(); document.querySelector('button')!.addEventListener('click', clicked);
  expect(await addMissingRows(site, { education: 1 })).toMatchObject([{ had: 0, added: 0, note: '无法确认已有经历块，请手动添加' }]);
  expect(clicked).not.toHaveBeenCalled();
});

it('adds only missing rows after identifying existing entries', async () => {
  document.body.innerHTML = '<h2>实习经历</h2><div class="entry"><input></div><button>添加实习经历</button>';
  document.querySelector('button')!.addEventListener('click', (event) => {
    (event.currentTarget as HTMLElement).insertAdjacentHTML('beforebegin', '<div class="entry"><input></div>');
  });
  expect(await addMissingRows(site, { work: 4, internship: 2 })).toMatchObject([{ had: 1, wanted: 2, added: 1 }]);
  expect(document.querySelectorAll('.entry')).toHaveLength(2);
});

it('leaves a combined work and internship order for the user to confirm', async () => {
  document.body.innerHTML = '<h2>工作/实习经历</h2><div class="entry"><input></div><button>添加经历</button>';
  const clicked = vi.fn(); document.querySelector('button')!.addEventListener('click', clicked);
  expect(await addMissingRows(site, { work: 2, internship: 2 })).toMatchObject([{ added: 0, note: '工作与实习合并后的顺序需要确认，请手动添加' }]);
  expect(clicked).not.toHaveBeenCalled();
});
