import { ArrowUp, Clock, Mic } from "lucide-react";
import { c, font } from "../app/theme";
import { fadeIn, fadeUp, mix, ramp, typed, typedDone, useT } from "../app/anim";
import { Button, Card, Modal, PageHeader, Tag } from "../app/ui";

export const MOCK = {
  question: "你主导的审批配置改版，是怎么验证效果的？",
  answer: "灰度期我们按企业随机分了两组，只有实验组用新配置路径，同期对照组完成率基本没变，所以 71% 到 86% 的提升主要来自改版……",
  followUp: "如果灰度期恰好赶上了季度培训，你怎么排除这个影响？",
};

/** 模拟面试作答页：主问题 → 逐字作答 → 追问出现。 */
export function MockSessionPage({ answerAt, followAt }: { answerAt: number; followAt: number }) {
  const t = useT();
  const seconds = 12 * 60 + 48 + Math.floor(t);
  return <>
    <div style={{ position: "absolute", left: 50, top: 36 }}>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>星河科技 · 高级产品经理</p>
      <p style={{ margin: "6px 0 0", fontSize: 12.5, color: c.mute }}>业务面 · 5 个考察点 · 中级难度 · 文字作答</p>
    </div>
    <div style={{ position: "absolute", right: 50, top: 40, display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ fontSize: 12.5, color: c.mute, display: "flex", gap: 5, alignItems: "center" }}><Clock size={13} />已用时 <b style={{ color: c.ink, fontVariantNumeric: "tabular-nums" }}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</b></span>
      <Button>放弃</Button><Button primary>结束并评估</Button>
    </div>
    <div style={{ position: "absolute", left: 50, right: 50, top: 104, height: 1, background: c.line }} />
    <div style={{ position: "absolute", left: 50, top: 122, display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: c.mute }}>
      作答进度 {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ width: 54, height: 5, borderRadius: 5, background: i < 2 ? c.blue : i === 2 ? "#9db5ec" : c.soft2 }} />)} 第 3 / 5 题
    </div>
    <div style={{ position: "absolute", left: 230, top: 180, width: 740 }}>
      <Tag>主问题</Tag>
      <p style={{ margin: "10px 0 0", fontSize: 19, fontWeight: 600, lineHeight: "30px" }}>{MOCK.question}</p>
      <div style={{ marginTop: 26, marginLeft: 120, padding: "14px 18px", borderRadius: 14, background: c.soft, fontSize: 14.5, lineHeight: "25px", minHeight: 54, ...fadeIn(t, answerAt - 0.2) }}>
        <p style={{ margin: "0 0 6px", fontSize: 12, color: c.mute }}>你的回答 · 语音输入</p>{typed(MOCK.answer, t, answerAt, 24)}
      </div>
      <div style={{ marginTop: 28, ...fadeUp(t, followAt, 14) }}>
        <Tag tone="blue">追问</Tag>
        <p style={{ margin: "10px 0 0", fontSize: 19, fontWeight: 600, lineHeight: "30px", padding: "6px 10px", marginLeft: -10, borderRadius: 8, background: `rgba(63,111,216,${0.08 * ramp(t, followAt + 0.8, 0.4)})` }}>{MOCK.followUp}</p>
      </div>
    </div>
    <div style={{ position: "absolute", left: 230, top: 760, width: 740, height: 82, borderRadius: 18, boxShadow: `inset 0 0 0 1px ${c.line2}` }}>
      <p style={{ position: "absolute", left: 18, top: 16, margin: 0, fontSize: 14, color: c.faint }}>输入你的回答…</p>
      <span style={{ position: "absolute", left: 16, bottom: 14, fontSize: 12, color: c.mute, display: "flex", gap: 6, alignItems: "center" }}><Mic size={14} />Enter 发送 · Shift + Enter 换行</span>
      <span style={{ position: "absolute", right: 12, bottom: 12, width: 34, height: 34, borderRadius: "50%", background: "#c7c7c3", color: "#fff", display: "grid", placeItems: "center" }}><ArrowUp size={15} /></span>
    </div>
  </>;
}

const abilities: [string, number, string][] = [["知识与原理", 4.2, c.green], ["方案与权衡", 4.0, c.green], ["项目主导与成果", 4.4, c.green], ["表达与沟通", 3.6, c.orange]];

/** 评估报告弹窗。 */
export function MockReportOverlay({ openAt }: { openAt: number }) {
  const t = useT();
  const p = ramp(t, openAt, 0.4);
  const score = Math.round(82 * ramp(t, openAt + 0.3, 0.9));
  return <Modal p={p} width={620} height={470}>
    <div style={{ padding: 28 }}>
      <div style={{ display: "flex", alignItems: "flex-end" }}>
        <div><p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>评估报告</p><p style={{ margin: "6px 0 0", fontSize: 12.5, color: c.mute }}>星河科技 · 业务面 · 5 题 · 2 次追问</p></div>
        <p style={{ margin: "0 0 0 auto", fontSize: 40, fontWeight: 600, lineHeight: "44px" }}>{score}<span style={{ fontSize: 14, color: c.faint, fontWeight: 400 }}> / 100</span></p>
      </div>
      <p style={{ margin: "22px 0 10px", fontSize: 13, fontWeight: 600 }}>能力项</p>
      {abilities.map(([name, v, color], i) => <div key={name} style={{ display: "flex", alignItems: "center", gap: 14, height: 34, fontSize: 13.5 }}>
        <span style={{ width: 120 }}>{name}</span>
        <span style={{ flex: 1, height: 8, borderRadius: 8, background: c.soft }}><span style={{ display: "block", height: 8, borderRadius: 8, background: color, width: `${(v / 5) * 100 * ramp(t, openAt + 0.5 + i * 0.12, 0.6)}%` }} /></span>
        <span style={{ width: 30, textAlign: "right", fontWeight: 600, color }}>{v.toFixed(1)}</span>
      </div>)}
      <div style={{ marginTop: 18, padding: 14, borderRadius: 12, background: c.greenSoft, fontSize: 13, lineHeight: "21px", ...fadeUp(t, openAt + 1.2, 8) }}><b style={{ color: c.green }}>亮点</b>　用实验组和对照组讲清了因果，论证完整。</div>
      <div style={{ marginTop: 10, padding: 14, borderRadius: 12, background: c.orangeSoft, fontSize: 13, lineHeight: "21px", ...fadeUp(t, openAt + 1.4, 8) }}><b style={{ color: c.orange }}>行动清单</b>　被追问外部干扰时回答偏慢，准备一句话的排除思路。</div>
    </div>
  </Modal>;
}

const axes = ["专业深度", "表达结构", "岗位匹配", "简历一致性", "沟通表现"];

function Radar({ values, highlight }: { values: number[]; highlight: number }) {
  const cx = 150, cy = 118, r = 74;
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return [cx + Math.cos(a) * r * (v / 5), cy + Math.sin(a) * r * (v / 5)];
  };
  const ring = (v: number) => axes.map((_, i) => pt(i, v).join(",")).join(" ");
  return <svg width="300" height="250" style={{ position: "absolute", left: 0, top: 30, overflow: "visible" }}>
    {[5, 3.75, 2.5].map((v) => <polygon key={v} points={ring(v)} fill="none" stroke="#e6e6e3" />)}
    <polygon points={values.map((v, i) => pt(i, v).join(",")).join(" ")} fill="#3f6fd822" stroke={c.blue} strokeWidth="1.6" />
    {values.map((v, i) => { const [x, y] = pt(i, v); return <circle key={i} cx={x} cy={y} r={i === 4 ? 4 : 3} fill={i === 4 ? (highlight > 0.5 ? c.green : c.orange) : c.blue} />; })}
    {axes.map((name, i) => {
      const [x, y] = pt(i, 6.4);
      const color = i === 4 ? (highlight > 0.5 ? c.green : c.orange) : c.mute;
      return <text key={name} x={x} y={y} textAnchor="middle" fontSize="11.5" fill={color} fontFamily={font.sans}>{name}<tspan x={x} dy="15" fontWeight="600" fill={i === 4 ? color : c.ink}>{values[i].toFixed(1)}</tspan></text>;
    })}
  </svg>;
}

/** 模拟面试首页：综合表现、得分趋势、能力雷达。at 之后新增本场成绩。 */
export function MockDashboardPage({ at }: { at: number }) {
  const t = useT();
  const p = ramp(t, at, 1.2);
  const avg = mix(78.6, 80.7, p);
  const comm = mix(3.0, 3.8, p);
  const pts = [[0, 79], [0.5, 79], [1, 84]] as const;
  const W = 470, H = 120;
  const y = (v: number) => H - ((v - 70) / 20) * H;
  const lineEnd = 0.5 + 0.5 * p;
  return <>
    <PageHeader eyebrow={`MOCK INTERVIEW · ${p > 0.5 ? 3 : 2} 场练习`} title="模拟面试" sub="按你在投的岗位组织练习，离面试越近越靠前。" actions={<><Button><Clock size={14} />练习记录 {p > 0.5 ? 3 : 2}</Button><Button>开始新面试</Button></>} />
    <Card style={{ left: 50, top: 172, width: 1100, height: 120 }}>
      <div style={{ position: "absolute", left: 24, top: 22, width: 86, height: 78, borderRadius: 10, boxShadow: `0 0 0 1px ${c.line}`, overflow: "hidden", textAlign: "center" }}>
        <div style={{ background: c.red, color: "#fff", fontSize: 11, lineHeight: "20px" }}>今天 周二</div>
        <div style={{ fontSize: 22, fontWeight: 600, lineHeight: "34px" }}>14:00</div>
        <div style={{ fontSize: 10.5, color: c.mute }}>● 5 小时后</div>
      </div>
      <p style={{ position: "absolute", left: 132, top: 24, margin: 0, fontSize: 16, fontWeight: 600, display: "flex", gap: 8, alignItems: "center" }}>星河科技 · 高级产品经理<Tag>业务二面</Tag></p>
      <p style={{ position: "absolute", left: 132, top: 56, margin: 0, fontSize: 13, color: c.mute }}>准备度 <b style={{ color: c.ink }}>{p > 0.5 ? 1 : 0} / 3</b> 题型已练</p>
      <div style={{ position: "absolute", left: 132, top: 82, display: "flex", gap: 8 }}><Tag tone={p > 0.5 ? "green" : "gray"}>业务面 {p > 0.5 ? "已练 82 分" : "还没练"}</Tag><Tag>项目深挖 还没练</Tag><Tag>综合面 还没练</Tag></div>
      <span style={{ position: "absolute", right: 24, top: 40 }}><Button primary>针对这场练一次</Button></span>
    </Card>
    <Card style={{ left: 50, top: 312, width: 1100, height: 300 }}>
      <div style={{ position: "absolute", left: 24, top: 22, width: 220 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>综合表现</p>
        <svg width="140" height="140" style={{ position: "absolute", left: 30, top: 40 }}><circle cx="70" cy="70" r="58" fill="none" stroke={c.soft2} strokeWidth="9" /><circle cx="70" cy="70" r="58" fill="none" stroke={c.blue} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(avg / 100) * 364} 364`} transform="rotate(-90 70 70)" /></svg>
        <p style={{ position: "absolute", left: 30, top: 82, width: 140, textAlign: "center", margin: 0, fontSize: 30, fontWeight: 600 }}>{avg.toFixed(1)}</p>
        <p style={{ position: "absolute", left: 30, top: 124, width: 140, textAlign: "center", margin: 0, fontSize: 12, color: c.mute }}>平均分</p>
        <div style={{ position: "absolute", left: 0, top: 200, width: 220, display: "flex", justifyContent: "space-around", textAlign: "center", fontSize: 12, color: c.mute }}>
          <span><b style={{ display: "block", fontSize: 18, color: c.ink }}>{p > 0.5 ? 3 : 2}</b>已完成</span><span><b style={{ display: "block", fontSize: 18, color: c.ink }}>0</b>已放弃</span><span><b style={{ display: "block", fontSize: 18, color: c.ink }}>{p > 0.5 ? "1.5h" : "1.1h"}</b>累计练习</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: 268, top: 22, width: 1, height: 256, background: c.line }} />
      <div style={{ position: "absolute", left: 292, top: 22, width: W }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, display: "flex", justifyContent: "space-between" }}>得分趋势<span>最近 {p > 0.5 ? 84 : 79}</span></p>
        <svg width={W} height={H + 40} style={{ position: "absolute", top: 70, overflow: "visible" }}>
          {[0, 0.5, 1].map((g) => <line key={g} x1="0" x2={W} y1={g * H} y2={g * H} stroke="#efefec" />)}
          <path d={`M0 ${y(79)} L${W * 0.5} ${y(79)} L${W * lineEnd} ${y(mix(79, 84, p))} L${W * lineEnd} ${H} L0 ${H} Z`} fill="#3f6fd812" />
          <polyline points={`0,${y(79)} ${W * 0.5},${y(79)} ${W * lineEnd},${y(mix(79, 84, p))}`} fill="none" stroke={c.blue} strokeWidth="2" />
          {pts.map(([x, v], i) => (i < 2 || p > 0.05) && <circle key={i} cx={W * (i === 2 ? lineEnd : x)} cy={y(i === 2 ? mix(79, 84, p) : v)} r={i === 2 ? 5 : 4} fill={i === 2 ? c.blue : "#fff"} stroke={c.blue} strokeWidth="2" />)}
          {p > 0.9 && <text x={W - 4} y={y(84) - 12} textAnchor="end" fontSize="13" fontWeight="600" fill={c.blue}>84</text>}
          {["09-30", "10-04", "10-10"].map((d, i) => <text key={d} x={W * i * 0.5} y={H + 26} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize="11.5" fill={c.mute}>{d}</text>)}
        </svg>
      </div>
      <div style={{ position: "absolute", left: 790, top: 22, width: 1, height: 256, background: c.line }} />
      <div style={{ position: "absolute", left: 812, top: 22, width: 270, height: 260 }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>能力雷达
          {p < 0.5 ? <Tag tone="orange">待加强 · 沟通表现</Tag> : <Tag tone="green">沟通表现 +0.8</Tag>}</p>
        <Radar values={[4.0, 4.0, 4.0, 5.0, comm]} highlight={p} />
      </div>
    </Card>
    <p style={{ position: "absolute", left: 50, top: 640, margin: 0, fontSize: 15, fontWeight: 600 }}>其他在投岗位</p>
    {["青舟数据 · 增长产品经理", "澄海科技 · B 端产品经理", "云帆互联 · 产品经理"].map((name, i) => <Card key={name} style={{ left: 50 + i * 374, top: 676, width: 352, height: 150, padding: 18 }}>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{name}</p>
      <p style={{ margin: "10px 0 0", fontSize: 12.5, color: c.mute }}>● {["10-06 业务一面", "10-07 业务一面", "10-08 在线笔试"][i]}</p>
      <span style={{ position: "absolute", left: 18, bottom: 16 }}><Button>针对这个岗位练习</Button></span>
    </Card>)}
  </>;
}
