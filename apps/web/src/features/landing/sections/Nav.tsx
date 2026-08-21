import { useEffect, useState, type RefObject } from 'react'
import { ArrowUpRight, Moon, Sun } from 'lucide-react'
import { useLanguage, useT } from '../locales/LanguageContext'
import { motion, AnimatePresence } from 'motion/react'

export function Nav({
  theme,
  onToggleTheme,
  onLogin,
  scrollContainerRef,
}: {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogin: () => void
  scrollContainerRef: RefObject<HTMLDivElement | null>
}) {
  const [scrolled, setScrolled] = useState(false)
  const { lang, toggle } = useLanguage()
  const t = useT()

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const onScroll = () => setScrolled(scrollContainer.scrollTop > 24)
    onScroll()
    scrollContainer.addEventListener('scroll', onScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', onScroll)
  }, [scrollContainerRef])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-all duration-300 ${
        scrolled ? 'glass hairline' : 'border-transparent'
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a
          href="#top"
          className="flex items-center gap-2.5"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 font-display text-sm font-bold text-white dark:bg-white dark:text-black">
            L
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-white">
            LinkCV
            <span className="ml-2 hidden font-mono text-[10px] font-normal tracking-[0.12em] text-zinc-400 dark:text-zinc-500 sm:inline">
              {t.nav.brandSub}
            </span>
          </span>
        </a>

        <div className="flex items-center gap-3">
          <PillButton
            onClick={toggle}
            aria-label={lang === 'zh' ? 'Switch to English' : '切换到中文'}
            contentKey={lang}
          >
            <span className="font-mono text-[11px] font-medium tracking-wide">
              {lang === 'zh' ? 'EN' : '中'}
            </span>
          </PillButton>
          <PillButton
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? t.nav.themeToLight : t.nav.themeToDark}
            contentKey={theme}
          >
            {theme === 'dark'
              ? <Sun className="h-3.5 w-3.5" strokeWidth={1.5} />
              : <Moon className="h-3.5 w-3.5" strokeWidth={1.5} />}
          </PillButton>
          <button
            type="button"
            onClick={onLogin}
            className="group flex items-center gap-1.5 rounded-full bg-zinc-900 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {t.nav.login}
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
        </div>
      </nav>
    </header>
  )
}

function PillButton({
  onClick,
  'aria-label': ariaLabel,
  contentKey,
  children,
}: {
  onClick: () => void
  'aria-label': string
  contentKey: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-black/10 transition-colors hover:border-black/30 dark:border-white/12 dark:hover:border-white/35"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={contentKey}
          className="flex items-center justify-center text-zinc-600 dark:text-zinc-400"
          initial={{ opacity: 0, y: 8, scale: 0.6 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.6 }}
          transition={{ duration: 0.25, ease: [0.21, 0.47, 0.32, 0.98] }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
