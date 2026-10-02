import { useEffect, useRef, useState } from "react";
import type { AgentContextSnapshot } from "../../api/client";
import { Icon } from "../../v3/Icon";
import { BeTag } from "../../v3/primitives";
import type { GeneratedDocument, ScreenshotAttachment } from "./PreviewPanel";

// Figma 01.1g: 后端没有文档生成接口，内容由本地模板给出，只存在于当前对话的 React 状态；
// 「保存」会把当前内容作为 .md 文件上传到资料库（POST /api/datasets），保存成功后才标记已保存。
export function isLocalDocumentRequest(prompt: string) {
  return !/(?:不要|不必|不用|不需要|无需|别).{0,8}(?:生成|整理|写|输出|制作|准备)/u.test(prompt)
    && /(?:生成|整理成|写|输出|制作|准备).{0,30}(?:文档|\.md|markdown)/iu.test(prompt);
}
export function createLocalDocument(id: string, contexts: AgentContextSnapshot[]): GeneratedDocument {
  const resume = contexts.find((item) => item.type === "resume")?.label;
  const jd = contexts.find((item) => item.type === "dataset")?.label;
  return {
    kind: "generated", id, label: "面试准备.md",
    content: `# 面试准备\n\n${resume || jd ? `参考资料：${[resume, jd].filter(Boolean).map((label) => `「${label}」`).join("、")}。` : "请结合目标岗位补充以下准备内容。"}\n\n### 1. 自我介绍 · 90 秒\n\n梳理工作经历的主线，选择与目标岗位最相关的项目，说明自己的职责、关键决策和可验证的结果。\n\n### 2. 项目深挖 · 分布式任务调度\n\n- 时间轮 + 分片的设计动机，为什么不用延迟消息队列\n- 节点宕机后的任务迁移，如何避免任务重复执行\n- 分片数如何扩缩容，扩容时的数据迁移方案\n\n### 3. 系统设计 · 短链服务\n\n- 发号器选型：号段模式 vs 雪花算法，各自的取舍\n- 热点短链的缓存与防击穿策略\n\n### 4. 反问环节\n\n- 团队目前调度系统的规模和主要挑战`,
  };
}
export function GeneratedDocumentCard({ document, active, onOpen }: { document: GeneratedDocument; active: boolean; onOpen: () => void }) {
  return <section className={`assistant-artifact${active ? " is-active" : ""}`} aria-label={`AI 生成文档 ${document.label}`}>
    <span className="assistant-artifact-icon"><Icon name="spark" size={18} /></span>
    <div className="assistant-artifact-copy"><strong>{document.label}</strong><small>AI 生成文档 · {document.content.replace(/\s/g, "").length.toLocaleString()} 字 · {document.saved ? "已保存到资料库" : "未保存到资料库"}</small><BeTag title="文档内容目前由本地模板给出，AI 文档生成需要后端" /></div>
    {active ? <span className="assistant-artifact-opened">已在右侧打开</span> : <button type="button" className="v3-btn v3-btn-ghost" onClick={onOpen}><Icon name="panel" size={13} />打开</button>}
  </section>;
}
export function ScreenshotStrip({ images, sent = false, activeKey, onOpen, onRemove }: { images: ScreenshotAttachment[]; sent?: boolean; activeKey: string | null; onOpen: (image: ScreenshotAttachment) => void; onRemove?: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState(5);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const update = () => setSlots(Math.max(1, Math.floor((node.clientWidth + 8) / ((sent ? 72 : 56) + 8))));
    update(); const observer = new ResizeObserver(update); observer.observe(node); return () => observer.disconnect();
  }, [sent]);
  if (!images.length) return null;
  const visibleCount = images.length > slots ? Math.max(0, slots - 1) : images.length;
  return <div ref={ref} className={`assistant-screenshots${sent ? " is-sent" : ""}`} aria-label={sent ? "已发送的截图" : "待发送的截图"}>
    {images.slice(0, visibleCount).map((item) => <span key={item.id} className={`assistant-screenshot${activeKey === `image:${item.id}` ? " is-active" : ""}`}><button type="button" aria-label={`预览截图 ${item.label}`} onClick={() => onOpen(item)}><img src={item.url} alt={item.label} /></button>{onRemove && <button type="button" className="assistant-screenshot-remove" aria-label={`移除截图 ${item.label}`} onClick={() => onRemove(item.id)}><Icon name="x" size={10} /></button>}</span>)}
    {images.length > visibleCount && <button type="button" className="assistant-screenshot-more" aria-label={`查看其余 ${images.length - visibleCount} 张截图`} onClick={() => onOpen(images[visibleCount])}>+{images.length - visibleCount}</button>}
  </div>;
}
