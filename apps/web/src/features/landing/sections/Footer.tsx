import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useInView } from "motion/react";
import { lazy, Suspense, useRef } from "react";
import { Reveal } from "../components/Reveal";
import { useT } from "../locales/LanguageContext";

const FlutedGlass = lazy(() =>
  import("@paper-design/shaders-react").then((module) => ({ default: module.FlutedGlass })),
);

/** 结尾 CTA + 页脚 */
export function Footer({ onStart }: { onStart: () => void }) {
  const t = useT();
  const shaderRef = useRef<HTMLDivElement>(null);
  const showShader = useInView(shaderRef, { margin: "480px", once: true });

  return (
    <footer id="cta" className="relative overflow-hidden bg-stone-50 antialiased dark:bg-zinc-950">
      <div
        className="relative z-0 flex w-full items-end justify-center px-4 pt-16 sm:pt-20 md:pt-24"
        aria-hidden
      >
        <div className="-mb-[0.34em] select-none whitespace-nowrap font-display text-[28vw] leading-[0.72] font-semibold tracking-[-0.075em] text-transparent opacity-45 [-webkit-text-stroke:1px_rgba(24,24,27,0.42)] sm:text-[23vw] md:-mb-[0.36em] md:text-[18vw] dark:opacity-35 dark:[-webkit-text-stroke:1px_rgba(255,255,255,0.5)]">
          LinkCV
        </div>
      </div>

      <div className="relative z-10 overflow-hidden bg-[#155fd7] text-white lg:h-[50svh] lg:min-h-[360px]">
        <div ref={shaderRef} className="pointer-events-none absolute inset-0 opacity-80" aria-hidden>
          {showShader ? (
            <Suspense fallback={null}>
              <FlutedGlass
                size={0.89}
                shape="lines"
                angle={0}
                distortionShape="prism"
                distortion={0.5}
                shift={0}
                blur={0}
                edges={0.25}
                stretch={0}
                scale={1.11}
                fit="cover"
                highlights={0.1}
                shadows={0.2}
                grainMixer={0.1}
                grainOverlay={0.1}
                colorBack="#00000000"
                colorHighlight="#ffffff"
                colorShadow="#000000"
                className="h-full w-full bg-transparent"
              />
            </Suspense>
          ) : null}
        </div>

        <div className="relative z-10 mx-auto grid max-w-7xl gap-14 px-6 py-14 sm:px-8 md:px-12 lg:h-full lg:grid-cols-[minmax(0,1.3fr)_minmax(420px,1fr)] lg:items-center lg:gap-16 lg:px-16 lg:py-8">
          <div className="max-w-2xl">
            <Reveal>
              <div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white font-display text-sm font-bold text-[#155fd7] shadow-sm">
                    L
                  </span>
                  <span className="font-display text-base font-semibold tracking-tight">LinkCV</span>
                  <span className="hidden h-4 w-px bg-white/30 sm:block" aria-hidden />
                  <p className="font-mono text-[10px] tracking-[0.16em] text-white/85 uppercase">
                    {t.footer.tagline}
                  </p>
                </div>
                <h2 className="mt-5 max-w-xl text-balance font-display text-4xl !leading-[1.3] font-medium tracking-[-0.045em] sm:text-[2.75rem] lg:text-[2.8rem]">
                  {t.footer.title1}
                  <br />
                  {t.footer.title2}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-white/85">
                  {t.footer.description}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                  <button
                    type="button"
                    onClick={onStart}
                    className="group inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#1257bd] shadow-sm transition-[transform,background-color] hover:-translate-y-0.5 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white active:translate-y-0"
                  >
                    {t.footer.cta}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </button>
                  <p className="font-mono text-[10px] tracking-[0.04em] text-white/75">
                    {t.footer.copyright}
                  </p>
                </div>
              </div>
            </Reveal>
          </div>

          <nav
            aria-label={t.footer.navLabel}
            className="grid grid-cols-2 gap-x-10 gap-y-10 sm:grid-cols-3 lg:self-center"
          >
            {t.footer.linkGroups.map((group) => (
              <div key={group.title}>
                <h3 className="font-display text-sm font-semibold tracking-wide text-white">
                  {group.title}
                </h3>
                <ul className="mt-4 space-y-3">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        className="group inline-flex items-center gap-1.5 text-sm font-medium text-white/85 transition-colors hover:text-white focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
                      >
                        {link.label}
                        <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-[opacity,transform] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
