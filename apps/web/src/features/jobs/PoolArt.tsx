import { Bar, Badge, Centered, DashArrow, Paper, TagCard } from "../../v3/art";

// 岗位池插图：坐标照 Figma「12 · 官网岗位池」的空状态、岗位不存在与加入弹窗，放在 .v3-stage 里使用。

function BanBadge({ x, y }: { x: number; y: number }) {
  return <span aria-hidden="true" style={{ position: "absolute", left: x, top: y, display: "grid", width: 26, height: 26, placeItems: "center", border: "1px solid var(--v3-cl)", borderRadius: 13, background: "#fff", boxShadow: "0 2px 6px rgb(0 0 0 / 8%)" }}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--v3-sub)" strokeWidth="2.2" strokeLinecap="round"><circle cx="12" cy="12" r="8.5" /><path d="M6 18L18 6" /></svg>
  </span>;
}

/** 空结果：带当前条件的搜索框 + 清除角标，下面三行虚线空位 */
export function PoolEmptyArt({ summary }: { summary: string }) {
  return <Centered width={240} height={150}>
    <span aria-hidden="true" style={{ position: "absolute", left: 30, top: 24, display: "flex", width: 180, height: 28, alignItems: "center", gap: 6, border: "1px solid var(--v3-cl)", borderRadius: 14, background: "#fff", padding: "0 12px", color: "var(--v3-sub)", fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", boxShadow: "0 2px 6px rgb(0 0 0 / 6%)" }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>
    </span>
    <Badge x={196} y={14} icon="x" size={22} />
    {[64, 92, 120].map((top, index) => <span key={top} aria-hidden="true" style={{ position: "absolute", left: 30, top, width: 180, height: 22, border: "1px dashed var(--v3-sk2)", borderRadius: 6, background: "rgb(255 255 255 / 60%)" }}>
      <Bar x={8} y={9} w={10} h={4} r={2} />
      <Bar x={24} y={9} w={index === 1 ? 64 : 84} h={4} r={2} />
    </span>)}
  </Centered>;
}

/** 卡片 + 状态标签 + 禁止角标：岗位不存在（链接已失效）与岗位已下线共用 */
export function PoolUnavailableArt({ tag }: { tag: string }) {
  return <Centered width={220} height={96} top={16}>
    <Paper x={30} y={12} w={150} h={66} r={8}>
      <Bar x={14} y={14} w={20} h={20} r={5} color="#8d8d87" />
      <Bar x={44} y={16} w={70} h={6} r={3} />
      <Bar x={44} y={28} w={44} h={4} r={2} />
      <Bar x={14} y={48} w={100} h={4} r={2} />
    </Paper>
    <TagCard x={120} y={0} text={tag} dot="#8d8d87" />
    <BanBadge x={166} y={60} />
  </Centered>;
}

/** 加入失败：岗位卡片 → 求职进程空位，红色失败角标 */
export function PoolJoinFailedArt() {
  return <Centered width={330} height={128}>
    <Paper x={40} y={28} w={128} h={70} r={8}>
      <Bar x={12} y={14} w={26} h={26} r={6} color="var(--v3-dark)" />
      <Bar x={48} y={16} w={50} h={6} r={3} />
      <Bar x={48} y={29} w={32} h={4} r={2} />
      <Bar x={12} y={48} w={28} h={10} r={3} />
    </Paper>
    <DashArrow x={184} y={56} w={44} />
    <Paper x={246} y={20} w={92} h={88} r={8} shadow={false} style={{ background: "#fafaf8" }}>
      <Bar x={10} y={12} w={6} h={6} r={3} color="#8d8d87" />
      <Bar x={22} y={13} w={40} h={4} r={2} />
      <span style={{ position: "absolute", left: 8, top: 30, width: 74, height: 20, border: "1px dashed var(--v3-sk2)", borderRadius: 5 }} />
      <span style={{ position: "absolute", left: 8, top: 56, width: 74, height: 20, border: "1px dashed var(--v3-sk2)", borderRadius: 5 }} />
    </Paper>
    <Badge x={314} y={88} icon="x" size={26} fill="var(--v3-rd-soft)" color="var(--v3-rd)" border="var(--v3-rd)" />
  </Centered>;
}
