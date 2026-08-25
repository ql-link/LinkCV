---
version: alpha
name: LinkCV Product UI
description: An Apple-inspired, task-first interface with warm neutral surfaces, near-black primary actions and LinkCV blue as the interaction accent.
colors:
  primary: "#17191C"
  primary-hover: "#2C3137"
  on-primary: "#FFFFFF"
  accent: "#145ED6"
  accent-hover: "#0F4EB4"
  accent-subtle: "#E9F1FD"
  background: "#F5F5F7"
  surface: "#FFFFFF"
  surface-subtle: "#FAFAFC"
  surface-muted: "#EDF1F5"
  on-surface: "#1D1D1F"
  on-surface-secondary: "#3F4752"
  muted: "#66717F"
  border: "#D2D2D7"
  input: "#C7C7CC"
  ring: "#3979DB"
  error: "#C43B3B"
  error-hover: "#AA3030"
  on-error: "#FFFFFF"
  error-container: "#FFF0F0"
  success: "#267A4D"
  success-container: "#EAF7F0"
  warning: "#9A5B13"
  warning-container: "#FFF6E8"
  scrim: "rgba(15, 18, 22, 0.46)"
typography:
  page-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 1.75rem
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.02em
  section-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 1.25rem
    fontWeight: 600
    lineHeight: 1.25
  subsection-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.25
  body-md:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.55
  body-sm:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.55
  label-sm:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: 0.875rem
    fontWeight: 600
    lineHeight: 1.25
  metadata:
    fontFamily: "JetBrains Mono, SFMono-Regular, Consolas, Liberation Mono, monospace"
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1.25
rounded:
  xs: 0.375rem
  sm: 0.5rem
  md: 0.625rem
  lg: 0.75rem
  xl: 1rem
  full: 9999px
spacing:
  xs: 0.25rem
  sm: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  2xl: 2rem
  3xl: 3rem
  4xl: 4rem
components:
  page:
    backgroundColor: "{colors.background}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-md}"
  surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.lg}"
    padding: 24px
  surface-subtle:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.on-surface-secondary}"
  surface-muted:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.on-surface-secondary}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    padding: 16px
    height: 40px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-primary-pill:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    padding: 20px
    height: 44px
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.on-surface}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.full}"
    borderColor: "{colors.border}"
    height: 40px
  button-secondary-hover:
    backgroundColor: "transparent"
    borderColor: "{colors.ring}"
  link:
    textColor: "{colors.accent}"
    typography: "{typography.body-sm}"
  link-hover:
    textColor: "{colors.accent-hover}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    height: 40px
  input-border:
    backgroundColor: "{colors.input}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  focus-ring:
    backgroundColor: "{colors.ring}"
  helper-text:
    textColor: "{colors.muted}"
    typography: "{typography.body-sm}"
  page-heading:
    textColor: "{colors.on-surface}"
    typography: "{typography.page-title}"
  section-heading:
    textColor: "{colors.on-surface}"
    typography: "{typography.section-title}"
  subsection-heading:
    textColor: "{colors.on-surface}"
    typography: "{typography.subsection-title}"
  technical-metadata:
    textColor: "{colors.muted}"
    typography: "{typography.metadata}"
  destructive-button:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-error}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.md}"
    height: 40px
  destructive-button-hover:
    backgroundColor: "{colors.error-hover}"
    textColor: "{colors.on-error}"
  error-notice:
    backgroundColor: "{colors.error-container}"
    textColor: "{colors.error}"
    rounded: "{rounded.md}"
    padding: 16px
  success-notice:
    backgroundColor: "{colors.success-container}"
    textColor: "{colors.success}"
    rounded: "{rounded.md}"
    padding: 16px
  warning-notice:
    backgroundColor: "{colors.warning-container}"
    textColor: "{colors.warning}"
    rounded: "{rounded.md}"
    padding: 16px
  dialog-scrim:
    backgroundColor: "{colors.scrim}"
  icon-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-secondary}"
    rounded: "{rounded.full}"
    size: 36px
sourceHierarchy:
  - id: design-contract
    path: DESIGN.md
    role: "视觉语义、组合 Pattern、例外边界和机器可读契约的唯一设计事实源"
  - id: runtime-tokens
    path: apps/web/src/design-system/tokens.css
    role: "浏览器运行时 Token 实现，必须与 DESIGN.md frontmatter 的契约值一致"
  - id: settings-implementation
    path: apps/web/src/components/ui/layout-patterns.css
    role: "共享布局 Pattern 的实现；只能映射到已确认 Token，显式消费方通过 variant 或页面作用域表达局部差异"
  - id: feature-local-implementation
    path: apps/web/src/features/*
    role: "页面和用户原型的局部实现；复用基础 Token，但不因页面结构相似而自动消费 Settings Pattern"
  - id: quality-gate
    path: scripts/quality/check_design_system.py
    role: "确定性校验设计契约和共享 Pattern 映射"
settingsPattern:
  id: settings
  name: "LinkCV Settings Pattern"
  tokenContract:
    --ui-settings-content-max: "60rem"
    --ui-settings-section-inset: "var(--ui-space-5)"
    --ui-settings-row-min-size: "3.5rem"
    --ui-settings-action-track: "5rem"
    --ui-settings-label-track: "10rem"
  layout:
    desktop:
      content: "min(var(--ui-settings-content-max), 100%)"
      sectionInset: "var(--ui-settings-section-inset)"
      columns: "var(--ui-settings-label-track) minmax(0, 1fr) var(--ui-settings-action-track)"
      gap: "var(--ui-space-3)"
      rowMinSize: "var(--ui-settings-row-min-size)"
    mobile:
      pageInset: "var(--ui-space-4)"
      sectionInset: "var(--ui-space-4)"
      columns: "1fr"
  invariants:
    - id: task-order
      rule: "设置页按页面上下文、身份摘要、可编辑信息、关联资料、当前会话的顺序组织；Pattern 不改变业务顺序"
    - id: shared-edges
      rule: "页面标题与主体使用同一工作区左侧基准线；宽屏内容不因 max-width 自动居中到独立轴线"
    - id: one-frame
      rule: "同一设置任务使用一个外框承载语义分区，内部仅在需要表达分组时使用分隔线"
  variants:
    content:
      default: "min(var(--ui-settings-content-max), 100%)"
      narrow: "56rem 页面局部最大宽度，通过 ui-content-frame--narrow 选择"
      wide: "72rem 页面局部最大宽度，通过 ui-content-frame--wide 选择"
    frame:
      framed: "外框、背景和内部 section 分隔"
      plain: "不提供外框，适用于已由宿主提供表面或需要普通文档流的页面"
    section:
      default: "标准 section inset"
      identity: "身份摘要的较宽上下留白"
      compact: "高频或低复杂度 section 的较紧上下留白"
    row:
      desktop: "标签 / 可伸缩内容 / 操作三轨"
      mobile: "按 DOM 顺序堆叠为单列，操作留在相关字段之后"
  notApplicable:
    - "营销落地页、登录入口和简历纸张不使用 Settings Pattern"
    - "固定媒体几何和产品特定控件不使用字段列轨道"
    - "列表、仪表盘和编辑器不因存在表单字段而套用 Settings Pattern"
  pageLocalFreedom:
    - "页面可以选择不消费 Pattern，或通过 content/frame/section variant 改变结构密度"
    - "单页可在自身作用域调整内容宽度、媒体尺寸和内容驱动断点；不得新增品牌色或替代基础 spacing/font Token"
    - "仅当出现两个真实消费者、共享组件或明确跨页不变量时，才把页面试值晋升为 Pattern"
  typography:
    subsectionTitle: "var(--ui-text-md)"
    body: "var(--ui-text-sm)"
    helper: "var(--ui-text-sm)"
    metadata: "var(--ui-text-xs)"
---

# LinkCV Product Design System

## Overview

LinkCV 的登录后功能区采用 Apple 式克制与 OpenAI 式任务效率：温和的中性表面、近黑色主操作、蓝色交互反馈和接近无感的界面层级。它不是 Apple 官网的产品陈列复刻，而是适合简历管理、编辑和后台操作的中等密度工具。用户进入页面后应能迅速判断当前位置、主要内容和下一步操作。

这套系统面向简历管理、岗位管理、设置、编辑工作台和管理端等软件功能。公共营销落地页可以拥有独立的品牌构图；登录页可以保留一处简短品牌表达，但表单仍服从本系统；简历纸张和 PDF 使用文档排版规则，不使用软件界面 Token。

## Colors

界面以暖中性浅灰背景、白色表面和近黑文本构成。近黑 `primary`（#17191C）用于主要操作和结构性强调；LinkCV 蓝 `accent`（#145ED6）用于链接、选中状态和焦点关联，不把整页染成蓝色。

- `background` 承载页面画布，`surface` 承载输入、弹窗和必要容器；`surface-subtle` 与 `surface-muted` 只做低层级分组。
- `on-surface-secondary` 用于真实有用的补充说明，`muted` 用于元信息、占位和弱化内容。
- `primary` 表达需要用户确认的主操作；`accent` 表达链接、选中和焦点等交互关联；近黑色 `on-surface` 只负责文字和结构。
- `error`、`success`、`warning` 只表达对应语义，不能作为装饰色。
- 普通文本及交互状态至少满足 WCAG AA；焦点必须使用清晰的 `ring`，不能只依赖颜色变化。

## Typography

排版强调快速扫描。页面通常只使用页面标题、区域标题、正文和辅助信息四级，不通过连续增加字号或字重制造层级。

- 功能区页面标题与正文使用同一套系统字体/Inter 字族，通过字号、字重和紧凑字距建立层级；Space Grotesk 只保留给营销和品牌表达。
- 正文和控件使用无衬线字体；正文默认 16px，密集控件和说明使用 14px。
- 技术标识、时间、版本和短元数据可以使用等宽字体，但正文不使用。
- 删除“欢迎使用”“轻松完成”“一站式管理”等不能帮助用户决策的文案；说明文字只解释限制、后果或下一步动作。

设置页使用 `subsection-title`（16px/600）作为区域标题；核心正文、字段标签和控件使用 14–16px，只有时间、短状态和其他元信息使用 12px `metadata`。不把账户页个案字号直接推广为全局规则。

## Design source hierarchy

机器可读的 `sourceHierarchy` 与 `settingsPattern` 位于本文 frontmatter，是稳定设计语义和组合布局的事实源。`apps/web/src/design-system/tokens.css` 必须逐项实现 `settingsPattern.tokenContract`；显式选择 Settings Pattern 的共享组件或页面必须把对应 selector/property 映射到这些 Token。质量门禁脚本只检查这条稳定链路，不能用某个页面尚未确认的试值反向改写 Pattern。

尚未形成共享 Pattern 的页面允许在 feature/page 作用域验证内容驱动的局部几何；两个以上真实消费者复用、准备形成共享组件、用户明确确认为跨页面标准，或需要长期防漂移时，才晋升为 Pattern 和 checker。用户原型采用其他结构时仍复用基础 Token，但不需要伪装成 Settings Pattern；已经显式消费 Pattern 的页面也不得借页面试值绕过已声明的设置行、section inset 或文字语义。

## Settings Pattern

Settings Pattern 只约束显式选择它的共享组件或页面，不是所有设置表单、卡片、列表或用户原型的全局模板。默认桌面内容最大宽度为 60rem；显式消费方可以选择窄版 56rem，并与页面标题共享左侧基准线。section 使用 24px inset，字段行采用“10rem 标签 / 可伸缩内容 / 5rem 操作”三列和 12px gap，行最小高度约 56px。移动端保留 16px 页面/section inset，按同一 DOM 顺序堆叠为单列。helper text 属于字段说明，使用 14px；时间和短元信息才使用 12px。未选择 Settings Pattern 的页面仍应复用基础字体、间距、颜色和圆角 Token，并根据用户原型实现自身结构。

## Layout

每个页面只有一个主任务，默认阅读顺序是：页面上下文与标题 → 主要操作 → 核心内容 → 必要说明。一个区域通常只有一个主按钮；筛选和次要操作不能与主操作争夺注意力。

布局采用流式内容区和 4px 基础间距。控件内部通常使用 8–16px，相关内容间使用 16–24px，大分区间使用 32–48px。不要为了整齐把所有内容装入卡片；先使用排版、间距、分隔线和背景层级。

响应式基准为 1440、1024、390px。桌面保留完整导航和高价值辅助信息；小桌面收窄辅助区或转为主次堆叠；移动端采用单列、16px 页面边距和可触达操作。关键值不得截断，表格应重排或显式横向滚动。

## Elevation & Depth

深度主要由色调层和细边框表达，而不是大面积阴影。普通卡片不使用阴影；只有 Popover、下拉菜单、弹窗和其他真正浮起的临时表面使用轻微或中等阴影与 scrim。不要在同一容器同时叠加强边框、深阴影和高对比背景。

### Motion & Interaction

动效只解释按下、打开、关闭、展开、操作结果或空间关系。它必须由用户操作或真实状态变化触发，默认不使用弹跳，不把动效当作等待业务完成的人工延迟。功能区不使用全页切换动画、持续 Shader、粒子、视差或自动播放装饰。

运行时以 `--ui-duration-fast: 100ms`、`--ui-duration-base: 180ms`、`--ui-duration-slow: 260ms`、`--ui-ease-standard` 和 `--ui-ease-press` 为唯一基础 Token。新组件先复用这些值；只有手势驱动且需要连续跟手时才使用可中断弹簧，并从当前可见位置继续，不为普通按钮、菜单或表单引入弹簧库。

| 交互 | 默认反馈 | 时序 | 限制 |
| --- | --- | --- | --- |
| Hover | 只改变颜色、边框或背景 | 100ms，`--ui-ease-press` | 不移动布局，不给普通卡片添加悬浮位移或新阴影 |
| Button press | `pointer-down` 立即反馈，可使用 `scale(0.98)` 或下移 1px | 100ms，`--ui-ease-press` | 禁用态无按压效果；操作提交后用状态反馈，不保留缩放 |
| Select / Popover / Menu | 从触发器方向淡入并移动 4px；关闭沿原路径返回 | 180ms，`--ui-ease-standard` | `transform-origin` 对齐触发器，不从无关方向飞入，不弹跳 |
| Dialog | Scrim 淡入，面板使用 opacity 与 `scale(0.98 → 1)` | 打开 180–220ms；关闭不长于打开 | 焦点立即进入弹窗；动效期间不能锁住关闭或键盘输入 |
| Drawer / Sheet | 沿其停靠边缘进入和退出 | 220–260ms，`--ui-ease-standard` | 同一路径往返；只有真实拖拽时才允许跟手与速度衔接 |
| Accordion / Collapsible | 内容高度与 opacity 同步变化 | 180ms，`--ui-ease-standard` | 不延迟内容可访问性；长内容避免夸张高度动画 |
| Tooltip | 指针或键盘聚焦稳定后出现，短淡入 | 延迟约 300ms；出现不超过 100ms | 关闭即时；任务必需信息不能只放在 Tooltip 中 |
| Toast / inline feedback | 短淡入或 4px 位移，结果文案立即可读 | 进入 180ms；退出 100–160ms | 错误不得自动过早消失；状态不能只靠动画表达 |
| Loading | 使用局部进度、Skeleton 或紧凑 Spinner | 只在真实等待期间运行 | 不用假进度拖延；避免整页脉冲和大面积循环运动 |

只动画 `transform` 与 `opacity` 等不改变布局的属性；颜色、边框和背景可做短过渡。禁止用动画隐藏操作延迟，也不要在同一状态变化里叠加缩放、位移、模糊和旋转等多种效果。进入与退出必须保持来源、方向和层级一致，用户在过渡期间仍可继续操作或撤销。

所有动效必须支持 `prefers-reduced-motion: reduce`：移除位移、缩放、弹簧、视差和自动循环，改为不超过 100ms 的 opacity 或颜色变化；加载状态保留静态或低运动量反馈。关闭动效、焦点转移和可访问状态不能依赖动画完成事件。

## Shapes

形状语言偏紧凑和工程化：输入、主按钮与表单提交使用 8–10px 圆角，卡片与弹窗使用 12–16px。透明次要文字按钮、页面级 CTA、筛选 Chip、切换项和头像可以使用全圆角；纯图标按钮、导航标签、危险按钮和密集表格操作仍按各自语义控制形状，不能把所有动作无差别做成药丸。同一页面不要混用大量无关联的圆角尺寸。

## Components

- **Buttons:** `primary` 使用 LinkCV 蓝且只用于区域内最重要的动作；页面级单一 CTA 可以使用 `button-primary-pill`，普通提交仍使用紧凑圆角。带文字的 `secondary`、`outline` 和 `ghost` 统一为透明全圆角细边框，悬浮或键盘聚焦时由边框中部向左右两半扩展 LinkCV 蓝色描边，并显示克制柔光；减少动态效果时直接切换最终边框。纯图标按钮、导航标签与不可逆的 `destructive` 不继承该外观，不可逆操作仍需确认后果。
- **Inputs:** 始终提供可访问标签；帮助文字和错误贴近字段；提交中禁止重复操作，不能只用 placeholder 代替标签。
- **Lists:** 优先展示对象身份、状态和主要动作；次要元信息降级；必须设计加载、空、错误和继续加载状态。
- **Dialogs:** 只用于需要打断当前任务的确认或短流程。移动端保留至少 16px 外边距，危险动作提供明确标题和后果。
- **Cards:** 只在内容确实构成独立对象或分组时使用，不把每段说明包装成卡片。
- **Feedback:** 成功反馈简短且不阻塞；错误保留可行动信息；状态不能只依赖短暂动画或颜色。
- **Tooltips:** 只补充图标按钮或陌生术语，不承载完成任务所必需的信息。

基础交互优先复用 shadcn primitive，LinkCV 的共享实现集中在 `apps/web/src/components/ui/`。组件进入项目后使用本文件的语义和 Token 校准，不保留与项目冲突的 registry 默认视觉。

## Do's and Don'ts

- Do 让标题直接说明任务，并把主要操作放在最容易发现的位置。
- Do 使用 `primary` 作为唯一交互蓝，让主要按钮、链接、选中状态和焦点形成一致信号。
- Do 只保留会影响用户判断、操作或结果的文字。
- Do 为加载、空、错误、成功、禁用和权限不足提供真实状态。
- Do 保持键盘焦点可见、交互目标可命名，并验证 1440、1024、390px。
- Don't 使用营销口号填充内部功能页面。
- Don't 用装饰卡片、渐变、玻璃效果或循环动画掩盖信息结构问题。
- Don't 在单一区域放置多个同等级主按钮。
- Don't 引入第二套品牌强调色，也不要用大面积蓝色卡片装饰内部功能页。
- Don't 把页脚的 FlutedGlass 或颗粒 Shader 铺进列表、表单、设置和管理页面；纸质蓝只用于营销、入口或少量品牌时刻。
- Don't 复制外部页面的全局样式或未知依赖；只提取与当前任务有关的布局和动效意图。
- Don't 把宣传页、软件功能区和简历文档的视觉规则混在一起。
