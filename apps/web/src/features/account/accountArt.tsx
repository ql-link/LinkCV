import { t, useLocale } from "@/i18n";
import { Badge, Bar, Centered, DashArrow, MiniResume, Paper } from "../../v3/art";
import { Icon } from "../../v3/Icon";

// 08.4 账号弹窗里的插图，坐标照 Figma 各弹窗的 Stage 节点（单位 px，放在 .v3-stage 里）

// 头像小圆：黑底白字，插图里代表「我的账号」
function MiniAvatar({ x, y, size, initial }: { x: number; y: number; size: number; initial: string }) {
  useLocale();
  return (
    <span
      aria-hidden="true"
      style={{ position: "absolute", left: x, top: y, display: "grid", width: size, height: size, placeItems: "center", borderRadius: size / 2, background: "var(--v3-dark)", color: "#fff", fontSize: size * 0.4, fontWeight: 500 }}
    >
      {initial}
    </span>
  );
}

// 6 个圆点表示密码
function PasswordDots({ x, y, dark }: { x: number; y: number; dark: boolean }) {
  useLocale();
  return (
    <Paper x={x} y={y} w={124} h={48} style={dark ? undefined : { opacity: 0.8 }}>
      <Icon name="lock" size={14} style={{ position: "absolute", left: 12, top: 16, color: "var(--v3-fnt)" }} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} style={{ position: "absolute", left: 36 + i * 12, top: 20, width: 6, height: 6, borderRadius: 3, background: dark ? "var(--v3-dark)" : "var(--v3-sk2)" }} />
      ))}
    </Paper>
  );
}

/* 08.4c 修改密码：旧密码 → 新密码 + 绿色对勾（舞台 456×96） */
export function ChangePasswordArt() {
  useLocale();
  return (
    <Centered width={456} height={96}>
      <PasswordDots x={52} y={24} dark={false} />
      <DashArrow x={188} y={41} w={72} />
      <PasswordDots x={280} y={24} dark />
      <Badge x={392} y={14} icon="check" fill="var(--v3-gn)" />
    </Centered>
  );
}

/* 08.4b 修改登录邮箱：当前邮箱卡 → 信封里露出 6 位验证码（舞台 456×120） */
export function ChangeEmailArt({ email }: { email: string }) {
  useLocale();
  return (
    <Centered width={456} height={120}>
      <Paper x={45} y={50} w={150} h={44} r={10}>
        <span style={{ position: "absolute", left: 10, top: 10, display: "grid", width: 24, height: 24, placeItems: "center", borderRadius: 12, background: "var(--v3-field)", color: "var(--v3-sub)" }}>
          <Icon name="mail" size={12} />
        </span>
        <span style={{ position: "absolute", left: 42, top: 8, color: "var(--v3-fnt)", fontSize: 9 }}>{t("当前邮箱")}</span>
        <span style={{ position: "absolute", left: 42, top: 21, maxWidth: 100, overflow: "hidden", color: "var(--v3-sub)", fontFamily: "var(--v3-num)", fontSize: 10.5, textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</span>
      </Paper>
      <DashArrow x={211} y={65} w={58} />
      {/* 信封底 → 信纸 → 信封口袋，层叠顺序与设计稿一致 */}
      <Paper x={291} y={40} w={120} h={64} r={7} shadow={false} style={{ background: "#f1f1ee" }} />
      <Paper x={303} y={16} w={96} h={52} r={6}>
        {["4", "8", "2", "9", "1", "3"].map((digit, i) => (
          <span key={i} style={{ position: "absolute", left: 5 + i * 15, top: 10, display: "grid", width: 12, height: 16, placeItems: "center", borderRadius: 3, background: "var(--v3-field)", fontFamily: "var(--v3-num)", fontSize: 10, fontWeight: 600 }}>{digit}</span>
        ))}
        <Bar x={18} y={34} w={60} h={3} r={1.5} color="var(--v3-line)" />
      </Paper>
      <svg aria-hidden="true" style={{ position: "absolute", left: 291, top: 66 }} width={120} height={38} viewBox="0 0 120 38" fill="none">
        <path d="M0.5 0.5L60 26L119.5 0.5V31a6.5 6.5 0 0 1-6.5 6.5H7A6.5 6.5 0 0 1 .5 31z" fill="#fff" stroke="#e4e4e0" />
      </svg>
      <Badge x={395} y={30} icon="check" fill="var(--v3-gn)" />
    </Centered>
  );
}

/* 08.4e 解绑微信：账号卡与微信之间的虚线被红 × 断开（舞台 372×128） */
export function UnbindWechatArt({ initial }: { initial: string }) {
  useLocale();
  return (
    <Centered width={372} height={128}>
      <Paper x={64} y={38} w={100} h={52}>
        <MiniAvatar x={12} y={14} size={24} initial={initial} />
        <Bar x={44} y={18} w={42} h={5} r={2} color="var(--v3-dark)" />
        <Bar x={44} y={29} w={28} h={4} r={2} color="var(--v3-sk2)" />
      </Paper>
      <svg aria-hidden="true" style={{ position: "absolute", left: 164, top: 60 }} width={80} height={8} viewBox="0 0 80 8" fill="none">
        <path d="M2 4h76" stroke="#b9b9b3" strokeWidth="1.4" strokeDasharray="3 3" />
      </svg>
      <Paper x={244} y={34} w={64} h={60}>
        <span style={{ position: "absolute", left: 16, top: 14, display: "grid", width: 32, height: 32, placeItems: "center", borderRadius: 8, background: "var(--v3-gn-soft)", color: "var(--v3-gn)" }}>
          <Icon name="chat" size={18} />
        </span>
      </Paper>
      <span aria-hidden="true" style={{ position: "absolute", left: 193, top: 53, display: "grid", width: 22, height: 22, placeItems: "center", border: "1px solid #f1d4d4", borderRadius: 11, background: "var(--v3-rd-soft)", color: "var(--v3-rd)", fontSize: 14, fontWeight: 500, boxShadow: "0 2px 6px rgb(0 0 0 / 10%)" }}>×</span>
    </Centered>
  );
}

/* 08.4h 退出登录：当前电脑带退出角标，手机淡掉表示不受影响（舞台 372×128） */
export function LogoutArt({ initial }: { initial: string }) {
  useLocale();
  return (
    <Centered width={372} height={128}>
      <Paper x={112} y={22} w={136} h={86} r={8}>
        <Bar x={0} y={0} w={136} h={16} r={0} color="var(--v3-field)" />
        {[8, 17, 26].map((left) => <Bar key={left} x={left} y={5} w={6} h={6} r={3} color="var(--v3-sk2)" />)}
        <MiniAvatar x={14} y={30} size={20} initial={initial} />
        <Bar x={42} y={33} w={52} h={5} r={2} color="var(--v3-dark)" />
        <Bar x={42} y={43} w={34} h={4} r={2} color="var(--v3-sk2)" />
        <Bar x={14} y={62} w={108} h={4} r={2} />
        <Bar x={14} y={72} w={80} h={4} r={2} />
      </Paper>
      <Badge x={236} y={90} icon="logout" />
      <Paper x={272} y={34} w={40} h={70} r={8} shadow={false} style={{ opacity: 0.45 }}>
        <Bar x={14} y={6} w={12} h={3} r={2} color="var(--v3-sk2)" />
        <MiniAvatar x={12} y={20} size={16} initial={initial} />
        <Bar x={8} y={44} w={24} h={3} r={2} />
        <Bar x={8} y={52} w={18} h={3} r={2} />
      </Paper>
    </Centered>
  );
}

/* 08.4i 注销账号：账号卡带红色垃圾桶，两侧淡掉的简历和资料夹（舞台 416×104） */
export function DeleteAccountArt({ initial }: { initial: string }) {
  useLocale();
  return (
    <Centered width={416} height={104}>
      <MiniResume x={82} y={24} w={44} h={58} rotate={-8} style={{ opacity: 0.45 }} />
      <Paper x={294} y={30} w={56} h={46} style={{ opacity: 0.45 }}>
        <Icon name="folder" size={22} style={{ position: "absolute", left: 17, top: 12, color: "var(--v3-fnt)" }} />
      </Paper>
      <Paper x={148} y={26} w={120} h={54}>
        <MiniAvatar x={12} y={15} size={24} initial={initial} />
        <Bar x={44} y={19} w={48} h={5} r={2} color="var(--v3-dark)" />
        <Bar x={44} y={30} w={32} h={4} r={2} color="var(--v3-sk2)" />
      </Paper>
      <Badge x={252} y={62} size={28} icon="trash" fill="var(--v3-rd-soft)" color="var(--v3-rd)" border="#f1d4d4" />
    </Centered>
  );
}

/* 08.4g 编辑个人画像横幅：画像卡 → 虚线箭头 → 三份简历 → 「所有简历共用」（舞台 656×104） */
export function ProfileBannerArt({ empty }: { empty: boolean }) {
  useLocale();
  const slots = empty ? ["城市", "薪资", "学历"] : ["北京", "25–35K", "硕士"];
  return (
    <Centered width={656} height={104}>
      <Paper x={78} y={19} w={164} h={66}>
        <Bar x={12} y={12} w={22} h={22} r={11} color={empty ? "var(--v3-sk)" : "var(--v3-sk2)"} />
        <Bar x={42} y={14} w={60} h={6} r={2} color={empty ? "var(--v3-sk2)" : "var(--v3-dark)"} />
        <Bar x={42} y={25} w={40} h={4} r={2} color="var(--v3-sk2)" />
        {slots.map((text, i) => (
          <span
            key={text}
            style={{ position: "absolute", left: 12 + i * 48, top: 40, display: "grid", width: 44, height: 18, placeItems: "center", border: empty ? "1px dashed var(--v3-sk2)" : undefined, borderRadius: 4, background: empty ? undefined : "var(--v3-field)", color: empty ? "var(--v3-fnt)" : "var(--v3-sub)", fontSize: 8.5, fontWeight: 500 }}
          >
            {text}
          </span>
        ))}
      </Paper>
      <DashArrow x={254} y={45} w={56} />
      <MiniResume x={324} y={22} w={44} h={58} rotate={-8} accent="var(--v3-sub)" style={{ opacity: 0.85 }} />
      <MiniResume x={392} y={22} w={44} h={58} rotate={8} accent="var(--v3-sub)" style={{ opacity: 0.85 }} />
      <MiniResume x={358} y={22} w={44} h={58} />
      <span style={{ position: "absolute", left: 460, top: 42, display: "inline-flex", height: 20, alignItems: "center", border: "1px solid var(--v3-cl)", borderRadius: 10, background: "#fff", padding: "0 10px", color: "var(--v3-sub)", fontSize: 9.5, fontWeight: 500, whiteSpace: "nowrap" }}>
        {empty ? t("填写后所有简历共用") : t("所有简历共用 · 不改简历内容")}
      </span>
    </Centered>
  );
}

/* 08.4d 绑定微信的示例二维码：21×21 模块 + 三个定位角 + 中间品牌角标。
   绑定接口线上不可用，这里只画固定图案，不能真的扫码。 */
export function DemoQr({ size, seed }: { size: number; seed: string }) {
  useLocale();
  const n = 21;
  const cell = size / n;
  let state = [...seed].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const inFinder = (r: number, c: number) => (r < 8 && c < 8) || (r < 8 && c >= n - 8) || (r >= n - 8 && c < 8);
  const inMark = (r: number, c: number) => r >= 8 && r <= 12 && c >= 8 && c <= 12;
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (!inFinder(r, c) && !inMark(r, c) && rand() > 0.55) cells.push([r, c]);
    }
  }
  const finder = (r: number, c: number) => (
    <g key={`${r}-${c}`}>
      <rect x={c * cell + cell / 2} y={r * cell + cell / 2} width={cell * 6} height={cell * 6} fill="none" stroke="#1d1d1b" strokeWidth={cell} />
      <rect x={(c + 2) * cell} y={(r + 2) * cell} width={cell * 3} height={cell * 3} fill="#1d1d1b" />
    </g>
  );
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {cells.map(([r, c]) => <rect key={`${r}:${c}`} x={c * cell} y={r * cell} width={cell} height={cell} fill="#1d1d1b" />)}
      {finder(0, 0)}
      {finder(0, n - 7)}
      {finder(n - 7, 0)}
      <rect x={size / 2 - 20} y={size / 2 - 20} width={40} height={40} rx={8} fill="#fff" stroke="#e4e4e0" />
      <text x={size / 2} y={size / 2 + 5.5} textAnchor="middle" fontFamily="var(--v3-num)" fontSize={15} fontWeight={700} fill="#1d1d1b">L</text>
    </svg>
  );
}
