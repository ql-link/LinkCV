import { Check, Plus, Search, Upload } from "lucide-react";
import { c, font } from "../app/theme";
import { fadeUp, ramp, useT } from "../app/anim";
import { Button, Lines, Modal, PageHeader } from "../app/ui";

function Paper({ accent, photo }: { accent: string; photo?: boolean }) {
  return <div style={{ position: "absolute", inset: 0, background: "#fff", padding: 14, boxShadow: `0 0 0 1px ${c.line}` }}>
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <div><div style={{ fontFamily: font.paper, fontSize: 15, fontWeight: 600, color: accent }}>张三</div><Lines widths={[60]} h={3} /></div>
      {photo && <div style={{ width: 26, height: 32, background: "#d9dde3" }} />}
    </div>
    {[0, 1, 2].map((s) => <div key={s} style={{ marginTop: 12 }}><div style={{ width: 40, height: 4, background: accent, marginBottom: 6, opacity: 0.8 }} /><Lines widths={[95, 88, 70, 92]} gap={4} h={2.5} /></div>)}
  </div>;
}

const modules = [["教育经历", "1 段"], ["工作经历", "3 段"], ["项目经历", "2 个"], ["专业技能", "8 项"]];

/** 我的简历：点击「导入简历」后解析 PDF、逐项识别模块，导入后新卡片出现在列表首位。 */
export function ResumesPage({ openAt, parsedAt, importAt }: { openAt: number; parsedAt: number; importAt: number }) {
  const t = useT();
  const added = ramp(t, importAt + 0.25, 0.5);
  const cards = [
    { name: "产品经理 · 张三", meta: "刚刚 · 已导入", accent: c.ink, photo: true, isNew: true },
    { name: "增长产品经理 · 张三", meta: "昨天 · 已保存", accent: "#2f5fc4" },
    { name: "平台产品经理 · 张三", meta: "10-02 · 已保存", accent: "#5d6b7a", photo: true },
  ];
  return <>
    <PageHeader eyebrow="RESUMES · 3 份" title="我的简历" sub="每份简历独立编辑，需要时复制一份按岗位修改。" actions={<><Button><Upload size={14} />导入简历</Button><Button primary><Plus size={14} />新建简历</Button></>} />
    <p style={{ position: "absolute", left: 50, top: 196, margin: 0, fontSize: 14, fontWeight: 600 }}>全部简历 <span style={{ color: c.mute, fontWeight: 400 }}>3</span></p>
    <span style={{ position: "absolute", right: 50, top: 190, width: 200, height: 30, borderRadius: 8, background: c.soft, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", fontSize: 12.5, color: c.faint }}><Search size={13} />搜索简历…</span>
    {cards.map((card, i) => {
      const slot = card.isNew ? 0 : i - 1 + added;
      if (card.isNew && added <= 0) return null;
      const p = card.isNew ? added : 1;
      return <div key={card.name} style={{ position: "absolute", left: 50 + slot * 228, top: 236, width: 208, opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
        <div style={{ position: "relative", width: 208, height: 270, borderRadius: 4, overflow: "hidden", boxShadow: card.isNew ? `0 0 0 ${2 * (1 - ramp(t, importAt + 1.8, 0.6))}px ${c.blue}` : "none" }}><Paper accent={card.accent} photo={card.photo} /></div>
        <p style={{ margin: "12px 0 0", fontSize: 13.5, fontWeight: 500 }}>{card.name}</p>
        <p style={{ margin: "4px 0 0", fontSize: 12, color: c.mute }}>{card.meta}</p>
      </div>;
    })}
    <div style={{ position: "absolute", left: 50 + (2 + added) * 228, top: 236, width: 208, height: 270, borderRadius: 6, border: `1px dashed ${c.line2}`, display: "grid", placeItems: "center", color: c.mute, fontSize: 12.5 }}><span style={{ textAlign: "center" }}><Plus size={18} /><br />新建空白简历</span></div>
  </>;
}

/** 导入弹窗，作为 Shell 的 overlay 覆盖整个工作区。 */
export function ResumeImportOverlay({ openAt, parsedAt, importAt }: { openAt: number; parsedAt: number; importAt: number }) {
  const t = useT();
  const p = Math.min(ramp(t, openAt, 0.35), 1 - ramp(t, importAt + 0.1, 0.25));
  const parsing = ramp(t, openAt + 0.4, parsedAt - openAt - 0.4, (v) => v);
  return <Modal p={p} width={440} height={400}>
      <div style={{ padding: 24 }}>
        <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>导入简历</p>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: c.mute }}>支持 PDF、Word（DOCX）和 Markdown</p>
        <div style={{ marginTop: 18, height: 64, borderRadius: 12, boxShadow: `inset 0 0 0 1px ${c.line2}`, display: "flex", alignItems: "center", gap: 12, padding: "0 14px" }}>
          <span style={{ width: 36, height: 36, borderRadius: 8, background: "#fde8e8", color: c.red, fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center" }}>PDF</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 13.5 }}>张三_产品经理_2026.pdf</p>
            {parsing < 1 ? <div style={{ marginTop: 7, height: 4, borderRadius: 4, background: c.soft }}><div style={{ width: `${parsing * 100}%`, height: 4, borderRadius: 4, background: c.blue }} /></div>
              : <p style={{ margin: "3px 0 0", fontSize: 12, color: c.green }}>1.2 MB · 已解析</p>}
          </div>
        </div>
        <p style={{ margin: "18px 0 10px", fontSize: 12.5, color: c.mute, opacity: ramp(t, parsedAt, 0.3) }}>识别到 4 个模块</p>
        {modules.map(([name, count], i) => <div key={name} style={{ height: 34, display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, ...fadeUp(t, parsedAt + 0.15 + i * 0.18, 6, 0.3) }}>
          <Check size={15} color={c.green} /><span style={{ flex: 1 }}>{name}</span><span style={{ color: c.mute, fontSize: 12.5 }}>{count}</span>
        </div>)}
        <div style={{ position: "absolute", right: 24, bottom: 22, display: "flex", gap: 8, opacity: ramp(t, parsedAt + 0.9, 0.3) }}><Button>取消</Button><Button primary>导入并编辑</Button></div>
      </div>
    </Modal>;
}
