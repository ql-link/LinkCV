import { FileText, Folder, MoreHorizontal, Search } from "lucide-react";
import { c } from "../app/theme";
import { easeInOut, fadeUp, mix, ramp, useT } from "../app/anim";
import { Button, PageHeader } from "../app/ui";

function MdDoc({ rotate, x }: { rotate: number; x: number }) {
  return <div style={{ position: "absolute", left: x, top: 34, width: 64, height: 82, borderRadius: 4, background: "#fff", boxShadow: "0 1px 4px #0000001f", transform: `rotate(${rotate}deg)`, padding: 8 }}>
    <div style={{ width: 28, height: 4, background: c.ink, borderRadius: 2 }} />
    {[80, 90, 70].map((w, i) => <div key={i} style={{ width: `${w}%`, height: 3, marginTop: 6, background: "#ececea" }} />)}
    <span style={{ position: "absolute", left: 8, bottom: 8, fontSize: 8, fontWeight: 700, color: "#fff", background: c.green, padding: "1px 4px", borderRadius: 3 }}>MD</span>
  </div>;
}

const folders = [
  { name: "项目与作品", before: 1, after: 3, date: "今天" },
  { name: "面试准备", before: 3, after: 3, date: "10-03" },
  { name: "求职材料", before: 2, after: 2, date: "09-30" },
];
const uploads = ["审批配置项目复盘.md", "产品作品集.md"];

/** 资料库：两份资料从右侧拖入「项目与作品」，文件夹计数与最近上传同步更新。dropAt 为落下时刻。 */
export function DatasetsPage({ dropAt }: { dropAt: number }) {
  const t = useT();
  const landed = ramp(t, dropAt, 0.3);
  const hover = ramp(t, dropAt - 0.9, 0.3) * (1 - landed);
  const fly = ramp(t, dropAt - 1.4, 1.4, easeInOut);
  return <>
    <PageHeader eyebrow={`DATASETS · ${landed > 0.5 ? 8 : 6} 份`} title="资料库" sub={`${landed > 0.5 ? 8 : 6} 份资料 · 3 个文件夹`} actions={<>
      <span style={{ width: 200, height: 32, borderRadius: 8, background: c.soft, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", fontSize: 13, color: c.faint }}><Search size={14} />搜索资料…</span>
      <Button primary>新建文件夹</Button></>} />
    <div style={{ position: "absolute", left: 50, right: 50, top: 176, height: 1, background: c.line }} />
    <p style={{ position: "absolute", left: 50, top: 196, margin: 0, fontSize: 15, fontWeight: 600 }}>文件夹</p>
    {folders.map((f, i) => {
      const isTarget = i === 0;
      const count = isTarget && landed > 0.5 ? f.after : f.before;
      return <div key={f.name} style={{ position: "absolute", left: 50 + i * 382, top: 228, width: 360, height: 226, borderRadius: 14, background: "#fff", boxShadow: `0 0 0 ${isTarget ? 1 + hover * 1.5 : 1}px ${isTarget && hover > 0 ? c.blue : c.line}`, ...fadeUp(t, 0.1 + i * 0.08) }}>
        <div style={{ position: "absolute", left: 8, top: 8, right: 8, height: 150, borderRadius: 10, background: isTarget ? `rgba(63,111,216,${0.06 * hover})` : c.soft, backgroundColor: isTarget && hover > 0 ? c.blueSoft : c.soft, overflow: "hidden" }}>
          <MdDoc rotate={-4} x={92} /><MdDoc rotate={0} x={146} /><MdDoc rotate={5} x={200} />
        </div>
        <p style={{ position: "absolute", left: 18, top: 170, margin: 0, fontSize: 14, fontWeight: 500 }}>{f.name}</p>
        <p style={{ position: "absolute", left: 18, top: 194, margin: 0, fontSize: 12, color: c.mute }}>{count} 份资料 · 最近上传 {f.date}</p>
        <MoreHorizontal size={16} style={{ position: "absolute", right: 16, top: 172, color: c.mute }} />
      </div>;
    })}
    {/* 拖入中的两份文件 */}
    {landed < 1 && uploads.map((name, i) => {
      const x = mix(1180, 140 + i * 30, fly);
      const y = mix(520 + i * 46, 290 + i * 14, fly);
      return <div key={name} style={{ position: "absolute", left: x, top: y, height: 38, padding: "0 14px", borderRadius: 10, background: "#fff", boxShadow: "0 10px 26px #17191c26, 0 0 0 1px #17191c14", display: "flex", alignItems: "center", gap: 8, fontSize: 13, opacity: (fly > 0 ? 1 : 0) * (1 - landed), transform: `rotate(${(1 - fly) * 4 - 2}deg) scale(${1 - landed * 0.3})` }}><FileText size={15} color={c.green} />{name}</div>;
    })}
    <p style={{ position: "absolute", left: 50, top: 488, margin: 0, fontSize: 15, fontWeight: 600 }}>最近上传</p>
    <div style={{ position: "absolute", left: 50, right: 50, top: 520, borderRadius: 14, boxShadow: `0 0 0 1px ${c.line}`, overflow: "hidden" }}>
      {[...(landed > 0.5 ? uploads : []), "二面准备笔记.md", "面试常见问题.md"].map((name, i) => {
        const isNew = landed > 0.5 && i < 2;
        const p = isNew ? ramp(t, dropAt + 0.15 + i * 0.12, 0.4) : 1;
        return <div key={name} style={{ height: 56 * p, opacity: p, display: "flex", alignItems: "center", padding: "0 18px", gap: 14, borderTop: i ? `1px solid ${c.line}` : "none", fontSize: 14, overflow: "hidden", background: isNew ? `rgba(63,111,216,${0.05 * (1 - ramp(t, dropAt + 1.5, 0.8))})` : "#fff" }}>
          <span style={{ width: 32, height: 32, borderRadius: 8, background: c.soft, display: "grid", placeItems: "center", fontSize: 9, fontWeight: 700, color: c.green }}>MD</span>
          <span style={{ flex: 1 }}>{name}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, padding: "3px 8px", borderRadius: 6, background: c.soft, width: 200 }}><Folder size={12} />{isNew ? "项目与作品" : "面试准备"}</span>
          <span style={{ width: 120, textAlign: "right", fontSize: 12.5, color: c.mute }}>{isNew ? "刚刚" : "10-03 21:40"}</span>
        </div>;
      })}
    </div>
  </>;
}
