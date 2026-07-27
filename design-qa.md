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
- 浏览器控制台无错误；自动化测试、类型检查和生产构建结果由规格状态与 PR 验证摘要记录。

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
