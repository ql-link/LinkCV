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
