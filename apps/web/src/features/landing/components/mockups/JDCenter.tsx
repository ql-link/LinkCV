import { Search, Archive, Bookmark, CheckCircle2 } from 'lucide-react'
import { ChromeIcon } from '../ChromeIcon'

const jobs = [
  { title: '高级产品经理', company: '某科技公司', salary: '30-50K·14薪', tag: '已投递', active: true },
  { title: 'AI 产品负责人', company: '某独角兽', salary: '40-60K', tag: '收藏' },
  { title: '增长产品经理', company: '某互联网公司', salary: '25-40K·16薪', tag: '已归档', muted: true },
  { title: '平台产品经理', company: '某大厂', salary: '35-55K', tag: '收藏' },
]

/** JD 中心面板模拟图 */
export function JDCenter() {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-black/[0.07] bg-white shadow-sm dark:border-white/10 dark:bg-[#0e0e11] dark:shadow-none">
      <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3 dark:border-white/[0.07]">
        <span className="text-xs text-zinc-500 dark:text-zinc-400">JD 中心</span>
        <div className="flex items-center gap-2 rounded border border-black/10 bg-black/[0.03] px-2.5 py-1 text-[11px] text-zinc-400 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-500">
          <Search className="h-3 w-3" />
          搜索岗位、公司、关键词…
        </div>
      </div>
      <ul className="divide-y divide-black/[0.05] dark:divide-white/[0.05]">
        {jobs.map((j) => (
          <li
            key={j.title}
            className={`flex items-center gap-3 px-4 py-3 ${j.active ? 'bg-black/[0.03] dark:bg-white/[0.05]' : ''} ${j.muted ? 'opacity-45' : ''}`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{j.title}</span>
                <span className="truncate text-[11px] text-zinc-400 dark:text-zinc-500">{j.company}</span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-zinc-400 dark:text-zinc-600">BOSS直聘 · 导入于 08-02</div>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-zinc-600 dark:text-zinc-300">{j.salary}</span>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
                j.tag === '已投递'
                  ? 'border-zinc-900/30 text-zinc-800 dark:border-white/30 dark:text-zinc-100'
                  : j.tag === '已归档'
                    ? 'border-black/10 text-zinc-400 dark:border-white/10 dark:text-zinc-600'
                    : 'border-black/15 text-zinc-500 dark:border-white/15 dark:text-zinc-400'
              }`}
            >
              {j.tag === '已投递' ? <CheckCircle2 className="h-3 w-3" /> : j.tag === '已归档' ? <Archive className="h-3 w-3" /> : <Bookmark className="h-3 w-3" />}
              {j.tag}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Chrome 插件采集弹窗模拟图 */
export function ExtensionPopup() {
  return (
    <div className="w-full max-w-[300px] overflow-hidden rounded-lg border border-black/[0.08] bg-white shadow-2xl shadow-black/15 dark:border-white/10 dark:bg-[#101013] dark:shadow-black/60">
      <div className="flex items-center gap-2 border-b border-black/[0.06] px-3.5 py-2.5 dark:border-white/[0.07]">
        <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-zinc-900 text-[10px] font-bold text-white dark:bg-white dark:text-black">L</span>
        <span className="text-[11px] font-medium text-zinc-800 dark:text-zinc-200">LinkCV 采集助手</span>
        <ChromeIcon className="ml-auto h-3.5 w-3.5 text-zinc-400 dark:text-zinc-600" />
      </div>
      <div className="px-3.5 py-3">
        <div className="font-mono text-[9px] tracking-wider text-zinc-400 uppercase dark:text-zinc-600">当前页面 · BOSS直聘</div>
        <div className="mt-2 rounded border border-black/[0.08] bg-black/[0.02] p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="text-[12px] font-medium text-zinc-800 dark:text-zinc-100">高级产品经理</div>
          <div className="mt-1 text-[10px] leading-relaxed text-zinc-500">某科技公司 · 上海 · 30-50K·14薪</div>
          <div className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-zinc-400 dark:text-zinc-600">
            负责求职工具产品规划与迭代，推动简历编辑、导出等核心链路优化…
          </div>
        </div>
        <button className="mt-3 w-full rounded-full bg-zinc-900 py-1.5 text-[11px] font-medium text-white dark:bg-white dark:text-black">确认导入 LinkCV</button>
        <div className="mt-2 text-center text-[9px] text-zinc-400 dark:text-zinc-600">仅读取当前打开的岗位页 · 需手动确认</div>
      </div>
    </div>
  )
}
