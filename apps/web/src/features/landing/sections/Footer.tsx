import { Reveal } from '../components/Reveal'
import { ArrowRight } from 'lucide-react'

/** 结尾 CTA + 页脚 */
export function Footer({ onStart }: { onStart: () => void }) {
  return (
    <footer id="cta" className="relative overflow-hidden">
      {/* CTA */}
      <div className="relative border-b hairline">
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse 60% 70% at 50% 100%, var(--glow), transparent 70%)' }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-6 py-32 text-center sm:py-40">
          <Reveal>
            <div className="font-mono text-[11px] tracking-[0.16em] text-zinc-400 dark:text-zinc-500 uppercase">Start now</div>
          </Reveal>
          <Reveal delay={0.1}>
            <h2 className="text-balance mx-auto mt-6 max-w-3xl font-display text-4xl leading-[1.15] font-medium tracking-tight text-zinc-900 dark:text-white sm:text-6xl">
              下一份简历，
              <br />
              在一个工作区里完成。
            </h2>
          </Reveal>
          <Reveal delay={0.2}>
            <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
              <button
                type="button"
                onClick={onStart}
                className="group flex items-center gap-2 rounded-full bg-zinc-900 px-8 py-3.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                开始使用 LinkCV
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </Reveal>
          <Reveal delay={0.3}>
            <p className="mt-8 font-mono text-[10px] tracking-[0.08em] text-zinc-400 dark:text-zinc-600">
              RESUME · VERSION · PDF · JD — ONE WORKSPACE
            </p>
          </Reveal>
        </div>
      </div>

      {/* 页脚 */}
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col items-center justify-between gap-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-zinc-900 font-display text-xs font-bold text-white dark:bg-white dark:text-black">
              L
            </span>
            <span className="font-display text-sm font-semibold text-zinc-900 dark:text-white">LinkCV</span>
          </div>
          <div className="flex items-center gap-8 text-[13px] text-zinc-500">
            <a href="#features" className="transition-colors hover:text-zinc-900 dark:hover:text-white">功能</a>
            <a href="#jd" className="transition-colors hover:text-zinc-900 dark:hover:text-white">JD 中心</a>
            <a href="#philosophy" className="transition-colors hover:text-zinc-900 dark:hover:text-white">理念</a>
            <a href="#faq" className="transition-colors hover:text-zinc-900 dark:hover:text-white">FAQ</a>
          </div>
          <div className="font-mono text-[11px] text-zinc-600">© 2026 LinkCV</div>
        </div>
      </div>

      {/* 底部巨型字 */}
      <div className="pointer-events-none select-none overflow-hidden" aria-hidden>
        <div className="translate-y-[28%] text-center font-display text-[22vw] leading-none font-bold tracking-tight text-black/[0.045] dark:text-white/[0.035]">
          LinkCV
        </div>
      </div>
    </footer>
  )
}
