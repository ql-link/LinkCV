import { useEffect, useState, type RefObject } from 'react'
import { ArrowUpRight, Moon, Sun } from 'lucide-react'

const links = [
  { href: '#features', label: '功能' },
  { href: '#editor', label: '编辑器' },
  { href: '#jd', label: 'JD 中心' },
  { href: '#philosophy', label: '理念' },
  { href: '#faq', label: 'FAQ' },
]

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
        <a href="#top" className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 font-display text-sm font-bold text-white dark:bg-white dark:text-black">
            L
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-white">
            LinkCV
            <span className="ml-2 hidden font-mono text-[10px] font-normal tracking-[0.12em] text-zinc-400 dark:text-zinc-500 sm:inline">
              求职工作台
            </span>
          </span>
        </a>

        <div className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[13px] text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-zinc-600 transition-colors hover:border-black/30 hover:text-zinc-900 dark:border-white/12 dark:text-zinc-400 dark:hover:border-white/35 dark:hover:text-white"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" strokeWidth={1.5} /> : <Moon className="h-4 w-4" strokeWidth={1.5} />}
          </button>
          <button
            type="button"
            onClick={onLogin}
            className="group flex items-center gap-1.5 rounded-full bg-zinc-900 px-5 py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            开始使用
            <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
        </div>
      </nav>
    </header>
  )
}
