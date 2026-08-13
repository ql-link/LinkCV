import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

interface RevealProps {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
  once?: boolean
}

/** 滚动进入视口时的淡入上移动效 */
export function Reveal({ children, delay = 0, y = 28, className, once = true }: RevealProps) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-80px' }}
      transition={{ duration: 0.7, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {children}
    </motion.div>
  )
}

/** 区块标题：等宽字体编号 + 大标题 + 描述 */
export function SectionHeading({
  index,
  eyebrow,
  title,
  description,
  align = 'left',
}: {
  index: string
  eyebrow: string
  title: ReactNode
  description?: string
  align?: 'left' | 'center'
}) {
  const centered = align === 'center'
  return (
    <div className={centered ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <Reveal>
        <div className={`flex items-center gap-3 font-mono text-[11px] tracking-[0.14em] text-zinc-400 dark:text-zinc-500 uppercase ${centered ? 'justify-center' : ''}`}>
          <span className="text-zinc-400 dark:text-zinc-500">{index}</span>
          <span className="h-px w-6 bg-black/15 dark:bg-white/15" aria-hidden />
          <span>{eyebrow}</span>
        </div>
      </Reveal>
      <Reveal delay={0.08}>
        <h2 className="text-balance mt-6 font-display text-3xl font-medium !leading-[1.32] tracking-tight text-zinc-900 dark:text-white sm:text-4xl lg:text-[2.75rem]">
          {title}
        </h2>
      </Reveal>
      {description ? (
        <Reveal delay={0.16}>
          <p className="mt-5 text-base leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>
        </Reveal>
      ) : null}
    </div>
  )
}
