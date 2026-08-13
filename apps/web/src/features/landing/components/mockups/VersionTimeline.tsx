import { History, RotateCcw, Check } from 'lucide-react'

const versions = [
  { tag: 'v12', note: '投递前终稿 · 调整技能顺序', time: '今天 21:47', current: true },
  { tag: 'v11', note: '补充项目数据指标', time: '今天 18:02' },
  { tag: 'v10', note: '按 JD 关键词重写自我评价', time: '昨天 22:15' },
  { tag: 'v9', note: '切换为左右双栏布局', time: '3 天前' },
]

/** 版本历史面板模拟图 */
export function VersionTimeline() {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-black/[0.07] bg-white shadow-sm dark:border-white/10 dark:bg-[#0e0e11] dark:shadow-none">
      <div className="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <History className="h-3.5 w-3.5" />
          <span>历史版本</span>
        </div>
        <span className="font-mono text-[10px] text-zinc-600">autosave: on</span>
      </div>
      <div className="relative px-4 py-4">
        <div className="absolute top-6 bottom-6 left-[26px] w-px bg-black/[0.07] dark:bg-white/[0.08]" aria-hidden />
        <ul className="space-y-1">
          {versions.map((v) => (
            <li
              key={v.tag}
              className={`group relative flex items-center gap-3 rounded-md px-2 py-2.5 ${
                v.current ? 'bg-black/[0.045] dark:bg-white/[0.06]' : ''
              }`}
            >
              <span
                className={`relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  v.current ? 'border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-black' : 'border-black/15 bg-white text-zinc-400 dark:border-white/20 dark:bg-[#0e0e11] dark:text-zinc-500'
                }`}
              >
                {v.current ? <Check className="h-3 w-3" /> : <span className="h-1 w-1 rounded-full bg-zinc-400 dark:bg-zinc-500" />}
              </span>
              <span className="w-8 shrink-0 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">{v.tag}</span>
              <span className={`flex-1 truncate text-xs ${v.current ? 'text-zinc-800 dark:text-zinc-100' : 'text-zinc-400 dark:text-zinc-500'}`}>{v.note}</span>
              <span className="hidden shrink-0 font-mono text-[10px] text-zinc-600 sm:block">{v.time}</span>
              {!v.current && (
                <span className="flex shrink-0 items-center gap-1 text-[10px] text-zinc-400 transition-colors group-hover:text-zinc-700 dark:text-zinc-600 dark:group-hover:text-zinc-300">
                  <RotateCcw className="h-3 w-3" />
                  恢复
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
