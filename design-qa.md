# Design QA

## Evidence

- Source visual truth: 用户提供的 `LinkCV 2.zip` 中 `design_handoff_resume_editor/design_files/ui_kits/resume-workbench/Workbench.jsx`。
- Implementation: 本地 `http://127.0.0.1:4173/`。
- Comparison: 在相同桌面视口下分别核对完整工作台与 A4 纸张区域；截图仅作为本地人工验收证据，不进入仓库。
- Intended viewport: desktop `1440 × 820` CSS px，device density `1`。
- Captures: source runtime `1253 × 705` px；implementation `1440 × 820` px。全视图按相同比例缩放比较；纸张聚焦比较按各自可见 A4 边界裁切后归一化，不据此判断字体的绝对像素大小。
- State: 已登录、已打开“我的第一份简历”、无抽屉或弹层、头像未选中。

## Findings

没有剩余 P0/P1/P2 问题。

- 字体与排版：UI 使用 system-ui；简历使用项目既有中文衬线栈。标题字号、字重、紧凑行高和正文松弛度与 handoff 一致。默认示例中的学校/日期和公司/职位使用可编辑的结构化左右行，不依赖空格模拟对齐。
- 间距与布局：56px 玻璃导航、48px 工具栏、210mm A4 纸张、36px 顶部画布间距和 340px 并行抽屉均对齐 handoff。首次比较发现编辑内容被旧预览样式重复添加页边距，已修复为只由纸张容器负责边距。
- 色彩与材质：画布、纸张、hairline、半透明导航/弹层、阴影、选区色和保存成功色均映射到 handoff token。并行抽屉没有暗色蒙层。
- 图片与图标：头像占位资产来自用户提供的 handoff；控制图标使用项目现有 Lucide，不使用字符或 CSS 绘制替代。正文图片支持 Pointer Events 1:1 拖动调宽、百分比/像素精确宽度、左中右对齐、替换和替代文字；最小宽度由当前正文计算行高决定。头像区支持独立上传、替换、替代文字与 56–220px 精确尺寸。
- 左右布局：普通段落可原位转换为结构化 `resumeRow`，左右两栏分别编辑，左栏比例可在 30%–80% 间精确设置，并可无损恢复为普通段落。旧 Markdown 左右块会在载入时迁移为同一节点。
- 文案：工具栏、保存状态、设置、版本、恢复和导出文案与 handoff 一致。

## Interaction Evidence

- 浏览器内验证了登录后打开简历、A4 直接编辑表面、页面设置抽屉开关、全局字号即时变化、当前行转左右布局、58% 左栏比例，以及自动保存从“编辑中”回到“已保存”。
- Tiptap 工具栏包含撤销/重做、段落/标题、粗斜体/下划线、颜色/高亮、对齐、列表、链接、图片、行内图标和字号。
- 浏览器控制台 error/warning：0。
- 前端版本记录使用 IndexedDB 按简历持久化，刷新与切换后可重新读取；主动离开编辑页前会先提交未保存内容。
- 标准 PDF 导出按 A4 高度切片长内容，不再用固定 297mm 高度裁掉末尾；编辑态图片控件不会进入导出克隆。
- TypeScript、Vitest 和生产构建均通过。

## Comparison History

1. 初次全视图比较发现 P1：纸张容器与旧 `.resume-content` 同时应用 16mm 页边距，导致正文过窄。
2. 修复：在 workbench 作用域内将 `.resume-content` padding 归零，并把段落样式选择器宽度恢复到 handoff 的 150px 密度。
3. 修复后重新核对完整工作台；正文宽度、标题层级、头像锚点和分隔线节奏与 handoff 对齐，无剩余 P0/P1/P2。

## Follow-up Polish

- P3：本轮不增加任意坐标图片、图片裁剪器、复杂表格和多栏嵌套；这些能力会显著提高简历布局失控与 PDF 不一致的风险。当前采用预设位置、可控尺寸和单层左右布局。
- 浏览器自动化环境未注入真实本地图片文件；上传后的尺寸、替代文字、校验和错误态由组件实现与类型/单元测试覆盖，仍建议发布前用一张横图和一张竖图各做一次人工文件选择验收。

final result: passed

## 全部简历折叠搜索框 — 2026-08-21

### Visual truth and evidence

- Source visual truth: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-daf6a511-bbdc-4902-abd4-6a9fe1656d23.png`（收起态，`235 × 136` px）与 `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-27d63f44-3a4c-4683-a67f-beba833de2f9.png`（展开态，`584 × 151` px）。
- Implementation screenshots: `/private/tmp/linkcv-resumes-search-collapsed-desktop.png` 与 `/private/tmp/linkcv-resumes-search-expanded-desktop.png`（浏览器视口请求 `1440 × 900` CSS px，实际内容截图 `1309 × 818` px），以及 `/private/tmp/linkcv-resumes-search-expanded-mobile-fixed.png`（视口请求 `390 × 844` CSS px，实际内容截图 `354 × 767` px）。浏览器密度为 1；未把浏览器外框计入比较。
- State: 已登录的 `/resumes`，浅色工作区；分别比较默认收起态、点击后聚焦的展开态，以及移动端展开态。
- Full-view comparison: 桌面完整页面核对搜索框与“导入简历 / 新建简历”的相对位置、操作层级和展开后的工具栏密度；移动端完整页面核对展开时无水平溢出且两个操作按钮保持可见。
- Focused-region comparison: 在同一次视觉比较中并列打开两张来源图与 `/private/tmp/linkcv-search-collapsed-crop.jpg`、`/private/tmp/linkcv-search-expanded-crop.jpg`，核对圆形轮廓、胶囊比例、左右图标、占位文案和边框。实现裁切保留了少量相邻按钮，用于确认真实工具栏间距。

### Required fidelity surfaces

- Fonts and typography: 输入与占位文字使用 LinkCV 的 `--ui-font-sans`、14px 控件字号；视觉权重和参考图一致，中文占位文案改为任务明确的“搜索简历…”。
- Spacing and layout rhythm: 收起态为 `44 × 44` 圆形；桌面展开为 `280 × 44` 胶囊，左右各保留 42px 图标区。尺寸略小于独立参考画布，以对齐现有工作区 40–44px 工具栏密度。移动端展开后独占一行，关闭后恢复紧凑操作行。
- Colors and tokens: 白色表面、细灰边框、近黑图标与弱化占位文字全部映射既有 `--ui-*` Token；展开态输入焦点只加深胶囊自身边框，不叠加全局蓝色外轮廓。收起按钮与关闭按钮继续保留键盘 `focus-visible` 提示。
- Image and asset fidelity: 视觉只包含标准搜索与关闭图标，使用项目已配置的 Lucide 图标库；没有缺失的位图、品牌资产或用 CSS/字符伪造图标。
- Copy and content: 收起按钮、输入框和搜索区域都以“搜索简历”命名；关闭按钮明确命名为“清除并收起搜索”，关闭后同时恢复全部简历。

### Interaction evidence

- 圆形按钮点击后展开并自动聚焦输入框；输入关键词继续复用原有前端筛选逻辑。
- 右侧关闭按钮与 Escape 都会清空关键词、收起控件并把焦点还给圆形按钮。
- 桌面、小桌面与移动端均检查；浏览器控制台没有 error 或 warning。

### Comparison history

1. 初次移动端比较发现 P2：展开搜索与两个页面操作争抢同一行，右侧操作可能被挤出视口。
2. 修复：只在“全部简历”页面的移动端把标题与操作区改为上下布局；展开搜索独占一行，导入和新建按钮移到下一行，其他工作区页面不受影响。
3. 修复后重新捕获 `/private/tmp/linkcv-resumes-search-expanded-mobile-fixed.png`；搜索框、导入和新建操作均完整可见，页面无水平溢出。没有剩余 P0/P1/P2 问题。
4. 用户复查发现 P1：展开态同时命中组件 `:focus-within` 与项目全局 `input:focus-visible`，形成蓝色双层外框和输入区矩形边界。修复后输入框通过独立 `data-slot` 隔离全局轮廓，组件不再绘制外圈；实时浏览器计算样式确认输入与容器 `outline-style: none`，并把关闭按钮 hover 区域收敛为 `32 × 32` 圆形。

### Follow-up polish

- P3: none.

final result: passed

## 全部简历操作区精简 — 2026-08-21

### Visual truth and evidence

- Source visual truth: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-99d26f5f-0378-4d16-8de1-b69ac13353ec.png`，红框标出需要移除的“全部 1”筛选胶囊与需要改造的“新建简历”按钮；同一行右侧“最近更新”描述按用户文字要求一并移除。
- Implementation screenshots: `/private/tmp/linkcv-resumes-action-cleanup-final.png`（桌面悬浮态）、`/private/tmp/linkcv-resumes-create-button-desktop.png`（桌面默认态）与 `/private/tmp/linkcv-resumes-create-button-mobile.png`（移动端）。
- Full-view comparison: 在同一次视觉比较中并列打开来源截图与最终桌面实现，核对筛选行已完整移除、卡片网格自然上移，以及搜索、导入、新建三个操作保持对齐。

### Required fidelity surfaces

- Information hierarchy: 删除无实际筛选能力的“全部 N”胶囊、重复的“最近更新”行内说明、标题下方数量/排序摘要，以及卡片区底部的分享操作提示；页面只保留标题、操作区和简历内容。
- Button treatment: “新建简历”从黑色实心主按钮改为共享 `outline` 透明圆弧按钮，复用从边框中部向两侧展开的蓝色悬浮描边；点击行为不变。
- Responsive: 桌面操作区保持单行；移动端三项操作完整可见，页面内容宽度与视口一致，无水平溢出。
- Accessibility: “新建简历”继续暴露原有按钮名称，透明样式不改变键盘焦点反馈与业务动作。

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none.

### Follow-up

- 用户进一步要求移除“1 份简历 · 按最近更新排列”和“提示：点击简历卡片可继续编辑，分享按钮只管理当前简历的公开链接。”，实现已同步删除对应 DOM 与不再使用的提示样式。
- Follow-up screenshot: `/private/tmp/linkcv-resumes-copy-cleanup-final.png`；浏览器正文核对两段目标文字均不存在，标题与操作区之间未留下额外占位。

final result: passed

## 透明圆弧次要按钮 — 2026-08-21

### Visual truth and evidence

- Source visual truth: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-99fcb496-9803-4556-bf2c-af2a76264ee7.png`（透明默认态）与 `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-daacce61-8938-4e15-ad66-508cd4339108.png`（蓝色描边悬浮态）。
- Implementation state: 已登录 `/resumes` 的“导入简历”次要按钮；在同一次视觉比较中分别并列打开默认态参考与默认态页面、悬浮态参考与悬浮态页面。
- Responsive evidence: 浏览器请求 `1440`、`1024` 与 `390` 宽度；移动端搜索、导入与新建按钮均完整可见，没有横向溢出。

### Required fidelity surfaces

- Shape and material: `outline`、`secondary` 与带文字的 `ghost` 使用透明背景、完整圆弧和单层灰色细边框；主操作、危险操作、纯图标按钮与导航控件不套用。
- Hover and focus: 两个半边框从按钮中部向右、向左分别以 `scaleX` 展开，最终形成完整 LinkCV 蓝色描边与低强度柔光；键盘 `focus-visible` 与打开态使用相同最终反馈。
- Motion: 描边只动画 `transform` 与 `opacity`，时长使用现有 `--ui-duration-base`；`prefers-reduced-motion` 将时长降至 `0.01ms`，不依赖动画完成业务动作。
- Content and icons: 保留各业务按钮原有文字和项目既有图标，不强制添加参考图中的 `>` 符号，也不改变点击行为。

### Comparison history

1. 第一轮实现后发现 P2：Tailwind `border` 被较晚加载的全局 `button { border: 0 }` 覆盖，默认态只剩透明背景而没有可辨识的圆弧边界。
2. 修复：共享组件自身声明 `border: 1px solid var(--ui-border-strong)`；1024 与 390 浏览器复查均恢复默认灰色边框。
3. 按最新版 Vercel Web Interface Guidelines 复查后，把初版 `clip-path` 描边改为两个半边框的 `transform: scaleX`，保留从中心向两侧扩展的视觉意图并降低动画成本。

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: 工作台“导出 PDF”这类带文字的次要按钮同步使用圆弧样式；返回、设置、历史记录等纯图标工具仍保持紧凑形状，未发现工具栏溢出。

final result: passed

## 经典单页技术简历示例内容重编 — 2026-08-21

### Verification state

- Environment: `fix/classic-technical-fictional-content`，本机隔离 SQLite 后端与 Vite 前端，应用内浏览器桌面视口。
- Template picker: “经典单页技术简历”仍为独立选项，预览完整显示虚构的张三资料。
- Content independence: 技能改为 Go、TypeScript、云原生、可观测性和工程质量；三段实习分别为气象观测、协作绘图和城市照明运维；个人项目改为可观测性实验台 TraceHarbor。预览中未出现旧示例的销售预测、知识检索、AI 编程工具、JMM、Qdrant、公司名或项目名。
- Editor: 从模板创建“经典模板内容验收”后进入编辑器，页面节点包含 `theme-classic-technical smart-one-page`，保存状态为“已保存”。
- Single page: 编辑纸张 `clientHeight=1123`、`scrollHeight=1123`，正文末尾完整显示，没有内部溢出或截断。
- Console: 浏览器 console 中没有 warning 或 error。

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: 这次只重编模板种子，已经从旧模板创建的简历仍保留各自快照，不会被迁移追溯覆盖。

final result: passed

## 经典单页技术简历模板 — 2026-08-21

### Visual truth

- Source: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-c1ac7690-f3aa-4dc6-be6c-f8322563511d.png`。
- Implementation: `/tmp/linkcv-classic-technical-viewport-v5.png`。
- Side-by-side comparison: `/tmp/linkcv-classic-technical-comparison.svg.png`。
- State: 使用虚构“张三”内容创建简历后进入真实编辑器，保存状态为“已保存”，主题为 `classic-technical`，智能一页开启。
- Source capture: `1000 × 1414` px；implementation viewport: `1280 × 1400` CSS px / PNG px，DPR 1；A4 paper: `793.69 × 1122.52` CSS px。

### Required fidelity surfaces

- Typography: 中文衬线栈、居中姓名与联系方式、非粗体标题层级、紧凑正文和编号列表与参考图一致；显式 Markdown 粗体仍使用较轻的 600 权重。
- Spacing and layout: 9mm 上下、11mm 左右页边距，细分隔线与密集段落节奏保持单页；教育、公司/岗位日期和项目链接使用结构化左右栏，不依赖空格对齐。
- Content: 模板选择器新增独立“经典单页技术简历”选项，保留已有模板；默认内容全部为虚构样例，不包含用户姓名、电话、邮箱、学校、公司或项目数据。
- Rendering parity: 模板选择页只读预览、编辑器和 PDF 共用同一主题键与 `pt` 字号语义；右侧岗位/日期为正常字形、右对齐且不换行。

### Comparison history

1. [P1] 首次真实页面截图中，左右行沿用通用 70% 左栏，岗位与日期发生换行。模板主题覆盖为 57% 左栏，并保持右栏单行；复核后右栏可用宽度 294px，最长内容 293px。
2. [P2] 模板选择页只读预览把字号值解释为 `px`，与编辑器/PDF 的 `pt` 不一致。已统一为 `pt`。
3. 最终 A4 高度 `1122.52px`、内容 `scrollHeight=1123px`，完整内容保持在单页；标题字重为 400，右栏字形为 normal、字重 400。
4. 浏览器控制台 error/warning：0；模板选择、创建简历、进入编辑器和自动保存链路均完成。

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: 参考图包含真实企业/学校图标；为避免把用户个人资产和经历固化进默认模板，本模板保留纯文字结构，用户仍可在编辑器内按需插入图片或行内图标。

final result: passed

## LinkCV Design System

- 登录、主页、编辑器与预览工作区统一使用 LinkCV 的黑白中性色、品牌标记、排版、间距、圆角、阴影与交互状态。
- 编辑器和预览工具栏保留原有命令、分页、保存、源码与导出入口，并在窄屏下保持可滚动和可操作。
- 简历纸张的 Markdown 渲染、主题变量、显式粗体和打印行为未被应用壳样式污染。

## Landing 与 Home Handoff

- Landing 在桌面视口下核对了 sticky 导航、Hero、Markdown/A4 叠放视觉、步骤、功能卡片和 Footer。
- Home 在桌面视口下核对了固定侧边栏、Header、搜索、模板、简历卡片、空状态和延迟删除 Toast。
- Landing 与 Home 均在 640 × 900 窄屏视口下检查，核心操作可达且没有遮挡内容的页面级水平溢出。
- 真实浏览器完成访客、注册、创建、编辑器返回、模板、删除与退出流程；详细步骤见 `.specs/LCV-LANDING-HOME-HANDOFF/manual_acceptance.md`。

## 品牌一致性

- 登录页、Landing 顶栏与 Footer、Home 侧边栏复用同一个 `Brand` 组件和同一份矢量品牌资产。
- 品牌标记保持 32px 深色圆角方形、白色 LinkCV 符号、9px 图文间距和“LinkCV”字标。
- 浏览器标签名称为“LinkCV”，favicon 使用同款深色圆角品牌标记。

## 结论

- 未发现内容裁切、错误间距、错误边框、不可达主要操作或品牌资产不一致。
- 浏览器控制台无错误；自动化测试、类型检查和生产构建结果以实际命令输出与 PR 验证摘要为准。

## Admin module on dev — 2026-07-27

final result: passed

- Reference: current `dev` design tokens and shared `Brand` component, plus the supplied Apple Fluid Interface brief.
- The admin module now lives under `apps/web` and routes through the current dev router.
- Visual tokens use dev's grayscale surfaces, system font stack, radii, shadows, dark-mode variables, and LinkCV brand mark.
- Admin-owned motion uses Motion springs and only animates transform or opacity; its CSS contains no transitions or keyframes.
- Reduced motion, reduced transparency, and increased contrast have explicit fallbacks.
- Mock login, direct admin routes, section navigation, and model drawer pass component tests.
- Production build and direct HTTP checks for `/admin` and `/admin/users` pass.
- The admin login was visually rechecked after replacing the promotional full-screen split with a focused, glass-backed access workspace. Desktop and 390 × 844 mobile views have no clipping or horizontal overflow.
- The mock credential fill and direct sign-in flow were exercised in the browser; `/admin/llm/models` retained its addressed destination after login and the browser console reported no warnings or errors.

# Design QA — 首页环绕简历 Hero

## Visual truth

- Source: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-minimax-reference-1280x720.png`
- Implementation: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-landing-implementation-1280x720.png`
- Full comparison: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-design-comparison.png`
- State: public landing page, light theme, initial viewport
- Source viewport: 1280 × 720 CSS px, DPR 1
- Implementation viewport: 1280 × 720 CSS px, DPR 1
- Comparison image: 2560 × 764 px

## Comparison history

1. Initial implementation placed the centered copy too far right because Motion's inline `transform` replaced the CSS centering transform. The copy now uses the independent `translate` property.
2. The first scroll mapping completed too early for the actual scroll container. The progress offsets now use `start start` → `end end`, so the orbit, featured resume and copy leave together before the next section.
3. Motion reported a static scroll container. `.marketing-landing` now has `position: relative`; no new warning was emitted after reload.

## Findings

- P0: none.
- P1: none.
- P2: none.
- Deliberate adaptation: the source site's media cards are replaced by fictitious resume sheets, and its download actions are replaced by LinkCV's single resume-creation CTA. The centered hierarchy, elliptical perimeter, negative space and scroll exit behavior are preserved.

## Responsive and interaction checks

- 390 × 844: no horizontal overflow; headline, CTA, orbit cards and featured resume remain readable.
- Scroll transition: orbit, copy and featured resume rotate/scale/fade out before the following content enters.
- Primary CTA: `开始创建简历` routes to `/login?mode=register`.
- Reduced motion: continuous orbit/cue animation and timed featured-card switching are disabled by the implementation.

Final result: passed

## 首页环绕简历 Hero 修订 — 2026-08-10

### Visual truth

- Source: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-minimax-reference-1280x720.png`，并以用户本轮明确反馈“黑白、文字真正居中、消除滚动空白”为更高优先级修订依据。
- Implementation: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-landing-blackwhite-1280x720.png`。
- Full comparison: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-blackwhite-comparison.png`。
- Transition evidence: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-landing-transition-1280x720.png`。
- Mobile evidence: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-landing-blackwhite-mobile-390x844.png`。
- State: public landing page, light theme, initial and transition scroll states.
- Desktop: source and implementation均为 1280 × 720 CSS px / PNG px，DPR 1；comparison为 2560 × 764 px。
- Mobile: 390 × 844 CSS px / PNG px，DPR 1。
- Focused region comparison was not needed: the centered headline, resume cards and bridge copy are legible in the full-size captures, and the transition has its own full-viewport evidence.

### Required fidelity surfaces

- Typography: 首屏标题与辅助文案保留参考构图的紧凑大标题层级；文字块的实际边界为 `x=290..990`、`y=198.56..509.02`，中心点与 1280 × 720 视口中心基本重合。
- Spacing and layout: 文案由上半屏移动到视觉中心；Hero缩短为 145vh，下一段黑色桥接面板提前 18vh 上推，避免sticky尾段空白。
- Colors: Hero、标题、简历强调线、头像和按钮统一为黑、白、灰；移除紫、橙、绿、金色强调。
- Image/asset quality: 本屏使用真实排版组件生成的简历预览，不依赖缺失的图片资产；卡片在桌面和移动端保持清晰、无水平溢出。
- Copy: 中心产品文案保持简短；桥接页新增“一份简历，只是开始”，用于承接下一段工作台内容。

### Comparison history

1. [P1] 用户指出彩色强调与期望的黑白方向不一致。修复后所有Hero强调色统一为中性黑白灰；对比证据见最新full comparison。
2. [P1] 用户指出文案没有放在中间。此前横向居中但垂直中心约为 `y=256`；修复后中心约为 `y=354`，与720px视口中心对齐。
3. [P1] 用户指出滚动中存在空白段。此前内容在Hero结束前已完全透明；修复后退场延后到滚动末段，黑色桥接面板提前进入并覆盖sticky尾部，过渡截图中没有无内容空屏。
4. 移动端390 × 844复核无水平溢出，中心文案、中央简历和黑色桥接页依次可见。
5. 主CTA实测跳转至 `/login?mode=register`；最终浏览器console error/warning均为0。

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: 首屏标题仍保留参考站的强烈紧凑字距；若后续更强调中文阅读舒适度，可单独做一轮字体光学微调，不影响本轮验收。

final result: passed

## 首页简历流水线修订 — 2026-08-10

### Visual truth

- Source: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/minimax-flow-reference-1280x720.png`。
- Implementation: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-resume-flow-1280x720.png`。
- Full comparison: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-resume-flow-comparison.png`。
- Focused foreground comparison: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-resume-flow-focus-comparison.png`。
- Scroll transition: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-resume-flow-transition-1280x720.png`。
- State: public landing page, light theme, continuously moving orbit at initial scroll position.
- Source and implementation: 1280 × 720 CSS px / PNG px, DPR 1；comparison为 2560 × 764 px，focused comparison为 2560 × 444 px。

### Required fidelity surfaces

- Typography: 简历改为标准履历层级：姓名、职位、地区、简介、工作经历、项目经历、教育与能力；没有大面积黑色装饰块。
- Spacing and layout: 14张简历沿同一条椭圆轨道连续运行；前场卡片保持与中心CTA错位，后场卡片围绕标题留出可读空间。
- Colors: 保持黑、白、灰，中性细线替代原先的黑色竖条和实心头像块。
- Image/asset quality: MiniMax使用横向媒体图片，LinkCV按产品语义使用真实HTML简历纸张；前景内容清晰，后景通过连续景深虚化，不使用占位图。
- Copy: 首页产品文案不变；简历示例均使用虚构姓名、公司、项目和学校。

### Motion comparison history

1. [P1] 旧实现把卡片固定在轨道槽位，并额外用`AnimatePresence`定时替换中央简历，产生闪出和消失。新实现删除独立中央卡片，14个持久节点全程沿同一椭圆运动，DOM数量恒定。
2. [P1] 旧卡片的尺寸与清晰度不会随前后景自然变化。重新测量MiniMax后，将后场映射为约0.58倍、0.28透明度、2.1px模糊，前场连续过渡到1.5倍、完全不透明、0px模糊，并同步调整层级。
3. [P1] 旧简历使用粗黑竖条、实心圆头像和标签胶囊，不像正常履历。新卡片采用A4比例、细分隔线和标准经历排版，去除所有黑色色块。
4. 连续采样中14个卡片节点数量保持不变；位置、尺寸、透明度和模糊值逐帧变化，不存在节点切换或不连续的首尾跳变。
5. 390 × 844移动端无水平溢出；滚动桥接、CTA注册跳转与浏览器console复核保持通过。

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: 竖版A4简历在前景会被视口底部自然裁切，这与MiniMax前景媒体从底部进入的构图一致；如需完整阅读简历，可后续增加点击聚焦，但不属于本轮首页展示范围。

final result: passed

## 首页滚动朝向修订 — 2026-08-10

### Visual truth

- Source: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/minimax-flow-reference-1280x720.png`。
- Implementation scroll state: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-scroll-upright-mid-1280x720.png`。
- Combined comparison: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-scroll-upright-comparison.png`。
- State: public landing page, light theme, Hero scroll container at `scrollTop=170`。

### Motion verification

1. [P1] 旧实现把滚动进度映射为轨道容器 `rotate(0deg → 86deg)`，所以页面向下滚动时所有简历连同自身朝向一起旋转。修复后轨道容器的计算样式为 `transform: none`。
2. [P1] 旧实现还给单张简历增加约 `±2.8deg` 的随轨道倾斜。修复后卡片变换矩阵的旋转分量持续为 `b=0, c=0`，所有简历始终竖直朝上。
3. 滚动进度现在只换算为额外的轨道时间相位（完整 Hero 滚动增加 `14000ms`），因此滚动时流水线前进更快；停止滚动后继续按原来的 `58000ms` 周期匀速运行。
4. 滚动前后卡片节点数量均为14；景深缩放、透明度、模糊和层级变化保持连续，滚动末段仍由透明度承接下一页面。

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none.

final result: passed

## 首页多样化简历模板修订 — 2026-08-10

### Visual truth

- Previous uniform state: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-resume-flow-1280x720.png`。
- Implementation: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-varied-resume-styles-1280x720.png`。
- Full comparison: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-varied-resume-styles-comparison.png`。
- Mobile evidence: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-varied-resume-styles-mobile-390x844.png`。
- State: public landing page, light theme, continuous orbit at initial scroll position.

### Required fidelity surfaces

- Template variety: 14张卡片拥有14个独立设计配置，组合7种版式：classic、editorial、sidebar、ledger、split、compact与minimal。
- Color: 每张简历使用独立的低饱和蓝、红、绿、金、紫或青灰点缀；颜色只用于页顶线、标题、分隔和浅色摘要背景，不影响正文阅读。
- Resume realism: 所有版式继续保留姓名、职位、地区、联系方式、简介、工作经历、项目经历、教育与技能的完整履历结构，没有恢复大面积黑色色块。
- Motion continuity: 模板变化不影响14个持久节点的椭圆轨道、前后景缩放、模糊、透明度、滚动加速或竖直朝向。
- Responsive: 390 × 844下页面`clientWidth=390`、`scrollWidth=390`，无水平溢出；前景模板差异仍可辨识。

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: 小尺寸后景卡片的颜色主要承担区分作用，详细版式只在进入前景后可读；这符合当前景深展示目标。

final result: passed

## 首页整屏章节过渡修订 — 2026-08-10

### Visual truth

- Previous half-height color block: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-resume-flow-transition-1280x720.png`。
- Implementation: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-fullscreen-bridge-1280x720.png`。
- Full comparison: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-fullscreen-bridge-comparison.png`。
- Transition evidence: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-fullscreen-bridge-transition-1280x837.png`。
- Mobile evidence: `/Users/fang/.codex/visualizations/2026/08/10/019fe9ed-929a-7333-9f5f-22c4921abc0c/linkcv-fullscreen-bridge-mobile-390x844.png`。

### Required fidelity surfaces

- Continuity: 移除黑色背景、顶部大圆角与悬浮阴影，章节改用与Hero一致的页面底色，只以细边线区分内容节奏。
- Viewport occupation: 桌面章节高度与720px视口一致，默认桌面环境为837px/837px；移动端为844px/844px，不再出现只占半屏的卡片式区块。
- Layout: 标题与说明在整屏中心形成独立章节，功能横条固定承担章节底部节奏，再连续进入“现状”内容。
- Responsive: 390 × 844下`clientWidth=390`、`scrollWidth=390`，没有水平溢出；标题、说明和底部横条均在整屏范围内。
- Regression: Hero简历流水线、滚动加速、卡片朝向、多模板颜色和后续内容结构均未改变。

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: 整屏章节保留了较多留白，用于把Hero展示与后续功能说明分成两个明确节奏；这是当前有意选择，不再由突兀色块制造分割。

final result: passed

---

# 2026-08-22 头像与单页内容刷新 Design QA

## Evidence

- Source visual truth paths:
  - `/Users/jixu/Library/Containers/com.tencent.qq/Data/Downloads/E3880EE6E4A197B8DAE022561C3F177E.png` (1100 × 1109, supplied cat avatar)
  - `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-97b22b32-14e7-4007-bd61-4e6017b7af4c.png` (310 × 208, target interest pills)
  - `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-baa496ff-95fa-4af5-8ec1-d6d0d3e57f8a.png` (903 × 1274, administrative reference)
  - `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-44aeaac9-b9be-45ca-8abe-d051d77411f4.png` (717 × 1023, campus reference)
  - `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-f9e11100-b223-4546-b92b-8bd4495e25c4.png` (729 × 1021, civic reference)
  - `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-23234cd3-361e-4848-814e-4632884a1c7f.png` (737 × 1028, creative reference)
- Browser-rendered implementation screenshots:
  - `/private/tmp/linkcv-administrative-sidebar-cn.png`
  - `/private/tmp/linkcv-campus-professional-cn.png`
  - `/private/tmp/linkcv-civic-service-cn.png`
  - `/private/tmp/linkcv-creative-orange-cn.png`
- Combined comparison evidence:
  - `/private/tmp/linkcv-full-comparison.png`
  - `/private/tmp/linkcv-interest-comparison.png`
- Viewport: 900 × 1250 CSS px, device density 1. The rendered A4 paper measured 794 × 1123 CSS px for every template.
- Normalization: full-view source and implementation pages were proportionally fitted into equal 350 × 370 comparison cells; the interest source and implementation region were proportionally fitted into equal-height focused cells without stretching.
- State: read-only full preview using the production `ResumePreview`, Markdown parser, Tiptap extensions, theme classes and the `0027` template content.
- Primary interactions tested: not applicable; these are static resume previews. The same persisted Markdown constructs used by the editor were rendered successfully.
- Console errors checked: none across all four template routes.

## Full-view comparison

The four implementations preserve the source themes: deep-blue full-height sidebar, blue folded section tabs, civic blue header, and orange curved header. All four remain within one A4 page. Final content bottoms were measured at 1171, 1099, 1093 and 1145 px respectively against a paper bottom of 1171 px; no paper had scroll overflow. The remaining bottom space is intentional print-safe margin and varies with each template's original spacing system.

## Focused region comparison

The supplied interest reference and the final administrative sidebar were placed in the same comparison image. Both use a wrapped two-column arrangement of light-gray horizontal pills on the same deep-blue field. The implementation keeps two-character labels horizontal through an 18 mm minimum width, zeroes nested paragraph margins and retains a compact 26 px pill height.

The supplied avatar is used directly as `/templates/avatar-cat.jpg`. Each existing avatar frame clips the scaled image, so the cat remains centered without the original white canvas spilling outside square, rounded-square or circular masks.

## Required fidelity surfaces

- Fonts and typography: existing Source Han serif stack, weights, line heights and section hierarchy are preserved. Text remains legible at full A4 density with no clipping or truncation.
- Spacing and layout rhythm: all templates fit one A4 page; the administrative sidebar and main column now end within the page, and interest pills match the source's horizontal proportions.
- Colors and visual tokens: existing theme blues, orange, white fields, gray text and light-gray pills are unchanged except for the intended pill geometry fix.
- Image quality and asset fidelity: the exact supplied raster asset is shipped without regeneration; theme frames use `overflow: hidden` and a consistent centered crop. No placeholder, emoji, handcrafted SVG or CSS-drawn substitute is used.
- Copy and content: all added content is fictional, coherent with each role and dense enough for a useful full-page preview. Existing user resume snapshots are outside this change.

## Comparison history

### Iteration 1 — blocked

- [P1] The scaled avatar image overflowed its frame because the frame did not clip descendants.
- [P1] Interest labels appeared circular because nested list paragraphs inherited large sidebar margins.
- [P2] The administrative page exceeded A4 while its main column still left a large empty region; the creative page also exceeded A4.

Fixes: added theme-frame clipping, reset interest-label paragraph margins and line height, tightened administrative sidebar vertical rhythm, added role-appropriate main-column content, and removed two lower-value creative bullets.

### Iteration 2 — passed

Post-fix evidence is recorded in both combined comparison images. Avatar frames contain the supplied asset, interest pills are horizontal, all four pages measure 794 × 1123 CSS px with zero scroll overflow, and no actionable P0/P1/P2 mismatch remains.

## Findings

No actionable P0/P1/P2 findings remain.

## Follow-up polish

- [P3] Font rasterization differs slightly from the reference screenshots because the implementation uses the project's licensed Web font stack rather than fonts embedded in the source images. This does not alter hierarchy, wrapping or usability.

## Implementation checklist

- [x] Use the supplied avatar in every active avatar-bearing official template.
- [x] Match the administrative interest-pill shape in preview and editor rendering.
- [x] Fill each active professional template close to one A4 page without overflow.
- [x] Preserve fictional sample data and existing user-created resume snapshots.
- [x] Check browser console and full-page dimensions.

final result: passed

## 简历模板预览弹窗 — 2026-08-21

### Source visual truth

- Path: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-2ac895d6-f112-40af-bef8-752b38ee48e4.png`.
- Pixel dimensions: 1301 x 1400 at 1x density.
- Target state: authenticated template library with the template preview dialog open.

### Implementation evidence

- Local URL: `http://127.0.0.1:5173/templates`.
- Browser viewport observed: 563 x 1790 CSS pixels at 1x density.
- Browser state observed: `/login?next=%2Ftemplates`.
- Implementation screenshot: unavailable because the authenticated template-preview state could not be reached without the user's login session.
- Console errors checked: no warnings or errors were present on the reachable login state.

### Full-view and focused comparison evidence

- The source image was opened and inspected.
- A same-state implementation capture is unavailable: the local browser redirects to the login page before the template library and preview dialog render.
- The preview shell, zoom rail, resume paper, close control, footer actions, typography, spacing, colors, and responsive overflow therefore remain visually unverified.
- Code inspection and automated tests are not substitutes for a visual comparison, so no visual fidelity claim is made.

### Findings

- [P1] Authenticated preview state is unavailable for visual QA.
  - Evidence: the reference shows an open preview dialog; the browser is redirected to `/login?next=%2Ftemplates`.
  - Impact: the required same-state comparison cannot be completed.
  - Fix: sign in locally, open any template card, capture the dialog at a desktop viewport, and rerun design QA.

### Comparison history

1. Source image opened; implementation navigation attempted; authentication redirected the browser to the login page.
2. No same-state comparison or visual fix loop could be performed.

### Follow-up

- Sign in, open a template preview, capture the same desktop state, and compare shell dimensions, tool rail, paper scale, footer, and responsive overflow.

final result: blocked

## 新建简历弹窗 — 2026-08-22

### Visual truth and evidence

- Source: `/Users/jixu/.codex/generated_images/01a0290f-e37f-7502-bcfc-fa6932726e2a/exec-3fe5c740-ad0a-45ad-81fd-822cb179dd74.png` (`1600 × 1000`).
- Implementation: `http://100.119.89.54:5173/resumes`; fictional local API fixtures were used only for browser QA.
- Desktop screenshot: `/Users/jixu/.codex/visualizations/2026/08/22/01a0290f-e37f-7502-bcfc-fa6932726e2a/create-resume-desktop.png` (`1280 × 720`).
- Mobile screenshot: `/Users/jixu/.codex/visualizations/2026/08/22/01a0290f-e37f-7502-bcfc-fa6932726e2a/create-resume-mobile.png` (`390 × 844`).

### Comparison and interaction evidence

- Preserved the existing LinkCV workspace shell instead of copying the generated image's fictional sidebar.
- Matched the selected direction: centered modal, resume name above the template carousel, prominent selected card, page controls, and primary create-and-enter action.
- Desktop dialog measured `760 × 647` CSS px; its template section had no overflow at `1280 × 720`.
- Mobile collapses to one visible template card and keeps the footer actions available; the template area scrolls within the modal when needed.
- Clicking the next arrow changed the selected template and page from `1 / 6` to `2 / 6`; the name input remained editable. Console warnings and errors: 0.

### Comparison history

1. Fixed the generic dialog width constraint that initially limited the modal to 512px.
2. Added a short-viewport layout so the carousel pagination and footer remain usable at 720px height.
3. Added the single-card mobile breakpoint to avoid a compressed three-column layout.

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none.

final result: passed

## 新建简历模板翻页视觉 — 2026-08-22

### Visual truth and evidence

- Source: `/Users/jixu/.codex/generated_images/01a0290f-e37f-7502-bcfc-fa6932726e2a/exec-7b9a19f4-ba3a-4af0-8ffd-26e4a53f06dc.png` (`1600 × 1000`, DPR 1).
- Implementation screenshot: `/Users/jixu/.codex/visualizations/2026/08/22/01a0290f-e37f-7502-bcfc-fa6932726e2a/create-resume-page-turn-desktop.png` (`1280 × 720`, viewport `1280 × 720`, DPR 1).
- Mobile screenshot: `/Users/jixu/.codex/visualizations/2026/08/22/01a0290f-e37f-7502-bcfc-fa6932726e2a/create-resume-page-turn-mobile.png` (`390 × 844`, viewport `390 × 844`, DPR 1).
- Focused comparison: `/Users/jixu/.codex/visualizations/2026/08/22/01a0290f-e37f-7502-bcfc-fa6932726e2a/create-resume-page-turn-comparison.png`.
- State: current-page create dialog open with one selected center template and its previous/next templates visible.

### Required fidelity surfaces

- Typography and copy: unchanged from the existing dialog; this pass intentionally affects only the spatial treatment of template cards.
- Spacing and layout: the center card stays front-facing; adjacent cards now sit close to it and rotate outward around their inner edges, matching the reference's open-page composition.
- Colors and tokens: selection blue, muted side-card opacity, borders, and elevation continue to use existing `--ui-*` tokens.
- Image quality: all three cards continue rendering live `ResumePreview` content; no raster placeholders or recreated assets were introduced.
- Responsive: desktop shows the three-card perspective; `390 × 844` keeps one flat center card with no horizontal page overflow.

### Comparison and interaction evidence

- The source and implementation carousel regions were normalized into the same focused comparison image before judgment.
- Clicking a side page selected it, moved the page counter to `2 / 6`, and kept the dialog open.
- Browser console warnings and errors: 0.

### Comparison history

1. First pass used a subtle 24-degree rotation and 1000px perspective; the page angle was less legible than the reference.
2. Revised the side cards to a 34-degree outward rotation with 650px perspective, tightened the card gaps, and kept the center card visually forward.
3. Replaced the provisional directional shadow with the shared elevation token, then recaptured the desktop and mobile states; no P0/P1/P2 differences remain for the requested page-turn treatment.

### Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none.

final result: passed

---

# 模板预览弧形画廊 Design QA

## 对照基线

- source visual truth path: `/Users/jixu/.codex/generated_images/01a029e2-df72-75f0-97e9-3919e111bb8a/exec-c26cf229-f39a-4f14-a728-6ca0fdd7f20a.png`
- implementation screenshot path: `/Users/jixu/.codex/visualizations/2026/08/22/01a029e2-df72-75f0-97e9-3919e111bb8a/template-preview-implementation-1586x992.png`
- combined comparison path: `/Users/jixu/.codex/visualizations/2026/08/22/01a029e2-df72-75f0-97e9-3919e111bb8a/template-preview-design-qa-comparison.png`
- responsive evidence: `/Users/jixu/.codex/visualizations/2026/08/22/01a029e2-df72-75f0-97e9-3919e111bb8a/template-preview-implementation-1024x768.png`, `/Users/jixu/.codex/visualizations/2026/08/22/01a029e2-df72-75f0-97e9-3919e111bb8a/template-preview-implementation-390x844.png`
- viewport: desktop `1586 x 992`; tablet `1024 x 768`; mobile `390 x 844`
- pixel dimensions: source `1586 x 992`; desktop implementation `1586 x 992`
- CSS size and density: desktop `1586 x 992` CSS px, `devicePixelRatio = 1`; no density normalization required
- state: authenticated `/templates`; preview dialog open; desktop center uses the available real template “清晰侧栏”; source uses “深蓝行政双栏”

## Full-view comparison evidence

- The same-size combined comparison confirms the selected composition: large rounded dialog, fixed header and footer, left zoom rail, complete central A4 sheet, one angled neighboring sheet on each side, and edge navigation controls.
- The implementation deliberately renders the API-provided template data and theme rather than rasterizing the mock. Local seed content is shorter and visually different from the mock, but the paper hierarchy, carousel geometry, controls, and interaction placement match the selected direction.
- Desktop has no document or preview-stage horizontal overflow. The footer remains visible while the paper stage scrolls vertically when content or viewport height requires it.

## Focused region comparison evidence

- The combined comparison includes a full-resolution crop of the carousel stage. It confirms center-page dominance, outward side rotation, side-page occlusion behind the center, legible zoom controls, and consistent white/cool-gray surfaces.
- No separate asset crop was required: resume imagery is not a raster asset in the product; all three sheets use the real `ResumePreview` renderer and existing theme assets.

## Required fidelity surfaces

- Fonts and typography: LinkCV UI keeps the existing Inter/system stack and current utility weights. Resume typography remains owned by each real template theme. Header truncation and compact control labels remain intact.
- Spacing and layout rhythm: dialog proportions, 86 px zoom rail, center alignment, side-card depth, footer separation, and 48 px desktop navigation targets match the mock's hierarchy. Mobile controls remain at least 40–44 px and do not overlap persistent actions.
- Colors and visual tokens: implementation uses existing `--ui-*` surfaces, borders, accent, ring, radii, and shadows; no page-local brand palette was introduced.
- Image quality and asset fidelity: no placeholder, CSS-drawn resume, or rasterized mock is used. All sheets are live `ResumePreview` instances; chevrons reuse the configured Lucide icon family.
- Copy and content: retained “模板预览”, current template name, “缩放”, percentage, “上一个模板”, “下一个模板”, “关闭”, and “创建简历”. Dynamic resume content comes from the API.
- Responsiveness and accessibility: at 1024 px the three-sheet composition remains visible without horizontal overflow; at 390 px side sheets hide and navigation remains available around the centered paper. Buttons are semantic, labelled, keyboard reachable, focus-visible, touch-friendly, and reduced motion disables the entrance transition.

## Comparison history

1. Initial 1024 px pass found a P2 horizontal scrollbar caused by a fixed carousel minimum width. Removed the fixed minimum; post-fix browser evidence reports both document and stage horizontal overflow as false.
2. Initial 390 px pass found P2 stage overflow and vertically stacked footer actions. Reduced mobile paper side padding and explicitly kept footer actions in one row; post-fix evidence reports stage overflow false and footer direction `row`.
3. Final desktop comparison found no actionable P0, P1, or P2 mismatch. The remaining content-density difference is expected because the implementation renders current backend template data instead of mock text.

## Primary interactions and console

- Browser-tested previous/next buttons, side-template selection, `ArrowLeft`/`ArrowRight` switching, zoom-button updates, retained zoom percentage across template switches, close action visibility, and responsive state changes.
- Browser console errors/warnings checked in the final desktop state: none.

## Findings

- No actionable P0, P1, or P2 findings remain.
- P3: the local seed templates do not reproduce the exact deep-blue/sidebar content density shown in the generated mock. This is accepted because changing template data or themes is outside this UI-only task.

## Final result

final result: passed
