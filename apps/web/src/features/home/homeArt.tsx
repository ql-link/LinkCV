import type { CSSProperties, ReactNode } from "react";
import resumeErrorCloud from "../../assets/figma/resume-error-cloud.svg";
import { Badge, Bar, Centered, DashArrow, Dot, FilePaper, MiniResume, Paper, StageText, TagCard } from "../../v3/art";

// 02.1 系列弹窗 / 空状态的插图，坐标照 Figma 画板（单位 px，原点为舞台左上角）。
// 注意：Figma 的 rotation 正值是逆时针，CSS rotate 正值是顺时针，所以这里统一取相反数。

export function ResumeLoadErrorArt() {
  return (
    <Centered width={464} height={150}>
      <MiniResume x={115.2} y={26} w={68} h={92} rotate={8} accent="#c4c4be" style={{ opacity: 0.5 }} />
      <MiniResume x={268} y={16.54} w={68} h={92} rotate={-8} accent="#c4c4be" style={{ opacity: 0.5 }} />
      <MiniResume x={194} y={20} w={76} h={104} accent="#c4c4be" style={{ opacity: 0.8 }} />
      <span className="hv3-load-error-badge"><img src={resumeErrorCloud} width={40} height={40} alt="" /></span>
    </Centered>
  );
}

/* 02.1 空列表：空白简历纸 + 三张倾斜的模块标签（舞台 504×236） */
export function EmptyListArt() {
  return (
    <Centered width={504} height={236}>
      <Paper x={186} y={30} w={132} h={176} r={5}>
        <Bar x={16} y={20} w={48} h={7} r={2} color="var(--v3-dark)" />
        <Bar x={16} y={33} w={72} h={3} color="var(--v3-sk2)" />
        {[52, 94, 136].map((y) => (
          <span key={y} style={{ position: "absolute", left: 16, top: y, width: 100, height: 30, border: "1px dashed var(--v3-fl)", borderRadius: 4 }} />
        ))}
      </Paper>
      <ModuleChip x={90} y={68} rotate={4} text="教育经历" />
      <ModuleChip x={336} y={110} rotate={-3} text="项目经历" />
      <ModuleChip x={104} y={158} rotate={-2} text="专业技能" />
    </Centered>
  );
}

function ModuleChip({ x, y, rotate, text }: { x: number; y: number; rotate: number; text: string }) {
  return (
    <span style={{ position: "absolute", left: x, top: y, display: "grid", width: 60, height: 24, placeItems: "center", border: "1px solid var(--v3-cl)", borderRadius: 6, background: "#fff", color: "var(--v3-sub)", fontSize: 10.5, fontWeight: 500, boxShadow: "0 2px 6px rgb(0 0 0 / 6%)", transform: `rotate(${rotate}deg)` }}>
      {text}
    </span>
  );
}

/* 02.1 搜索没有结果：三张简历 + 放大镜（舞台 504×200） */
export function SearchEmptyArt() {
  return (
    <Centered width={504} height={200}>
      <MiniResume x={150} y={36} w={80} h={108} rotate={8} style={{ opacity: 0.5, boxShadow: "none" }} />
      <MiniResume x={274} y={36} w={80} h={108} rotate={-7} style={{ opacity: 0.5, boxShadow: "none" }} />
      <MiniResume x={208} y={28} w={88} h={118} />
      <svg aria-hidden="true" style={{ position: "absolute", left: 262, top: 84 }} width={64} height={64} viewBox="0 0 64 64" fill="none">
        <circle cx={26} cy={26} r={17} fill="rgb(255 255 255 / 90%)" stroke="var(--v3-dark)" strokeWidth={2.4} />
        <path d="M39 39l14 14" stroke="var(--v3-dark)" strokeWidth={3} strokeLinecap="round" />
        <path d="M22.5 21.5a4.5 4.5 0 1 1 6.2 4.2c-1.4.6-2.2 1.6-2.2 3.1v.6" stroke="var(--v3-fnt)" strokeWidth={2} strokeLinecap="round" />
        <circle cx={26.5} cy={34.5} r={1.5} fill="var(--v3-fnt)" />
      </svg>
    </Centered>
  );
}

/* 模块化的简历纸：前 filled 块是内容，其余是虚线空位（对应 lib9 mpaper） */
function ModulesPaper({ x, y, filled }: { x: number; y: number; filled: number }) {
  const blocks = [28, 48, 67];
  return (
    <Paper x={x} y={y} w={76} h={88}>
      <Bar x={9} y={9} w={30} h={5} color="var(--v3-dark)" />
      <Bar x={9} y={18} w={46} h={3} color="var(--v3-sk2)" />
      {blocks.map((top, index) => index < filled ? (
        <span key={top} style={{ position: "absolute", left: 9, top, width: 58, height: 15, borderRadius: 3, background: "var(--v3-field)" }}>
          <Bar x={5} y={3.5} w={24} h={3} color="var(--v3-sk2)" />
          <Bar x={5} y={9} w={38} h={2.5} />
        </span>
      ) : (
        <span key={top} style={{ position: "absolute", left: 9, top, width: 58, height: 15, border: "1px dashed var(--v3-fl)", borderRadius: 3 }} />
      ))}
    </Paper>
  );
}

const FORMAT_TAG: Record<string, { tag: string; color: string }> = {
  md: { tag: "MD", color: "var(--v3-sub)" },
  docx: { tag: "DOCX", color: "var(--v3-bl)" },
  pdf: { tag: "PDF", color: "var(--v3-or)" },
};

export function formatTag(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return FORMAT_TAG[ext] ?? { tag: ext.toUpperCase().slice(0, 4) || "FILE", color: "var(--v3-sub)" };
}

/* 02.1b 导入简历：几种格式的文件 → AI 拆成模块的简历（舞台宽 496）。single 为已选文件后的单文件版 */
export function ImportArt({ single, filename }: { single?: boolean; filename?: string }) {
  const one = formatTag(filename ?? "x.pdf");
  return (
    <Centered width={496} height={single ? 116 : 104}>
      {single ? (
        <FilePaper x={168} y={22} w={48} h={62} tag={one.tag} color={one.color} rotate={6} />
      ) : (
        <>
          <FilePaper x={128} y={22} w={46} h={60} tag="MD" color="var(--v3-sub)" rotate={10} />
          <FilePaper x={150} y={18} w={46} h={60} tag="DOCX" color="var(--v3-bl)" rotate={2} />
          <FilePaper x={172} y={22} w={46} h={60} tag="PDF" color="var(--v3-or)" rotate={-6} />
        </>
      )}
      <DashArrow x={232} y={46} w={44} />
      <ModulesPaper x={284} y={14} filled={single ? 2 : 3} />
      <Badge x={346} y={6} icon="spark" />
    </Centered>
  );
}

/* 02.1d 分享简历：简历 → 公开页面 + 可见范围标签（舞台 456×116） */
export function ShareArt({ visibility, token }: { visibility: "public" | "private"; token?: string }) {
  const host = typeof window === "undefined" ? "linkresume.cn" : window.location.host;
  return (
    <Centered width={456} height={116}>
      <MiniResume x={112} y={18} w={62} h={84} rotate={4} />
      <DashArrow x={186} y={52} w={44} />
      <Paper x={238} y={20} w={156} h={80}>
        <Bar x={0} y={0} w={156} h={18} r={0} color="var(--v3-field)" />
        {[8, 17, 26].map((x) => <Dot key={x} x={x} y={6} color="var(--v3-fl)" />)}
        <span style={{ position: "absolute", left: 40, top: 4, width: 108, height: 10, overflow: "hidden", borderRadius: 5, background: "#fff" }}>
          <StageText x={6} y={0} size={7} weight={400} num color="var(--v3-fnt)" style={{ lineHeight: "10px" }}>{`${host}/share/${(token ?? "8f2a").slice(0, 4)}`}</StageText>
        </span>
        <Bar x={12} y={28} w={44} h={5} color="var(--v3-dark)" />
        <Bar x={12} y={38} w={72} h={3} color="var(--v3-sk2)" />
        <Bar x={12} y={50} w={132} h={3} />
        <Bar x={12} y={58} w={118} h={3} />
        <Bar x={12} y={66} w={88} h={3} />
      </Paper>
      <TagCard x={370} y={10} text={visibility === "public" ? "公开" : "仅自己"} dot={visibility === "public" ? "var(--v3-gn)" : "var(--v3-fnt2)"} />
    </Centered>
  );
}

/* 02.1e 重命名：简历 + 正在编辑的名称标签（舞台 416×96） */
export function RenameArt({ title }: { title: string }) {
  return (
    <Centered width={416} height={96}>
      <MiniResume x={108} y={14} w={50} h={68} rotate={4} />
      <span style={{ position: "absolute", left: 174, top: 32, display: "flex", width: 160, height: 34, alignItems: "center", gap: 2, overflow: "hidden", border: "1.5px solid var(--v3-dark)", borderRadius: 8, background: "#fff", padding: "0 12px", boxShadow: "0 4px 12px rgb(0 0 0 / 8%)" }}>
        <span style={{ minWidth: 0, overflow: "hidden", color: "var(--v3-txt)", fontSize: 11.5, fontWeight: 500, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
        <span style={{ width: 1.5, height: 16, flex: "0 0 auto", borderRadius: 1, background: "var(--v3-bl)" }} />
      </span>
      <Badge x={322} y={20} icon="edit" />
    </Centered>
  );
}

/* 02.1f 删除确认：两张淡化的简历 + 中间的简历 + 红色垃圾桶角标（舞台 372×128） */
export function DeleteResumeArt() {
  const faded: CSSProperties = { opacity: 0.4, boxShadow: "none" };
  return (
    <Centered width={372} height={128}>
      <MiniResume x={100} y={34} w={50} h={68} rotate={-6} accent="var(--v3-sub)" style={faded} />
      <MiniResume x={222} y={34} w={50} h={68} rotate={6} accent="var(--v3-sub)" style={faded} />
      <MiniResume x={157} y={20} w={58} h={80} />
      <Badge x={198} y={80} size={30} icon="trash" fill="var(--v3-rd-soft)" color="var(--v3-rd)" border="#f1d4d4" />
    </Centered>
  );
}

/* 导入任务卡里的半透明文档底稿（156×228） */
export function ImportTaskDoc({ children }: { children?: ReactNode }) {
  const rows: Array<[number, number, string]> = [
    [20, 52, "var(--v3-sk2)"], [46, 99, "var(--v3-sk)"], [72, 99, "var(--v3-sk)"], [98, 62, "var(--v3-sk)"],
    [124, 35, "var(--v3-sk2)"], [150, 99, "var(--v3-sk)"], [176, 62, "var(--v3-sk)"],
  ];
  return (
    <span aria-hidden="true" className="hv3-task-doc">
      {rows.map(([y, w, color]) => <Bar key={y} x={16} y={y} w={w} h={y === 20 ? 8 : 5} r={2} color={color} />)}
      {children}
    </span>
  );
}
