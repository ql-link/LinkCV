import { Reveal } from '../components/Reveal'
import { Hand, ShieldCheck, Undo2 } from 'lucide-react'
import { useT } from '../locales/LanguageContext'

const icons = [Hand, ShieldCheck, Undo2]

/** 产品理念宣言 */
export function Philosophy() {
  const t = useT()
  return (
    <section id="philosophy" className="relative overflow-hidden border-b hairline">
      <div className="bg-grid absolute inset-0 opacity-60" aria-hidden />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 55% 60% at 50% 50%, transparent 30%, var(--page-bg) 85%)' }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl px-6 py-32 sm:py-44">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <div className="flex items-center justify-center gap-3 font-mono text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500 uppercase">
              <span className="text-zinc-400 dark:text-zinc-500">{t.philosophy.index}</span>
              <span className="h-px w-6 bg-black/15 dark:bg-white/15" aria-hidden />
              <span>{t.philosophy.eyebrow}</span>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <h2 className="text-balance mt-8 font-display text-4xl !leading-[1.32] font-medium tracking-tight text-zinc-900 dark:text-white sm:text-5xl lg:text-6xl">
              {t.philosophy.title1}
              <br />
              {t.philosophy.title2}
            </h2>
          </Reveal>
          <Reveal delay={0.2}>
            <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-zinc-500 dark:text-zinc-400">
              {t.philosophy.description}
            </p>
          </Reveal>
        </div>

        <div className="mx-auto mt-20 grid max-w-4xl gap-4 sm:grid-cols-3 sm:gap-5">
          {t.philosophy.principles.map((p, i) => {
            const Icon = icons[i]
            return (
              <Reveal
                key={p.title}
                delay={0.15 + i * 0.1}
                className="group rounded-2xl border border-black/[0.06] bg-white p-8 text-center shadow-[0_1px_3px_rgb(0_0_0/0.03)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_32px_-8px_rgb(0_0_0/0.08)] sm:text-left dark:border-white/[0.07] dark:bg-[#131315] dark:shadow-none dark:hover:bg-[#17171a]"
              >
                <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-black/[0.04] transition-colors group-hover:bg-black/[0.07] sm:mx-0 dark:bg-white/[0.06] dark:group-hover:bg-white/[0.1]">
                  <Icon className="h-5 w-5 text-zinc-500 transition-colors group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-white" strokeWidth={1.5} />
                </span>
                <h3 className="mt-6 text-[15px] font-medium text-zinc-900 dark:text-white">{p.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-zinc-500">{p.desc}</p>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
