import { Reveal } from '../components/Reveal'
import { ArrowDown } from 'lucide-react'

import { ConnectionMap } from '../components/mockups/ConnectionMap'

const keywords = [
  'A4 纸面编辑',
  '版本管理',
  'PDF 导出',
  '智能一页',
  'JD 中心',
  'Chrome 插件',
  '模板导入',
  '自动保存',
]

/** 关键词跑马灯 */
export function Marquee() {
  const row = [...keywords, ...keywords]
  return (
    <div className="relative overflow-hidden border-y hairline py-5">
      <div className="animate-marquee flex w-max items-center">
        {row.map((k, i) => (
          <div key={i} className="flex items-center">
            <span className="px-8 font-mono text-[11px] tracking-[0.16em] text-zinc-400 dark:text-zinc-500 uppercase">{k}</span>
            <span className="h-1 w-1 rounded-full bg-zinc-400 dark:bg-zinc-700" aria-hidden />
          </div>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#fafaf9] to-transparent dark:from-[#0e0e10]" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#fafaf9] to-transparent dark:from-[#0e0e10]" />
    </div>
  )
}

/** 痛点：散落的求职现场 → 一个工作台 */
export function Chaos() {
  return (
    <section className="relative border-b hairline">
      <div className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <div className="grid gap-16 lg:grid-cols-2 lg:gap-12">
          <div>
            <Reveal>
              <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500 uppercase">
                <span className="text-zinc-400 dark:text-zinc-500">00</span>
                <span className="h-px w-6 bg-black/15 dark:bg-white/15" aria-hidden />
                <span>现状</span>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="text-balance mt-6 font-display text-3xl font-medium leading-[1.18] tracking-tight text-zinc-900 dark:text-white sm:text-4xl lg:text-[2.75rem]">
                求职资料，
                <br />
                不该散落在
                <span className="text-zinc-500">七个地方。</span>
              </h2>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-5 max-w-md text-base leading-relaxed text-zinc-500 dark:text-zinc-400">
                简历躺在 Word、PDF、模板网站和多个副本里，岗位信息分散在招聘平台、收藏夹和聊天记录中。
                每次修改、排版、回看 JD，都要在工具之间反复切换。
              </p>
            </Reveal>
            <Reveal delay={0.24}>
              <div className="mt-10 flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-black/15 dark:border-white/15">
                  <ArrowDown className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                </span>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  LinkCV 的答案：<span className="text-zinc-900 dark:text-white">内容优先、排版可控</span>的一个工作区。
                </p>
              </div>
            </Reveal>
          </div>

          {/* 散落工具 → LinkCV 连接图 */}
          <div className="relative flex items-center">
            <ConnectionMap />
          </div>
        </div>
      </div>
    </section>
  )
}
