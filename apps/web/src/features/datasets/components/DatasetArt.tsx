import type { CSSProperties, ReactNode } from "react";
import type { DatasetRecord } from "../../../api/client";
import { Icon } from "../../../v3/Icon";
import { Badge, Bar, Centered, DashArrow, Paper, StageText } from "../../../v3/art";

// 06 资料库的插图零件：格式方块、缩略纸张、各弹窗舞台插图。坐标全部取自 Figma 画板。

type FormatTone = { label: string; color: string; tint: string };

const TONES: Record<string, { color: string; tint: string }> = {
  PDF: { color: "var(--v3-rd)", tint: "#fbeeee" },
  MD: { color: "var(--v3-gn)", tint: "#ecf5ef" },
  DOCX: { color: "var(--v3-bl)", tint: "#edf2fc" },
  TXT: { color: "var(--v3-sub)", tint: "var(--v3-field)" },
  MEDIA: { color: "var(--v3-or)", tint: "#fbf1e6" },
};

// 资料格式 → 方块文字与配色（音视频统一橙色）
export function datasetFormatTone(dataset: Pick<DatasetRecord, "file_format" | "asset_kind">): FormatTone {
  const label = (dataset.file_format || "").toUpperCase().slice(0, 4) || "FILE";
  if (dataset.asset_kind === "audio" || dataset.asset_kind === "video") return { label, ...TONES.MEDIA };
  const tone = TONES[label] ?? TONES.TXT;
  return { label, ...tone };
}

// 列表里的 32×32 格式方块：lightTint=true 时用同色浅底（06.2），否则用灰底（06.1 最近上传）
export function FormatSquare({ dataset, tinted = true }: { dataset: Pick<DatasetRecord, "file_format" | "asset_kind">; tinted?: boolean }) {
  const tone = datasetFormatTone(dataset);
  return (
    <span
      aria-hidden="true"
      className={`ds-fmt${tone.label.length > 3 ? " is-long" : ""}`}
      style={{ background: tinted ? tone.tint : "var(--v3-field)", color: tone.color }}
    >
      {tone.label}
    </span>
  );
}

// 文件夹卡片里的缩略纸张：60×78，标题条 + 四行灰条 + 左下角格式色块
export function FolderSheet({ x, y, rotate, dataset }: { x: number; y: number; rotate?: number; dataset: Pick<DatasetRecord, "file_format" | "asset_kind"> }) {
  const tone = datasetFormatTone(dataset);
  const style: CSSProperties = { left: x, top: y, transform: rotate ? `rotate(${rotate}deg)` : undefined };
  return (
    <span className="ds-sheet" aria-hidden="true" style={style}>
      <i className="is-title" />
      <i style={{ top: 23, width: 43 }} />
      <i style={{ top: 34, width: 43 }} />
      <i style={{ top: 44, width: 43 }} />
      <i style={{ top: 54, width: 24 }} />
      <span className="ds-sheet-fmt" style={{ background: tone.color }}>{tone.label}</span>
    </span>
  );
}

// 文件夹卡片舞台：按最近的 1–3 份资料排开纸张（3 张 ±7°，2 张 ±4°）
export function FolderStage({ samples }: { samples: Array<Pick<DatasetRecord, "id" | "file_format" | "asset_kind">> }) {
  const shown = samples.slice(0, 3);
  return (
    <span className="ds-folder-stage" aria-hidden="true">
      <span className="ds-folder-stage-inner">
        {shown.length === 0 && <span className="ds-folder-empty-sheet" />}
        {shown.length === 1 && <FolderSheet x={98} y={16} dataset={shown[0]} />}
        {shown.length === 2 && shown.map((item, index) => (
          <FolderSheet key={item.id} x={79 + index * 40} y={19} rotate={index === 0 ? -4 : 4} dataset={item} />
        ))}
        {shown.length === 3 && shown.map((item, index) => (
          <FolderSheet key={item.id} x={59 + index * 40} y={index === 1 ? 16 : 22} rotate={(index - 1) * 7} dataset={item} />
        ))}
      </span>
    </span>
  );
}

// 弹窗插图里的小文件（白纸 + 灰条 + 彩色标签）
function MiniDoc({ x, y, w, h, tag, color, rotate, opacity }: { x: number; y: number; w: number; h: number; tag: string; color: string; rotate?: number; opacity?: number }) {
  return (
    <Paper x={x} y={y} w={w} h={h} rotate={rotate} style={opacity ? { opacity } : undefined}>
      <Bar x={7} y={9} w={w * 0.55} h={4} r={2} color="var(--v3-sk2)" />
      <Bar x={7} y={18} w={w * 0.7} h={3} r={2} />
      <Bar x={7} y={25} w={w * 0.5} h={3} r={2} />
      <span style={{ position: "absolute", left: 7, top: h - 20, display: "grid", height: 13, placeItems: "center", borderRadius: 3, background: color, padding: "0 7px", color: "#fff", fontFamily: tag.length > 2 ? "var(--v3-num)" : undefined, fontSize: 7.5, fontWeight: 700 }}>{tag}</span>
    </Paper>
  );
}

// 音频小卡：黑点 + 波形
function AudioChip({ x, y, w = 70 }: { x: number; y: number; w?: number }) {
  const bars = [[26, 14, 3], [31, 10, 9], [36, 9, 12], [41, 10, 10], [46, 12, 5], [51, 13, 4], [56, 13, 5]];
  return (
    <Paper x={x} y={y} w={w} h={30} r={8}>
      <span style={{ position: "absolute", left: 8, top: 9, width: 12, height: 12, borderRadius: 6, background: "var(--v3-dark)" }} />
      {bars.map(([bx, by, bh]) => <Bar key={bx} x={bx} y={by} w={2} h={bh} color="var(--v3-sub)" />)}
    </Paper>
  );
}

/* 06.1a 上传：三张文件 + 音频卡（舞台 496×168，插图宽 220 居中） */
export function UploadArt() {
  return (
    <Centered width={220} height={100}>
      <MiniDoc x={0} y={24} w={46} h={60} tag="PDF" color="var(--v3-or)" rotate={-10} />
      <MiniDoc x={44} y={18} w={46} h={60} tag="JD" color="var(--v3-bl)" rotate={-2} />
      <MiniDoc x={88} y={24} w={46} h={60} tag="证书" color="var(--v3-gn)" rotate={6} />
      <AudioChip x={150} y={40} />
    </Centered>
  );
}

/* 06.1a 同名文件：两张重叠 PDF + 同名标签（舞台 456×96） */
export function ConflictArt({ name }: { name: string }) {
  return (
    <Centered width={252} height={96}>
      <MiniDoc x={0} y={16} w={50} h={64} tag="PDF" color="var(--v3-or)" rotate={-6} opacity={0.55} />
      <MiniDoc x={34} y={14} w={50} h={64} tag="PDF" color="var(--v3-or)" rotate={4} />
      <Paper x={102} y={34} w={150} h={28} r={8}>
        <span style={{ position: "absolute", left: 10, top: 11, width: 6, height: 6, borderRadius: 3, background: "var(--v3-or)" }} />
        <StageText x={22} y={7} size={10.5} style={{ maxWidth: 118, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</StageText>
      </Paper>
    </Centered>
  );
}

/* 06.1b 移动：文件 → 虚线箭头 → 文件夹（舞台 416×84） */
export function MoveArt({ tag, folderName }: { tag: string; folderName: string }) {
  return (
    <Centered width={182} height={84}>
      <MiniDoc x={0} y={14} w={42} h={54} tag={tag} color="var(--v3-bl)" rotate={-6} />
      <DashArrow x={56} y={32} w={44} />
      <svg aria-hidden="true" style={{ position: "absolute", left: 110, top: 12 }} width="72" height="54" viewBox="0 0 72 54" fill="none">
        <path d="M3 8a4 4 0 0 1 4-4h18l6 6h34a4 4 0 0 1 4 4v33a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8Z" fill="#ecece7" stroke="#c4c4be" />
        <path d="M3 18h66" stroke="#c4c4be" />
      </svg>
      <StageText x={110} y={38} size={9.5} style={{ width: 72, overflow: "hidden", textAlign: "center", textOverflow: "ellipsis" }}>{folderName}</StageText>
    </Centered>
  );
}

/* 06.1d 管理关联：文件卡 — 链接结 — 面试卡（舞台 476×96） */
export function AssociateArt({ dataset }: { dataset: Pick<DatasetRecord, "file_format" | "asset_kind"> }) {
  const tone = datasetFormatTone(dataset);
  const card = (x: number, head: ReactNode) => (
    <Paper x={x} y={22} w={76} h={52} r={8}>
      {head}
      <Bar x={40} y={14} w={26} h={4} r={2} color="var(--v3-sk2)" />
      <Bar x={40} y={24} w={20} h={4} r={2} />
      <Bar x={10} y={40} w={56} h={3} r={2} />
    </Paper>
  );
  return (
    <Centered width={240} height={96}>
      {card(0, (
        <span style={{ position: "absolute", left: 10, top: 10, display: "grid", width: 24, height: 24, placeItems: "center", borderRadius: 6, background: tone.tint, color: tone.color, fontFamily: "var(--v3-num)", fontSize: 7, fontWeight: 700 }}>{tone.label}</span>
      ))}
      <svg aria-hidden="true" style={{ position: "absolute", left: 80, top: 44 }} width="80" height="8" viewBox="0 0 80 8" fill="none">
        <path d="M2 4h76" stroke="#b9b9b3" strokeWidth="1.4" strokeDasharray="3 3" />
      </svg>
      <span style={{ position: "absolute", left: 108, top: 36, display: "grid", width: 24, height: 24, placeItems: "center", border: "1px solid var(--v3-cl)", borderRadius: 12, background: "#fff", color: "var(--v3-sub)" }}>
        <Icon name="link" size={14} />
      </span>
      {card(164, (
        <span style={{ position: "absolute", left: 10, top: 10, display: "grid", width: 24, height: 24, placeItems: "center", borderRadius: 6, background: "#eef3fc", color: "var(--v3-bl)" }}>
          <Icon name="cal" size={14} />
        </span>
      ))}
    </Centered>
  );
}

/* 状态变体 ③④ 空状态：文件夹 + 三张文件 + 音频卡（舞台 504×200） */
export function EmptyLibraryArt() {
  return (
    <Centered width={208} height={200}>
      <svg aria-hidden="true" style={{ position: "absolute", left: 0, top: 72 }} width="144" height="108" viewBox="0 0 144 108" fill="none">
        <path d="M6 20a8 8 0 0 1 8-8h34l10 10h72a8 8 0 0 1 8 8v64a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V20Z" fill="#e6e6e2" />
        <path d="M2 44a8 8 0 0 1 8-8h124a8 8 0 0 1 8 8v51a8 8 0 0 1-8 8H10a8 8 0 0 1-8-8V44Z" fill="#fff" stroke="#e4e4e0" />
      </svg>
      <MiniDoc x={6} y={34} w={50} h={64} tag="PDF" color="var(--v3-or)" rotate={-12} />
      <MiniDoc x={50} y={18} w={50} h={64} tag="JD" color="var(--v3-bl)" rotate={3} />
      <MiniDoc x={96} y={28} w={50} h={64} tag="证书" color="var(--v3-gn)" rotate={10} />
      <AudioChip x={142} y={140} w={66} />
    </Centered>
  );
}

/* 10.3 资料库加载失败：描边文件夹 + 红色叉（舞台 424×112） */
export function LoadFailedArt() {
  return (
    <Centered width={56} height={112}>
      <svg aria-hidden="true" style={{ position: "absolute", left: 0, top: 28 }} width="56" height="56" viewBox="0 0 56 56" fill="none">
        <path d="M8 18a4 4 0 0 1 4-4h10l4 4h18a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V18Z" fill="#fff" stroke="#c4c4be" strokeWidth="1.4" />
        <path d="M24 26l8 8M32 26l-8 8" stroke="#d64545" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </Centered>
  );
}

// 删除资料 / 文件夹确认弹窗插图：白纸 + 红色垃圾桶角标（舞台 372×128）
export function DeleteDatasetArt({ tag = "MD", color = "var(--v3-gn)" }: { tag?: string; color?: string }) {
  return (
    <Centered width={120} height={128}>
      <MiniDoc x={28} y={26} w={58} h={76} tag={tag} color={color} rotate={-4} />
      <Badge x={80} y={82} size={30} icon="trash" fill="var(--v3-rd-soft)" color="var(--v3-rd)" border="#f1d4d4" />
    </Centered>
  );
}
