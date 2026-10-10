import { CalendarDays, Filter, ListFilter, Search, Sparkles } from "lucide-react";
import { c } from "../app/theme";
import { easeInOut, fadeUp, mix, ramp, typed, useT } from "../app/anim";
import { Button, Dot, Modal, PageHeader } from "../app/ui";

type Job = { company: string; title: string; status: string; logo: string; today?: boolean };
const columns: { title: string; color: string; jobs: Job[] }[] = [
  { title: "待投递", color: "#6f737a", jobs: [{ company: "北辰数据", title: "数据产品经理", status: "等待确认投递", logo: "北" }] },
  { title: "筛选中", color: "#6f737a", jobs: [{ company: "远山设计", title: "平台产品经理", status: "等待结果", logo: "远" }] },
  { title: "测评", color: "#d9822b", jobs: [{ company: "光点软件", title: "商业化产品经理", status: "等待结果", logo: "光" }] },
  { title: "笔试", color: "#d9822b", jobs: [{ company: "云帆互联", title: "产品经理", status: "3 天后", logo: "云" }] },
  { title: "业务一面", color: "#3f6fd8", jobs: [{ company: "青舟数据", title: "增长产品经理", status: "今天 16:00", logo: "青", today: true }, { company: "澄海科技", title: "B 端产品经理", status: "2 天后", logo: "澄" }] },
  { title: "业务二面", color: "#3f6fd8", jobs: [] },
];
const COL_W = 206;
const colX = (i: number) => 50 + i * (COL_W + 10);
const BOARD_Y = 300;
const cardY = (row: number) => BOARD_Y + 42 + row * 112;

function JobCard({ job, style }: { job: Job; style?: React.CSSProperties }) {
  return <div style={{ position: "absolute", width: COL_W - 16, height: 100, borderRadius: 10, background: "#fff", boxShadow: `0 0 0 1px ${c.line}, 0 1px 2px #0000000a`, padding: "12px 14px", fontSize: 13.5, ...style }}>
    <p style={{ margin: 0, fontWeight: 500, whiteSpace: "nowrap" }}>{job.company} · {job.title}</p>
    <span style={{ display: "inline-block", marginTop: 10, fontSize: 12, padding: "2px 7px", borderRadius: 5, background: c.soft }}>正式</span>
    <div style={{ position: "absolute", left: 14, right: 12, bottom: 10, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.mute }}>
      {job.today ? <span style={{ background: c.ink, color: "#fff", borderRadius: 5, padding: "2px 7px" }}>{job.status}</span> : <><Dot color={c.blue} />{job.status}</>}
      <span style={{ marginLeft: "auto", width: 22, height: 22, borderRadius: "50%", background: c.soft, display: "grid", placeItems: "center", fontSize: 10, color: c.text }}>{job.logo}</span>
    </div>
  </div>;
}

const target: Job = { company: "星河科技", title: "高级产品经理", status: "待投递", logo: "星" };

/**
 * 岗位看板。mode=import：导入岗位后新卡片落入「待投递」；
 * mode=advance：星河科技卡片从「待投递」拖到「业务一面」，统计同步更新。
 */
export function JobsPage({ mode, at }: { mode: "import" | "advance"; at: number }) {
  const t = useT();
  const imported = mode === "advance" ? 1 : ramp(t, at, 0.5);
  const drag = mode === "advance" ? ramp(t, at, 1.5, easeInOut) : 0;
  const dropped = mode === "advance" ? ramp(t, at + 1.5, 0.25) : 0;
  const stats = [
    ["7", "投递总数"], [dropped > 0.5 ? "7" : "6", "本周面试"], ["57%", "面试转化率"], ["1", "Offer"],
  ];
  const fromX = colX(0) + 8;
  const toX = colX(4) + 8;
  const lift = Math.sin(Math.PI * drag);
  return <>
    <PageHeader eyebrow="JOBS · 本周 10-05 至 10-11" title="岗位看板" sub="8 个进行中 · 6 场面试 · 1 个 Offer 待回复" actions={<><Button><CalendarDays size={14} />已有面试安排</Button><Button primary>导入岗位</Button></>} />
    {stats.map(([value, label], i) => <div key={label} style={{ position: "absolute", left: 50 + i * 282, top: 178, width: 282, height: 70, borderLeft: i ? `1px solid ${c.line}` : "none", paddingLeft: i ? 20 : 0 }}>
      <p style={{ margin: 0, fontSize: 26, fontWeight: 600, lineHeight: "32px" }}>{value}{i === 3 && <span style={{ fontSize: 12, color: c.mute, fontWeight: 400, marginLeft: 6 }}>待回复</span>}</p>
      <p style={{ margin: "6px 0 0", fontSize: 12.5, color: c.mute }}>{label}</p>
    </div>)}
    <div style={{ position: "absolute", left: 50, right: 50, top: 254, height: 1, background: c.line }} />
    <div style={{ position: "absolute", left: 50, top: 266, display: "flex", padding: 3, borderRadius: 8, background: c.soft, fontSize: 13 }}><span style={{ padding: "3px 14px", borderRadius: 6, background: "#fff", fontWeight: 500 }}>看板</span><span style={{ padding: "3px 14px" }}>列表</span></div>
    <div style={{ position: "absolute", right: 50, top: 266, display: "flex", gap: 18, alignItems: "center", fontSize: 13 }}>
      <span style={{ width: 180, height: 28, borderRadius: 8, background: c.soft, display: "flex", alignItems: "center", gap: 8, padding: "0 10px", color: c.faint }}><Search size={13} />搜索公司、岗位…</span>
      <span style={{ display: "flex", gap: 5, alignItems: "center" }}><ListFilter size={14} />排序</span><span style={{ display: "flex", gap: 5, alignItems: "center" }}><Filter size={13} />筛选</span>
    </div>
    {columns.map((col, i) => {
      const extra = i === 0 ? (mode === "import" ? imported : 1 - dropped) : i === 4 ? dropped : 0;
      return <div key={col.title} style={{ position: "absolute", left: colX(i), top: BOARD_Y + 10, width: COL_W, height: 540, borderRadius: 12, background: "#f6f6f4" }}>
        <p style={{ margin: "12px 0 0 12px", fontSize: 13, display: "flex", alignItems: "center", gap: 7 }}><Dot color={col.color} />{col.title}<span style={{ color: c.mute, marginLeft: 4 }}>{col.jobs.length + (extra > 0.5 ? 1 : 0)}</span></p>
      </div>;
    })}
    {columns.map((col, i) => col.jobs.map((job, row) => {
      // 星河科技落到某列时，原有卡片下移让位。
      const shift = (i === 0 && mode === "import" ? imported : 0) + (i === 0 && mode === "advance" ? 1 - dropped : 0) + (i === 4 ? ramp(t, at + 1.1, 0.4) * (mode === "advance" ? 1 : 0) : 0);
      return <JobCard key={job.company} job={job} style={{ left: colX(i) + 8, top: cardY(row) + shift * 112 }} />;
    }))}
    {mode === "import" && imported > 0 && <JobCard job={target} style={{ left: fromX, top: cardY(0), opacity: imported, transform: `translateY(${(1 - imported) * -30}px)`, boxShadow: `0 0 0 ${1 + (1 - ramp(t, at + 1.2, 0.8)) * 1.5}px ${c.blue}, 0 8px 20px #17191c14` }} />}
    {mode === "advance" && <JobCard job={{ ...target, status: dropped > 0.5 ? "10-09 10:00 视频面试" : "已投递" }} style={{ left: mix(fromX, toX, drag), top: cardY(0) - lift * 26, transform: `rotate(${lift * 3}deg) scale(${1 + lift * 0.04})`, boxShadow: `0 0 0 1px ${dropped > 0 ? c.blue : c.line}, 0 ${6 + lift * 18}px ${14 + lift * 26}px #17191c${lift > 0.1 ? "26" : "0f"}`, zIndex: 3 }} />}
  </>;
}

const jd = "【星河科技】高级产品经理  上海 · 20-30K·14薪\n经验 5 年以上  本科\n\n岗位职责：\n1. 负责企业审批与流程引擎的产品规划；\n2. 通过数据分析与用户研究定位问题，推动方案落地并验证效果。";
const fields: [string, string][] = [["公司", "星河科技"], ["岗位", "高级产品经理"], ["城市", "上海"], ["薪资", "20–30K × 14 薪"], ["经验", "5 年以上"], ["类型", "正式"]];

/** 导入岗位弹窗：粘贴招聘文字 → 识别字段 → 保存。 */
export function JobImportOverlay({ openAt, pasteAt, parsedAt, saveAt }: { openAt: number; pasteAt: number; parsedAt: number; saveAt: number }) {
  const t = useT();
  const p = Math.min(ramp(t, openAt, 0.35), 1 - ramp(t, saveAt + 0.1, 0.25));
  return <Modal p={p} width={760} height={420}>
    <div style={{ padding: 24 }}>
      <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>导入岗位</p>
      <p style={{ margin: "6px 0 0", fontSize: 12.5, color: c.mute }}>粘贴招聘文字或截图，识别后核对保存</p>
      <div style={{ position: "absolute", left: 24, top: 82, width: 340, height: 270, borderRadius: 12, background: c.soft, padding: 14, fontSize: 12.5, lineHeight: "21px", color: c.text, whiteSpace: "pre-wrap" }}>
        {t < pasteAt ? <span style={{ color: c.faint }}>在这里粘贴岗位描述…</span> : <span style={{ opacity: ramp(t, pasteAt, 0.2) }}>{jd}</span>}
      </div>
      <div style={{ position: "absolute", left: 384, top: 82, width: 352, height: 270 }}>
        {t < parsedAt && t > pasteAt + 0.2 && <p style={{ margin: 0, fontSize: 13, color: c.blue, display: "flex", gap: 6, alignItems: "center" }}><Sparkles size={14} />{typed("正在识别岗位信息…", t, pasteAt + 0.2, 20)}</p>}
        {t >= parsedAt && <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>已识别 6 项</p>}
        {fields.map(([label, value], i) => <div key={label} style={{ display: "flex", height: 36, alignItems: "center", fontSize: 13.5, borderBottom: `1px solid ${c.line}`, ...fadeUp(t, parsedAt + 0.1 + i * 0.1, 6, 0.3) }}>
          <span style={{ width: 64, color: c.mute, fontSize: 12.5 }}>{label}</span>{value}
        </div>)}
      </div>
      <div style={{ position: "absolute", right: 24, bottom: 20, display: "flex", gap: 8, alignItems: "center", opacity: ramp(t, parsedAt + 0.6, 0.3) }}><span style={{ fontSize: 12, color: c.mute, marginRight: 8 }}>核对后保存</span><Button>取消</Button><Button primary>保存岗位</Button></div>
    </div>
  </Modal>;
}
