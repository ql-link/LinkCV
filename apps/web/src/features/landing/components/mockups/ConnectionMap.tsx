import { motion } from 'motion/react'
import { FileText, Globe, MessageSquare, LayoutTemplate, type LucideIcon } from 'lucide-react'
import { SiGooglechrome } from 'react-icons/si'
import type { IconType } from 'react-icons'

type AnyIcon = LucideIcon | IconType

interface Node {
  id: string
  icon: AnyIcon
  label: string
  /** 节点中心位置，相对容器的百分比 */
  x: number
  y: number
}

const W = 560
const H = 400
const CX = 280
const CY = 200

const nodes: Node[] = [
  { id: 'word', icon: FileText, label: 'Word 文档', x: 84, y: 60 },
  { id: 'pdf', icon: PdfGlyph, label: 'PDF 副本', x: 470, y: 46 },
  { id: 'chrome', icon: SiGooglechrome, label: '浏览器收藏', x: 492, y: 268 },
  { id: 'chat', icon: MessageSquare, label: '聊天记录', x: 386, y: 352 },
  { id: 'tpl', icon: LayoutTemplate, label: '模板网站', x: 118, y: 322 },
  { id: 'site', icon: Globe, label: '招聘平台', x: 66, y: 208 },
]

/** PDF 角标图标（Lucide 风格线条） */
function PdfGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <text x="12" y="17.5" textAnchor="middle" fontSize="6" fontWeight="700" fill="currentColor" stroke="none" fontFamily="ui-monospace, monospace">
        PDF
      </text>
    </svg>
  )
}

/**
 * 散落工具 → LinkCV 连接图。
 * 每个图标沿其与中心的连线方向做呼吸式漂移，连线虚线缓缓流动。
 */
export function ConnectionMap() {
  return (
    <div className="relative mx-auto w-full max-w-[560px]" style={{ aspectRatio: `${W}/${H}` }}>
      {/* 连线层 */}
      <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden>
        {nodes.map((n, i) => {
          // 线条在节点边缘截断，避免插进图标
          const dx = n.x - CX
          const dy = n.y - CY
          const len = Math.hypot(dx, dy)
          const x1 = CX + (dx / len) * 46
          const y1 = CY + (dy / len) * 46
          const x2 = CX + (dx / len) * (len - 42)
          const y2 = CY + (dy / len) * (len - 42)
          return (
            <g key={n.id}>
              <motion.line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className="stroke-zinc-400/40 dark:stroke-zinc-600/50"
                strokeWidth="1"
                strokeDasharray="3 6"
                strokeLinecap="round"
                initial={{ pathLength: 0, opacity: 0 }}
                whileInView={{ pathLength: 1, opacity: 1 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 1.1, delay: 0.3 + i * 0.12, ease: 'easeOut' }}
                style={{ animation: 'dash-flow 3.2s linear infinite' }}
              />
              {/* 沿连线流向中心的光点 */}
              <motion.circle
                r="2.5"
                className="fill-zinc-500 dark:fill-zinc-400"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 1, 0] }}
                transition={{ duration: 2.6, delay: 1 + i * 0.45, repeat: Infinity, repeatDelay: 1.6, ease: 'linear' }}
              >
                <animateMotion dur="2.6s" begin={`${1 + i * 0.45}s`} repeatCount="indefinite" path={`M ${x2} ${y2} L ${x1} ${y1}`} />
              </motion.circle>
            </g>
          )
        })}
      </svg>

      {/* 中心 LinkCV */}
      <motion.div
        className="absolute z-10"
        style={{ left: `${(CX / W) * 100}%`, top: `${(CY / H) * 100}%`, x: '-50%', y: '-50%' }}
        initial={{ opacity: 0, scale: 0.6 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.7, delay: 0.1, ease: [0.21, 0.47, 0.32, 0.98] }}
      >
        <div className="flex h-[88px] w-[88px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-zinc-900 shadow-2xl shadow-black/25 ring-4 ring-zinc-900/10 dark:bg-white dark:shadow-white/10 dark:ring-white/10">
          <span className="font-display text-lg font-bold leading-none text-white dark:text-black">L</span>
          <span className="font-mono text-[9px] tracking-[0.18em] text-zinc-400 dark:text-zinc-600">LinkCV</span>
        </div>
      </motion.div>

      {/* 散落节点 */}
      {nodes.map((n, i) => {
        // 漂移方向：沿与中心的连线
        const dx = n.x - CX
        const dy = n.y - CY
        const len = Math.hypot(dx, dy)
        const ux = (dx / len) * 5
        const uy = (dy / len) * 5
        const Icon = n.icon
        return (
          <motion.div
            key={n.id}
            className="absolute"
            style={{ left: `${(n.x / W) * 100}%`, top: `${(n.y / H) * 100}%`, x: '-50%', y: '-50%' }}
            initial={{ opacity: 0, scale: 0.7 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.55, delay: 0.25 + i * 0.1 }}
          >
            <motion.div
              animate={{ x: [0, ux, 0, -ux * 0.6, 0], y: [0, uy, 0, -uy * 0.6, 0] }}
              transition={{ duration: 5.5 + i * 0.7, repeat: Infinity, ease: 'easeInOut', delay: i * 0.4 }}
              className="flex flex-col items-center gap-1.5"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-black/[0.09] bg-white/90 shadow-sm backdrop-blur-sm dark:border-white/[0.1] dark:bg-[#111114]/90">
                <Icon className="h-[18px] w-[18px] text-zinc-500 dark:text-zinc-400" />
              </div>
              <span className="rounded bg-white/70 px-1.5 font-mono text-[10px] whitespace-nowrap text-zinc-500 backdrop-blur-sm dark:bg-[#0b0b0d]/70 dark:text-zinc-500">
                {n.label}
              </span>
            </motion.div>
          </motion.div>
        )
      })}
    </div>
  )
}
