import { Reveal } from '../components/Reveal'
import { ArrowDown } from 'lucide-react'
import { useT } from '../locales/LanguageContext'

import { ConnectionMap } from '../components/mockups/ConnectionMap'

/** 关键词跑马灯 */
export function Marquee() {
  const t = useT()
  const keywords = t.marquee.keywords
  const row = [...keywords, ...keywords]
  return (
    <section id="workspace-intro" className="landing-section-bridge">
      <div className="landing-section-bridge-copy">
        <span>{t.marquee.eyebrow}</span>
        <h2>{t.marquee.title}</h2>
        <p>{t.marquee.subtitle}</p>
      </div>
      <div className="landing-bridge-marquee">
        <div className="animate-marquee flex w-max items-center">
          {row.map((k, i) => (
            <div key={i} className="flex items-center">
              <span className="px-8 font-mono text-[11px] tracking-[0.16em] uppercase">{k}</span>
              <span className="h-1 w-1 rounded-full" aria-hidden />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/** 痛点：散落的求职现场 → 一个工作台 */
export function Chaos() {
  const t = useT()
  return (
    <section id="chaos" className="relative border-b hairline">
      <div className="mx-auto max-w-6xl px-6 py-28 sm:py-36">
        <div className="grid gap-16 lg:grid-cols-2 lg:gap-12">
          <div>
            <Reveal>
              <div className="flex items-center gap-3 font-mono text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500 uppercase">
                <span className="text-zinc-400 dark:text-zinc-500">00</span>
                <span className="h-px w-6 bg-black/15 dark:bg-white/15" aria-hidden />
                <span>{t.chaos.eyebrow}</span>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="text-balance mt-6 font-display text-3xl font-medium !leading-[1.32] tracking-tight text-zinc-900 dark:text-white sm:text-4xl lg:text-[2.75rem]">
                {t.chaos.title1}
                <br />
                {t.chaos.title2}
                <span className="text-zinc-500">{t.chaos.titleAccent}</span>
              </h2>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="mt-5 max-w-md text-base leading-relaxed text-zinc-500 dark:text-zinc-400">
                {t.chaos.description}
              </p>
            </Reveal>
            <Reveal delay={0.24}>
              <div className="mt-10 flex items-center gap-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-black/15 dark:border-white/15">
                  <ArrowDown className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
                </span>
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  {t.chaos.answer}<span className="text-zinc-900 dark:text-white">{t.chaos.answerAccent}</span>{t.chaos.answerSuffix}
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
