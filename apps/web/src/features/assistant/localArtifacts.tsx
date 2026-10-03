import { t, useLocale } from "@/i18n";
import { useEffect, useRef, useState } from "react";
import type { AgentMessage } from "../../api/client";
import { Icon } from "../../v3/Icon";
import type { GeneratedDocument, ScreenshotAttachment } from "./PreviewPanel";

export function isDocumentRequest(prompt: string) {
  return !/(?:不要|不必|不用|不需要|无需|别).{0,8}(?:生成|整理|写|输出|制作|准备)/u.test(prompt)
    && /(?:生成|整理成|写|输出|制作|准备).{0,30}(?:文档|\.md|markdown)/iu.test(prompt);
}

type DocumentMessage = AgentMessage & { temporary?: boolean; status?: "streaming" | "stopped" | "failed"; generatedDocument?: GeneratedDocument };
// Artifacts are derived from completed, persisted AI replies; no local content template is used.
export function attachGeneratedDocuments(messages: DocumentMessage[], sessionId: string): DocumentMessage[] {
  let requested = false;
  let clarification = false;
  return messages.map(message => {
    if (message.role === "user") {
      requested = isDocumentRequest(message.content) || clarification;
      clarification = false;
      return message;
    }
    if (message.message_type === "clarification") { clarification = requested; return message; }
    if (!requested || message.temporary || message.status || !message.content.trim()) return message;
    const fence = /^\s*```(?:markdown|md)\s*\n([\s\S]*?)\n```\s*$/i.exec(message.content);
    const content = fence ? fence[1] : message.content;
    const title = /^#\s+(.+)$/m.exec(content)?.[1];
    // A clarification or a refusal is still a normal reply, not a fabricated document.
    if (!title) return message;
    const label = `${title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 100) || "AI 文档"}.md`;
    return { ...message, generatedDocument: message.generatedDocument ?? {
      kind: "generated", id: `${sessionId}:${message.run_id || message.sequence_no}`, label, content,
    } };
  });
}

export function GeneratedDocumentCard({ document, active, onOpen }: { document: GeneratedDocument; active: boolean; onOpen: () => void }) {
  useLocale();
  return <section className={`assistant-artifact${active ? " is-active" : ""}`} aria-label={`AI 生成文档 ${document.label}`}>
    <span className="assistant-artifact-icon"><Icon name="spark" size={18} /></span>
    <div className="assistant-artifact-copy"><strong>{document.label}</strong><small>{t("AI 生成文档 · ")}{document.content.replace(/\s/g, "").length.toLocaleString()}{t(" 字 · ")}{document.saved ? t("已保存到资料库") : t("未保存到资料库")}</small></div>
    {active ? <span className="assistant-artifact-opened">{t("已在右侧打开")}</span> : <button type="button" className="v3-btn v3-btn-ghost" onClick={onOpen}><Icon name="panel" size={13} />{t("打开")}</button>}
  </section>;
}
export function ScreenshotStrip({ images, sent = false, activeKey, onOpen, onRemove }: { images: ScreenshotAttachment[]; sent?: boolean; activeKey: string | null; onOpen: (image: ScreenshotAttachment) => void; onRemove?: (id: string) => void }) {
  useLocale();
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
  return <div ref={ref} className={`assistant-screenshots${sent ? " is-sent" : ""}`} aria-label={sent ? t("已发送的截图") : t("待发送的截图")}>
    {images.slice(0, visibleCount).map((item) => <span key={item.id} className={`assistant-screenshot${activeKey === `image:${item.id}` ? " is-active" : ""}`}><button type="button" aria-label={`预览截图 ${item.label}`} onClick={() => onOpen(item)}><img src={item.url} alt={item.label} /></button>{onRemove && <button type="button" className="assistant-screenshot-remove" aria-label={`移除截图 ${item.label}`} onClick={() => onRemove(item.id)}><Icon name="x" size={10} /></button>}</span>)}
    {images.length > visibleCount && <button type="button" className="assistant-screenshot-more" aria-label={`查看其余 ${images.length - visibleCount} 张截图`} onClick={() => onOpen(images[visibleCount])}>+{images.length - visibleCount}</button>}
  </div>;
}
