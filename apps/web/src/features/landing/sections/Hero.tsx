import { motion } from 'motion/react'
import { ArrowRight, FileDown, History } from 'lucide-react'
import { ResumePaper } from '../components/mockups/ResumePaper'

const ease = [0.21, 0.47, 0.32, 0.98] as const

export function Hero({ onStart }: { onStart: () => void }) {
  return (
    <section id="top" className="relative overflow-hidden pt-16">
      {/* 背景：细网格 + 顶部辉光 */}
      <div className="bg-grid absolute inset-0" aria-hidden />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 60% 45% at 50% 0%, var(--glow), transparent 70%)' }}
        aria-hidden
      />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, transparent 55%, var(--page-bg) 96%)' }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-16 py-24 sm:py-32 lg:grid-cols-[1.05fr_0.95fr] lg:gap-10">
          {/* 左侧文案 */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease }}
              className="inline-flex items-center gap-2.5 rounded-full border border-black/[0.08] bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.03] px-4 py-1.5"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-900 dark:bg-white" />
              <span className="font-mono text-[11px] tracking-[0.12em] text-zinc-500 dark:text-zinc-400">中文求职工作台</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.1, ease }}
              className="text-balance mt-8 font-display text-[2.6rem] leading-[1.1] font-medium tracking-tight text-zinc-900 dark:text-white sm:text-6xl lg:text-[4.2rem]"
            >
              简历创作，
              <br />
              版本与岗位，
              <br />
              <span className="text-zinc-500">收进一个工作区。</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease }}
              className="mt-7 max-w-md text-[15px] leading-relaxed text-zinc-500 dark:text-zinc-400"
            >
              LinkCV 把简历编辑、版本管理、PDF 导出与岗位资料收集整合在一起。
              不再在 Word、模板网站、浏览器收藏和零散文档之间来回切换。
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3, ease }}
              className="mt-10 flex flex-wrap items-center gap-4"
            >
              <button
                type="button"
                onClick={onStart}
                className="group flex items-center gap-2 rounded-full bg-zinc-900 px-7 py-3.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                开始创建简历
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
              <a
                href="#features"
                className="rounded-full border border-black/15 px-7 py-3.5 text-sm text-zinc-700 transition-colors hover:border-black/40 hover:text-zinc-900 dark:border-white/15 dark:text-zinc-300 dark:hover:border-white/35 dark:hover:text-white"
              >
                了解功能
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.45 }}
              className="mt-14 flex flex-wrap gap-x-7 gap-y-3 font-mono text-[10px] tracking-[0.08em] text-zinc-400 dark:text-zinc-600"
            >
              <span>A4 PAPER EDITING</span>
              <span>VERSION HISTORY</span>
              <span>PDF EXPORT</span>
              <span>JD CENTER</span>
            </motion.div>
          </div>

          {/* 右侧：白纸悬浮于黑场 */}
          <motion.div
            initial={{ opacity: 0, y: 40, rotate: 2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 1, delay: 0.25, ease }}
            className="relative mx-auto w-full max-w-[420px]"
          >
            <div className="animate-float-slow">
              <div className="text-[13px]">
                <ResumePaper />
              </div>
            </div>

            {/* 浮动标签：版本 */}
            <motion.div
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.7, ease }}
              className="glass absolute -top-5 -left-4 flex items-center gap-2.5 rounded-md border border-black/10 px-3.5 py-2.5 sm:-left-16 dark:border-white/12"
            >
              <History className="h-3.5 w-3.5 text-zinc-400" />
              <div>
                <div className="font-mono text-[10px] text-zinc-500">version</div>
                <div className="text-xs font-medium text-zinc-800 dark:text-zinc-100">v12 · 已保存</div>
              </div>
            </motion.div>

            {/* 浮动标签：导出 */}
            <motion.div
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.85, ease }}
              className="glass absolute -right-4 bottom-[5%] flex items-center gap-2.5 rounded-md border border-black/10 px-3.5 py-2.5 sm:-right-12 dark:border-white/12"
            >
              <FileDown className="h-3.5 w-3.5 text-zinc-400" />
              <div>
                <div className="font-mono text-[10px] text-zinc-500">export</div>
                <div className="text-xs font-medium text-zinc-800 dark:text-zinc-100">简历_终稿.pdf</div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
