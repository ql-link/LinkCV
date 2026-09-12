# Design QA

## 求职中心页头与排期控件 — 2026-09-06

### Evidence

- Source visual truth: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-5787d624-cbcb-400c-9aa2-1c7d066cd99f.png`（`377 × 230` px，标出“议程”和“时间网格”入口；用户明确要求这两个视图的线条颜色与此前周视图一样减淡）。
- Implementation route: `http://127.0.0.1:5173/career/applications` 与 `http://127.0.0.1:5173/career/schedule`，Chrome 已登录桌面状态。
- Implementation screenshot: 当前任务中的 CUA 最终浏览器截图；该浏览器接口返回内联 PNG，没有提供可持久化文件路径。
- Viewport: `1920 × 1022` CSS px，device density `1`。来源为局部裁切，因此使用完整实现截图确认页面结构，再分别聚焦二级导航与排期工具栏进行归一化比较。
- State: “面试排期”选中，浅色主题，真实排期数据已加载；同时核对视图菜单关闭和展开状态。

### Findings

没有剩余 P0/P1/P2 问题。

- 字体与排版：“今天”“周”、日期标题和二级导航使用项目系统字体及与来源一致的字重层级，菜单项目保持清晰的 15px 正文字号。
- 间距与布局：二级导航文字底部与橙色弧线之间保留可辨识空隙；弧线改为以文字标签自身定位，浏览器实测“面试排期”文字与弧线中心均为 `368.171875px`，横向偏差 `0px`，左侧圆点不再参与弧线居中计算。排期工具栏按“今天、周、上一周期、下一周期、日期标题”顺序紧凑排列。
- 色彩与 Token：选中项使用 `#f97316` 橙色圆点、文字和短弧形下划线；未选中项使用浅灰圆点和次级文字色，符合来源层级。
- 视图分隔线：议程的根边框、日期分组线与记录分隔线统一使用 `--ec-grid-line-color`，与周视图的浅灰网格 Token 一致；不需要资源排期后，“时间网格”入口及其专属样式已移除。
- 图片与图标：二级导航恢复项目原有 Lucide `ListChecks` 与 `CalendarDays` 图标，尺寸均为 15px；选中图标随文字变为橙色，未选中图标保持灰色。翻页与下拉箭头继续使用项目既有图标，没有增加截图中不存在的装饰资产。
- 文案：导航已统一为“今天”“周”“选择视图”，菜单项统一为“月、周、日、5 天、议程”，日期标题采用中文年月日范围格式。
- 控件外观：“今天”与前后翻页按钮均为透明背景、零边框、零阴影；“周”在菜单关闭且鼠标未悬停时同样为透明背景，仅在悬停或菜单展开时显示浅灰反馈；日历右侧“安排面试”按钮及其工具栏占位已完整移除。

### Interaction Evidence

- 在真实 `/career/schedule` 周视图同一空白坐标执行浏览器点击：单击后弹窗数 `0`、临时排期数 `0`；双击后出现“新建面试”弹窗及 `12:00–12:30` 临时排期。
- 默认关闭态实测“周”为 `background: rgba(0, 0, 0, 0)`；点击后展开态为 `rgba(237, 241, 245, 1)`；选择“周”关闭菜单并移开鼠标后恢复为透明。
- 已登录 Chrome 中重新加载 `/career/schedule`，可访问树与真实 DOM 中“安排面试”按钮数量均为 `0`，周排期网格数量为 `1`；完整页面截图确认右侧空间自然留白，没有残留按钮边框或空工具栏。
- 中文化后在真实页面核对关闭态显示“今天 / 周 / 2026年8月31日 – 9月6日”；展开视图菜单后五个选项依次显示“月、周、日、5 天、议程”，无英文视图名称或资源排期入口残留。
- 在真实“面试排期”和“求职记录”两个路由分别截图：二级导航文字左侧均显示语义图标；切换路由后当前项的图标、文字与弧形下划线同步变橙，另一项图标保持灰色，导航位置与间距未漂移。
- 在真实页面切换“议程”并截图：议程日期分组线与记录分隔线均呈现与周视图一致的浅灰细线，内容与滚动区域未受影响。
- 移除资源排期后重新加载排期页并展开菜单，真实 DOM 与截图中只剩“月、周、日、5 天、议程”五项，“时间网格”不存在，菜单高度自然收拢。
- 拖动选择入口仍保留，单击规则调整没有移除按住空白区域拖动创建时间范围的能力。
- 浏览器控制台 error：0。

### Comparison History

1. 首次实现完成结构上移，但沿用了偏棕的 warning 色，与来源亮橙选中态存在 P2 色差。
2. 修复为页头局部 `#f97316`，同时让公文包边框、导航圆点、文字与下划线共享同一强调色。
3. 修复后重新捕获完整求职记录页，并切换两个入口核对布局与状态；未发现剩余 P0/P1/P2。
4. 用户进一步要求删除说明并居中标题；移除说明节点，为标题容器设置 38px 最小高度和垂直居中，再次捕获真实排期页。聚焦对照确认标题与图标中心线重合、导航结构未漂移，无新增 P0/P1/P2。
5. 本轮首次捕获发现通用透明按钮样式仍给 Today 和 Week 回灌边框，并给前后翻页按钮回灌灰底，属于 P2 视觉偏差；同时二级导航下划线与文字过近。
6. 将日历导航选择器改为精确匹配实际 `data-slot`，清除 Today 和翻页按钮的边框、背景与阴影，只保留 Week 的浅灰底；下移弧线后重新捕获关闭态和展开态，未发现剩余 P0/P1/P2。
7. 用户指出弧线仍按“圆点＋文字”整体居中；将弧线伪元素从链接迁移到独立文字标签，并重新捕获排期页。浏览器测得文字与弧线中心差值 `0px`，问题已消除。
8. 用户指出 Week 在未悬停时仍像被选中；移除关闭态常驻浅灰底，并避免菜单选择后返回焦点造成灰底残留。重新验证关闭、展开、再次关闭三个状态，背景依次为透明、浅灰、透明，无剩余 P0/P1/P2。
9. 用户要求删除日历右侧“安排面试”按钮；移除按钮节点、空工具栏容器及专属样式，并把相关组件测试改为通过既有的空白时间双击入口打开新建弹窗。真实页面复核按钮数量为 `0`，日历数据与网格保持正常，无剩余 P0/P1/P2。
10. 用户要求将排期左侧 Today、Week 等控件中文化；同步调整按钮、无障碍标签、完整视图菜单和各视图日期标题。真实页面分别捕获关闭态与菜单展开态，中文文案完整且布局未溢出，无剩余 P0/P1/P2。
11. 用户要求把二级导航文字左侧圆点恢复为原有语义图标；用 `ListChecks` 和 `CalendarDays` 替换圆点，并恢复 15px 图标尺寸与选中态颜色继承。真实页面切换两个入口核对图标与激活状态，无剩余 P0/P1/P2。
12. 用户指出“议程”和“时间网格”的线条颜色仍过重；为两个视图的结构边框统一应用周视图的 `--ec-grid-line-color`，并分别捕获真实视图核对。边框层级已统一，无剩余 P0/P1/P2。
13. 用户确认不需要资源排期；从可用视图中移除 `resource`，同步删除资源视图的局部边框覆盖并更新菜单测试。真实页面展开菜单后确认只剩五个有效视图，无剩余 P0/P1/P2。

### Follow-up Polish

- P3：来源截图与当前开发数据的具体日期不同；这是数据状态差异，不属于控件样式偏差。

final result: passed
---

## 求职记录看板响应式列宽与时间信息 — 2026-09-11

### Evidence

- Source visual truth: `/Users/jixu/.codex/generated_images/01a08ff6-0049-70f1-8e5b-61e5a0c93273/exec-90e0ad11-5566-4f03-9275-baaa39a75b64.png`，`1672 × 941` px；用户保留该六列舒适密度，并在后续反馈中明确将卡片底部改为左侧状态、右侧时间的单行布局，后续反馈优先于原图的双层结构。
- Implementation route: `http://127.0.0.1:5174/career/applications`，当前工作树 Development profile，Chrome 已登录浅色主题。
- Implementation screenshot path: 当前任务中的 CUA 最终内联 PNG；浏览器接口未提供可持久化文件路径。
- Comparison input: 已在同一任务上下文打开来源原型与实现截图；按看板内容区归一化比较，不把来源省略的工作区页头视为差异。
- Viewport and density: 默认 `1920 × 1078` CSS px、density `1`；响应式补充检查 `1440 × 900` CSS px、density `1`。
- State: 真实 Dev 求职数据已加载，无弹层；默认横向滚动位置在最左侧。

### Findings

没有剩余 P0/P1/P2 问题。

- 字体与排版：沿用 LinkCV 系统字体、公司 12px、岗位 15px、状态 12px 的既有层级；新增时间元数据为 11px、500 字重，保持可读且不抢状态层级，长岗位继续单行截断。
- 间距与布局：默认 1920px 视口下看板内容宽 `1860px`，前六列各 `310px` 并全部完整可见，第七列从右侧边界开始；1440px 下列宽保持 `280px`，完整展示五列并横向滚动。卡片恢复为紧凑的 `118px` 高度，底部使用单行左右布局，状态靠左、时间靠右，并以 `8px` 弹性间距隔开。
- 色彩与 Token：页面、卡片、边框、状态和元数据继续消费现有 `--ui-*` 与 `--career-state-*` Token；时间行使用 muted 文本色，没有引入原型外的新强调色。
- 图片与图标：看板无栅格内容；时间使用项目现有 Lucide `Clock3`，拖动手柄和三点菜单保持原有图标与尺寸，没有用字符或 CSS 绘图替代。
- 文案与内容：待投递显示“创建于”，筛选显示“投递于”，测评/笔试显示“截止”，面试显示起止时间或“尚未安排时间”，Offer 显示“获得 Offer”，已结束显示“结束于”；缺失时间均有明确兜底。
- 聚焦对照：最终 1920px 捕获中卡片公司、岗位、状态、时钟及时间均清晰可辨；“正在进行/进行中”等状态稳定靠左，时间稳定靠右，没有互相覆盖，长岗位继续截断。真实数据的公司名称与原型示例不同，属于状态差异。

### Interaction Evidence

- 默认看板实测 `clientWidth=1860`、`scrollWidth=2170`，横向滚动仍有效，未隐藏后续阶段。
- 卡片菜单可正常展开，显示“查看详情、修改分类、推进流程、终止求职”，按 Escape 可关闭。
- 真实 Dev 数据已观察到创建时间、测评/笔试截止时间、无排期兜底和结束时间；Offer 时间由自动化测试覆盖，因为当前账号的 Offer 列为空。
- 默认与 1440px 响应式视口均无页面级横向挤压或持久控件遮挡。
- 浏览器控制台 error：0。

### Automated Evidence

- 定向组件测试：`142` 项通过，覆盖六类阶段时间及回归交互。
- `npm run check:web`：`60` 个测试文件、`677` 项测试通过，设计规则、TypeScript、Vite 生产构建与 PDF CLI 构建通过。
- `npm run check:docs`：通过。

### Comparison History

1. 首次实现后在 1920px 与 1440px 两个真实浏览器视口对照已确认原型的列密度、卡片双层信息和横向滚动；未发现 P0/P1/P2。
2. 用户要求将状态与时间从上下结构改为左右结构；实现后重新捕获 1920px 已登录真实数据状态，恢复 `118px` 卡片高度并确认左右对齐、截断和六列密度均正常，没有新增 P0/P1/P2。

### Follow-up Polish

- P3：来源图用示例 Offer 卡片展示时间，而当前账号 Offer 列为空；当前阶段进入时间的视觉和文案由同一卡片组件与自动化用例确认。

final result: passed

---

# 开放窗口与作答计划 Design QA

- reference: `/Users/jixu/.codex/generated_images/01a08961-e9bf-7e43-86d2-819cb6049c14/exec-81852339-6b61-44ac-b8c8-cae2b8e697fd.png`
- implementation: `http://127.0.0.1:5174/career/schedule`
- viewport checked: desktop 1280 x 720
- data checked: 5 条虚构开放窗口和 1 条个人作答计划

## Comparison

- 周视图保留既有导航、星期表头、小时网格和当前时间线。
- 官方开放范围在顶部只读区域展示公司、阶段、精确起止时间、颜色和待完成状态。
- 默认显示 3 条窗口；第 4 行是“还有 2 项待完成 · 展开查看”，点击后展示全部 5 条并切换为“收起更多项目”。
- “我的作答计划”独立显示在周六 19:00–21:00 小时网格，不改变官方窗口。
- 页面信息层级和交互模型与参考一致；在 1280 x 720 验收视口下使用现有日历的紧凑密度，避免破坏工作区外框。

final result: passed

---

## 求职记录看板栏位弱化 — 2026-09-10

### Evidence

- Source visual truth: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-6af015bf-e246-4a3e-97d2-6ae7e92de4d1.png`，`1231 × 855` px；用户指定只复现栏位之间的浅色单线分隔与无独立栏背景。
- Implementation route: `http://127.0.0.1:5174/career/applications`，当前工作树 Web 与 FastAPI，Chrome 已登录桌面状态。
- Implementation screenshot: 当前任务中的 CUA 最终内联截图；浏览器接口未提供可持久化文件路径。
- Viewport: `1920 × 1078` CSS px，device density `1`。来源图的真实 CSS viewport 与 density 未知，因此完整画面按可见结构归一化比较，并聚焦核对相邻栏边界、栏背景和岗位卡片。
- State: 浅色主题，7 个真实阶段栏、16 张岗位卡片已加载，无弹层。

### Findings

没有剩余 P0/P1/P2 问题。

- 字体与排版：沿用 LinkCV 既有字体、字号、标题层级与省略规则；本次没有改动文字样式。
- 间距与布局：栏间 gap 为 `0px`，相邻栏共用连续的 1px 竖向分隔线；栏内 12px inset、260px 列宽、卡片高度与滚动行为保持原实现。
- 色彩与 Token：所有栏背景实测为透明 `rgba(0, 0, 0, 0)`，自然透出项目背景；第二栏起使用由 `--ui-border` 混合得到的 68% 浅色分隔线。
- 图片与图标：目标区域没有新增图片资产；拖拽手柄与卡片菜单继续使用项目既有 Lucide 图标。
- 文案与内容：阶段名称、数量、公司、岗位和进度文案均未改变。
- 聚焦对照：参考图保留白色岗位卡片并弱化栏容器；最终实现同样保留 16 张白色岗位卡片，只移除整栏圆角、边框和底色。无需额外图片裁切即可辨识关键差异。

### Interaction Evidence

- 真实路由成功加载 7 栏和 16 张岗位卡片；标题拖拽节点、卡片菜单与横向看板 DOM 结构未改动。
- 当前页面应用自身 console error 为 0；仅 Chrome 扩展记录过与页面实现无关的扩展上下文错误。

### Comparison History

1. 首次对照发现 5173 由另一工作树提供，仍显示旧版栏卡片；该截图不作为实现证据。
2. 按 Development profile 在独立的 5174/18001 端口启动当前工作树，重新加载同一真实账号与求职数据。
3. 最终对照确认栏容器已透明、圆角与整框消失，相邻栏之间只保留浅色单线，无剩余 P0/P1/P2。

### Follow-up Polish

- 无。本次按用户范围保留既有列宽、卡片尺寸和页面其余视觉细节。

final result: passed

---

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

---

# AI 助手名称前缀检索与内联文件引用 — 2026-09-03

## Evidence

- Source visual truth: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-08784b34-174e-4d69-92ce-c3106fbc335c.png`、`/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-cd50507f-cb0e-4b3d-9ad4-f9bbb09343fe.png`、`/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-7701bfe9-9f1e-4a6a-a003-78ce2eb9d16e.png` 与 `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-82544ac8-2299-4835-b365-baa0e54aa995.png`。前三张分别规定内联原子引用与资料库图标，第四张规定搜索结果使用不可选择的分类标题。
- Implementation route: `http://127.0.0.1:5173/assistant`，Chrome 已登录桌面状态。
- Implementation screenshots: `/private/tmp/linkcv-assistant-inline-reference.png`、`/private/tmp/linkcv-assistant-dataset-icon.png` 与 `/private/tmp/linkcv-assistant-grouped-mentions.png`，均为 `1920 × 1887` px，桌面 CSS 视口与 device density 均为 `1`。
- Combined comparison: `/private/tmp/linkcv-assistant-inline-comparison.png`，`1298 × 1068` px；上方保留两张原始参考，下方为实现截图的输入区等比聚焦裁切。
- Source pixels: `1298 × 399` 与 `329 × 64`；参考是局部功能示意而非完整同视口页面，因此只比较编辑器内部结构、引用位置和视觉层级，不对页面留白做像素级判断。
- State: 输入真实资料名前缀 `@mock-dev-20260823-a1-2`，Tab 选择首项，再分别在引用后输入“这是什么”、按 Home 在引用前输入“你好 ”。

## Findings

没有剩余 P0/P1/P2 问题。

- 字体与排版：普通正文沿用助手输入区的文楷字体；文件单元使用现有无衬线 UI 字体与较小字号，和参考中正文、引用的层级差异一致。长名称使用单行截断，不撑破编辑器。
- 间距与布局：文件引用已从编辑器上方移除，并与“你好”“这是什么”处在同一文本行。引用左右保留小间距，光标可停在单元前后，输入框高度、圆角、发送按钮和底部控制区保持原布局。
- 色彩与 Token：引用采用浅灰蓝背景、细边框和蓝色文件图标，层级接近参考的轻量内联引用，不引入额外强调色或阴影。
- 图片与图标：资料库结果与内联资料引用使用和工作区导航一致的 Lucide `Database` 圆柱图标，简历继续使用 `FileText`；移除操作仍使用项目现有图标，不使用字符、CSS 绘图或占位资源。
- 文案与内容：搜索词解释为 `@` 后完整名称前缀；`@资料` 在真实账户中没有同名前缀文件时明确显示“没有匹配的文件”，不会再错误展示全部资料。
- 分组层级：空搜索词下按“简历”在前、“资料”在后的顺序展示两个弱化标题，标题不可选；每组最多返回四项，使两个分类和资料首项在默认弹层高度内同时可见。

## Interaction Evidence

- `@资料` 返回空结果，证明“资料”不再被解释为分类指令。
- `@mock-dev-20260823-a1-2` 只返回名称以该字符串开头的资料；Tab 选择可见首项。
- 选中后引用作为不可编辑原子单元进入正文；实测可在其后输入“这是什么”，按 Home 后可在其前输入“你好 ”。
- 发送后的用户消息继续按原位置显示同款内联文件单元，不再显示 `@文件名` 占位文本或在气泡下方重复追加文件标签；真实历史会话复核内联单元后直接衔接消息正文，控制台 error 为 0。
- 成功完成发送后，下一轮输入框不再残留刚发送的文件单元；失败或停止仍保留草稿和引用供重试。
- Markdown 一级至三级标题改为 28px、24px、21px 的语义标题层级，均大于 20px 正文；组件测试覆盖 `h2`、`h3`、`h4` 映射，避免标题再次退化为小号粗体。
- Agent Markdown 组件测试覆盖水平分隔线、表格、有序列表、引用、链接、删除线、代码块与安全图片占位，并验证原始 HTML 不执行。
- 真实历史会话复核得到 2 个语义表格、6 条水平分隔线、0 个残留 `---` 文本段落；输入框引用单元为 0，标题为 24px/21px、正文为 20px，控制台 error 为 0。
- 独立助手表格正文使用 18px 字号和 9px × 11px 单元格留白，在保持与 20px 正文层级区分的同时提高长表可读性。
- 删除按钮可移除引用；验收结束后已清空未发送草稿，没有写入对话或共享数据。
- Chrome 控制台 error：0。

## Automated Evidence

- `npm run check:web`：61 个测试文件、560 个测试通过，设计规则、TypeScript 与生产构建通过。
- Agent 后端定向测试：33 个通过，覆盖普通包含搜索与 `prefix=true` 前缀搜索的差异。

## Comparison History

1. 初始实现把 `@资料`、`@简历` 当作来源分类，并把已选文件显示在编辑器上方，与用户更正后的语义不一致。
2. 修复后统一按 `@` 后名称前缀同时检索资料和简历；引用移入 contenteditable 正文并作为不可拆分单元渲染。
3. 聚焦对照确认引用位置、图标、名称层级、前后文字和移除控件均符合两张参考图表达的目标，无需继续处理 P0/P1/P2。
4. 用户补充资料库图标参考后，将 `dataset` 在 @ 结果、内联引用和资料选择器中的图标统一为导航栏同款 `Database`；浏览器复核弹层与选中态均生效。
5. 用户补充分组参考后，新增“简历 / 资料”两个不可选择的分类标题，并把每组初始结果收敛为四项；相同桌面状态下复核两个标题及资料首项均无需滚动即可看到，方向键与 Tab 仍沿用连续结果顺序。

## Follow-up Polish

- P3：如果后续提供精确 Figma Token，可进一步微调引用单元的蓝灰色与圆角；当前实现已复用项目既有视觉语言，不影响验收。

final result: passed

---

# 工作区导航顺序与 AI 羽毛图标 — 2026-09-03

## Evidence

- Source visual truth: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-998d0f84-cb0c-47e4-ad4c-a8f8447b8464.png` 提供对话页蓝色羽毛的轮廓参考；用户文字要求导航顺序改为“我的简历、简历模板、AI 助手、求职中心、资料库”，并要求重新生成黑白线性版本，不直接复用原图。
- Generated asset: `apps/web/src/assets/assistant-feather-outline.png`，`128 × 128` RGBA 透明底；使用内置图片生成生成新线稿后，按实际 16px 导航槽位裁切缩放。
- Implementation route: `http://127.0.0.1:5173/assistant`，Chrome 已登录桌面状态，AI 助手为激活项。
- Implementation screenshots: `/private/tmp/linkcv-navigation-feather-active-full.png` 与聚焦导航区域 `/private/tmp/linkcv-navigation-feather-active.png`。
- Combined comparison: `/private/tmp/linkcv-navigation-feather-comparison.png`，左侧是来源羽毛，右侧是实际导航激活态。

## Findings

没有剩余 P0/P1/P2 问题。

- 顺序：五个一级导航按用户指定顺序排列，模板已移到 AI 助手之前；路由、预加载和当前页标记保持不变。
- 激活色：AI 助手使用独立的亮青色 Token，和“我的简历”的蓝色、模板紫色、求职中心橙色、资料库绿色形成清晰区分。
- 图标：AI 助手不再使用 `Sparkles`，改为新生成的透明底黑色羽毛线稿；保留来源羽毛的倾斜方向和细长轮廓，但没有复用蓝色像素或填充样式。
- 尺寸与清晰度：资产按 16px 槽位重新裁切，羽毛主体接近占满高度，和相邻 Lucide 图标的视觉重量一致；深色模式通过反色保持可见。
- 可访问性：图标保持装饰语义，链接仍以“AI 助手”作为可访问名称。

## Interaction Evidence

- 登录态浏览器中点击 AI 助手后进入 `/assistant`，该项正确获得当前页状态。
- 浏览器结构确认五个链接的 DOM 顺序与指定顺序一致。
- 组件测试覆盖导航 href 顺序以及 AI 助手使用新羽毛图片资产。

## Comparison History

1. 初次生成得到透明底黑色羽毛线稿；按 alpha 内容边界裁切并缩放到 `128 × 128` 项目资产。
2. 首次导航截图显示羽毛主体留白略多；再次按真实 alpha 边界收紧，使 16px 下的主体高度从约 13px 提升到约 15px。
3. 合并参考与最终实现复核后，方向、轮廓、黑白线性表达、导航顺序和相邻间距均符合目标。

## Follow-up Polish

- P3：位图在极高缩放倍率下不如 SVG 锐利，但当前 16px 产品尺寸清晰；本轮遵循用户“重新生成”要求保留生成资产，不另做手绘 SVG 替代。

final result: passed

---

## 求职详情记录卡片 — 2026-09-01

### Visual truth and evidence

- Source visual truth: `/Users/fang/.codex/generated_images/01a0586a-25e6-7c21-b13a-8f0eb8f55d24/exec-9e20a740-0523-4238-8eb1-a3702c8d6b28.png`，即用户确认的第 3 版原型。
- Implementation: `http://127.0.0.1:5173/career/applications/34`，真实状态为 1 条已完成笔试和 1 条文字记录。
- Implementation screenshot: `/var/folders/q0/866dc7b55j3c61s7h1hfx1r40000gn/T/linkcv-record-card-final.png`；原型与实现聚焦对照：`/var/folders/q0/866dc7b55j3c61s7h1hfx1r40000gn/T/linkcv-record-card-comparison.png`。
- Desktop viewport: `1470 × 837` CSS px；窄屏 viewport: `390 × 844` CSS px。原型像素尺寸为 `1450 × 1085`。
- Full-view comparison: 核对求职进度、记录区与右侧岗位信息之间的宽度、层级和留白；聚焦比较按记录区裁切并归一化宽度。

### Required fidelity surfaces

- Typography: 卡片标题保持 16px/650，时间、记录摘要、状态与操作使用项目既有 12px 层级；文字层级与确认稿一致。
- Spacing and layout: 桌面端使用图标、名称时间、记录摘要、状态、操作五段单行布局；卡片最小高度 76px，详情页实际密度为 92px，避免此前内容堆叠和过宽空白。
- Colors and tokens: 白色表面、细灰边框、蓝色操作、绿色完成态全部复用 `--ui-*` Token；没有新增独立色板或阴影。
- Icons and assets: 笔试使用 Lucide `FileText`，面试使用 Lucide `Video`；完成态只由状态标签表达，不在图标右下重复叠加勾号。录音附件使用 `FileAudio`，没有使用字符、emoji 或 CSS 伪造图标。
- Copy and content: 笔试卡片显示“查看笔试记录”，面试卡片显示“查看面试记录”；状态只显示“已完成/待进行”，不再重复记录类型。

### Interaction and responsive evidence

- 真实浏览器核对 `/career/applications/34`：卡片显示“笔试 / 9月8日 14:44 · 线上 / 已添加文字记录 / 已完成 / 查看笔试记录”。
- 390px 窄屏下卡片切换为两列四行的紧凑信息栅格，文字、状态和查看入口均保留；页面 DOM 中操作按钮仍可访问。
- 浏览器日志只有 Vite 连接与 React DevTools 信息，无 error 或 warning。
- 组件测试补充笔试与面试 `data-record-kind` 分支断言，防止两种记录回退为同一图标。
- 详情页使用 585 字虚构记录和虚构 MP3 验证真实长内容：默认显示 5 行摘要，可展开/收起全文；录音加载后播放器留在对应附件卡片内，名称、来源、播放、下载和删除保持在同一信息组。
- 390px 窄屏复核中，录音操作自动换到附件信息下方，文字卡片标题与编辑/删除操作纵向排列，无页面级横向溢出。

### Comparison history

1. 第一轮实现与原型并列比较发现状态胶囊重复显示“笔试 · 已完成”，并且已完成笔试图标缺少绿色完成标记。
2. 修复：状态胶囊只保留状态文字，并保持笔试/面试主图标独立。用户复核后移除右下完成勾号，避免装饰与状态标签重复。
3. 详情页真实长内容暴露 P1：文字被压成单行省略，录音附件成为过薄且拥挤的文件行。修复为多行可展开文字卡片和带内嵌播放器的独立音频卡片。
4. 修复后再次核对桌面、展开全文、播放录音与 390px 窄屏状态；未发现剩余 P0/P1/P2 问题。

### Implementation checklist

- [x] 桌面端单行紧凑布局。
- [x] 笔试与面试使用不同图标。
- [x] 完成态只使用状态胶囊表达，不叠加装饰勾号。
- [x] 查看入口按记录类型切换文案并保留原导航行为。
- [x] 长文字提供多行摘要和展开/收起全文。
- [x] 录音附件使用独立卡片并在卡片内展示播放器。
- [x] 390px 窄屏无信息丢失。
- [x] 浏览器日志、组件测试与 TypeScript 检查完成。

### Follow-up polish

- P3: 当前真实页面只有笔试数据，因此面试图标分支由组件测试覆盖；后续有真实面试记录时可再做一次同路由视觉复核。

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

---

# 2026-08-23 404 页面 Design QA

final result: passed

## Comparison target

- Source: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-66ddcd04-6aed-43d4-8511-b18972b0fa1b.png`
- Implementation: `http://127.0.0.1:5174/missing-page`
- Final capture: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/linkcv-404-691x572-final.png`
- Source pixels: 691 × 572; implementation pixels: 691 × 572; CSS viewport: 691 × 572.
- Both artifacts show the default desktop 404 state. The implementation intentionally uses LinkCV background and text tokens plus Chinese copy.

## Iterations

1. Initial comparison found the content group too high relative to the reference and the home action implemented as button navigation. Result: blocked (P2).
2. Increased the top visual inset, retained responsive centering, and changed the action to a real `/` link using the shared button styles. The final same-size comparison has no remaining P0, P1, or P2 differences. Result: passed.

## Fidelity review

- Typography: hierarchy and weights match the reference; Chinese copy uses the project UI font stack.
- Spacing: icon, code, title, description, and action follow the reference rhythm at the same viewport.
- Colors: intentionally adapted to `--ui-background`, `--ui-foreground`, and muted project tokens.
- Image quality: no raster assets are required; the face and arrow use the project's configured icon library and remain sharp.
- Copy: localized, concise, and action-oriented; the home destination is `/`.
- Motion: the face sways between -15° and 15° using only `transform`; a reduced-motion rule disables the loop.
- Responsive: 1024 × 768 and 390 × 844 checks show no horizontal overflow or clipping.

No focused crop was needed because every fidelity-critical element is large and legible in the full-view, same-size comparison.

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

---

# 登录页左侧微信扫码样式 — 2026-08-24

**Source visual truth**

- Path: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-023030af-5bac-4fc9-8aa7-e8f43318deae.png`
- Source pixels: 640 × 674 at 1× density.
- State: WeChat QR waiting state, left login region only.

**Rendered implementation**

- URL: `http://127.0.0.1:5180/login`
- Desktop screenshot: `/tmp/linkcv-auth-waiting-1440-final.png` at a 1440 × 900 CSS viewport and 1× density.
- Responsive screenshots: `/tmp/linkcv-auth-waiting-1024-final.png` and `/tmp/linkcv-auth-waiting-390-final.png`.
- Comparison image: `/tmp/linkcv-auth-design-comparison.png`.
- Normalization: the 640 × 674 source was resized to 654 × 689; the implementation's 654 × 689 left-panel content region was cropped from the 1440 × 900 screenshot. Browser chrome and the unchanged right visual region were excluded.

**Full-view comparison evidence**

- The left region follows the source order and proportions: eyebrow, single-line desktop heading, explanatory copy, isolated circular QR area, then the shield security hint.
- The previous card background, border, padding shell, and square QR frame are absent. The QR image is clipped by the circular holder and uses only the existing light elevation token outside the image.
- The unchanged right visual region remains present in the full desktop screenshot. At 1024 px the heading wraps within the narrower left track; at 390 px the left region remains readable and precedes the existing stacked right region without horizontal overflow.

**Focused region comparison evidence**

- The entire left panel was used as the focused region because all requested changes are confined there. In `/tmp/linkcv-auth-design-comparison.png`, the source is on the left and the normalized implementation is on the right.
- Typography: existing LinkCV display and body fonts are retained; hierarchy, weight, line height, and wrapping match the reference intent.
- Spacing: desktop left inset, content width, QR scale, and the security-hint position align with the source. Responsive spacing contracts without overlapping the QR image.
- Colors and tokens: existing surface and muted-text tokens are retained; no new page palette was introduced.
- Image quality: the browser check used a temporary crop of the supplied QR as controlled API fixture data, while production continues to render the real backend-provided `qr_base64`. The image has explicit dimensions, high fetch priority, circular clipping, and no overlay layer.
- Copy: title and explanatory copy are unchanged; the waiting hint now matches the reference's security message.

**Comparison history**

- Initial finding [P2]: the QR state still inherited the old centered content column, leaving the left content visibly lower and farther right than the source; the circular elevation was also too pronounced.
- Fix: added a WeChat-only top reading flow and narrower left-aligned content track, removed the surrounding card shell, and replaced the custom shadow with `--ui-shadow-md`.
- Post-fix evidence: `/tmp/linkcv-auth-waiting-1440-final.png` and `/tmp/linkcv-auth-design-comparison.png` show the corrected desktop alignment and unobstructed QR image. No actionable P0/P1/P2 mismatch remains.

**Browser checks**

- Checked 1440 × 900, 1024 × 768, and 390 × 844.
- Verified the waiting-state QR image, security hint, pending polling state, and existing responsive stacking.
- A fresh browser tab reported no console errors with the controlled local API fixture.
- The external WeChat scan-and-confirm step was not executed; this visual task does not change that API or polling behavior, which remains covered by existing component tests.

**Findings**

- No actionable P0/P1/P2 findings remain.
- P3: minor raster softness comes from the supplied screenshot crop used only for visual QA; it is not shipped by the application.

**Implementation Checklist**

- [x] Remove the QR card overlay and square framing.
- [x] Match the source's desktop composition and responsive behavior.
- [x] Preserve API, polling, password-login, and right-region behavior.
- [x] Verify automated checks, browser rendering, and console state.

final result: passed


---

# 小程序登录与扫码确认页 — 2026-08-26

## 验收范围

- 页面：`pages/login/index` 的未注册、已注册、加载和错误状态；`pages/confirm/index` 的待确认及结果状态。
- 视觉基准：用户上传的登录/注册参考图 `/var/folders/q0/866dc7b55j3c61s7h1hfx1r40000gn/T/codex-clipboard-35c725a0-06d2-4e0b-a80f-a93254b92e66.png`（382 × 862）。
- 实现预览：微信开发者工具 iPhone 12/13 Pro 模拟器（390 × 844），未注册状态已在工具会话内完成整屏视觉核对；该临时截图未作为仓库文件保存。
- 密度处理：以完整视口的相对位置、留白比例、控件宽高和排版层级比较；参考图与模拟器宽度差异为 8 px，未按绝对像素一一映射。

## 对比结果

| 区域 | 结果 | 说明 |
| --- | --- | --- |
| 页面骨架 | 通过 | 白色全屏、左上关闭、中部身份区、主操作和底部协议的纵向层级与参考图一致。 |
| 品牌区 | 通过 | 使用用户提供的透明底羽毛图标，保留浅边框、圆角和轻阴影容器。 |
| 标题与说明 | 通过 | 未注册态采用“开启职场新篇章 / 创建一个账户，发现更多职业机遇”；注册态和确认态复用同一视觉层级。 |
| 主操作 | 通过 | 黑底白字、整行宽按钮及圆角比例与参考图一致；协议未勾选时继续沿用原有禁用语义。 |
| 隐私协议 | 通过 | 固定在页面下部并保留微信动态隐私指引名称、打开协议和授权处理逻辑。 |
| 扫码确认 | 通过（结构） | 已统一到同一页面骨架，确认、取消、重试及结果状态的原有行为入口均保留。 |
| 短屏适配 | 通过（样式检查） | 小于 700 px 高度时收紧身份区、操作区和协议区的垂直间距。 |

## 修正记录

1. 首轮预览发现原生 `button` 的默认盒模型使关闭图标偏向页面中部，严重度 P2。
2. 将关闭控件改为可访问的 `view + icon`，保留点击行为和语义标签，并重新预览确认其回到左上安全区。
3. 最终未发现 P0、P1 或 P2 视觉问题。

## 限制

- 登录/注册页与扫码确认页均已在微信开发者工具的分离 iPhone 12/13 Pro 模拟器中呈现并核对；确认页截图为 `/var/folders/q0/866dc7b55j3c61s7h1hfx1r40000gn/T/com.openai.sky.CUAService/Wechat Devtools Screenshot 2026-08-26 at 3.04.17 PM.jpeg`。
- 本次没有接入真实微信身份和真实网页扫码会话，因此不把本次结果描述为自动化跨端 E2E 验收。

## 品牌图标替换复核

- 来源资产：`/var/folders/q0/866dc7b55j3c61s7h1hfx1r40000gn/T/codex-clipboard-a4262b33-285e-41e3-aa2b-324f43eeae5f.png`，透明底 `256 × 256`；用户同时提供的第二张方形图与该文件 SHA-256 完全相同。
- 实现截图：`/var/folders/q0/866dc7b55j3c61s7h1hfx1r40000gn/T/com.openai.sky.CUAService/Wechat Devtools Screenshot 2026-08-26 at 3.05.00 PM.jpeg`，微信开发者工具 iPhone 12/13 Pro 登录页未注册状态。
- 聚焦对比：`/tmp/linkresume-mark-design-qa.png` 将原始图标与登录页品牌卡片渲染结果并列归一化到 `256 × 256`；轮廓、透明背景、完整羽毛与环形笔画均正确，未发现裁切、变形或黑底。
- 使用范围：方形标替换登录、扫码确认、首页、简历列表和个人资料页的品牌入口；横向 `LinkResume` 字标不压缩进方形登录卡片。
- 修正记录：开发者工具最初命中旧文件缓存，改为新的 `linkresume-mark.png` 资源路径并清理项目文件列表缓存后，分离模拟器复核通过。
- 最终未发现 P0、P1 或 P2 视觉问题。

## 结论

通过。参考图覆盖的登录/注册主状态没有未解决的 P0—P2 视觉偏差；扫码确认页完成同语言重构，但仍需在真实扫码会话中做一次人工端到端核验。

final result: passed

# LinkResume 小程序品牌字标 — 2026-08-26

## Visual truth and evidence

- Source asset: `/Users/fang/Downloads/LinkCV-app-icons/web-brand-wordmark-1701x349.png`，原图 `1701 × 349` px、RGBA 透明背景；有效像素边界为 `(20, 20)–(1681, 329)`。
- Implementation asset: `apps/miniprogram/assets/linkresume-wordmark.png`，逐文件复用用户提供的原始 PNG，没有重绘或生成替代图标。
- Actual runtime capture: `/Users/fang/.codex/visualizations/2026/08/26/01a03cbe-fff8-73c3-9f80-d9a13eb0527a/miniprogram-brand-qa/resumes-linkresume-wordmark.png`，微信开发者工具 iPhone 15 Pro Max 模拟器、访客态“我的简历”页。
- Focused comparison: `/tmp/linkresume-brand-comparison.jpg`，同屏比较原始字标与小程序顶部真实渲染区域。

## Required fidelity surfaces

- Asset fidelity: 小程序顶部使用 `220 × 46rpx` 的 `aspectFit` 容器；登录页与扫码确认页使用 `320 × 66rpx` 的 `aspectFit` 容器，均保持原始约 `4.87:1` 的长宽比。
- Rendering: 真实模拟器截图中图形、`LinkResume` 字标和透明背景均完整可见，没有拉伸、裁切、模糊底色或错误反色。
- Accessibility: 品牌图片暴露 `LinkResume` 可访问名称；微信开发者工具可访问性树识别为 `image LinkResume`。
- Copy consistency: 小程序导航标题、登录与扫码确认文案、访客空状态、简历详情、隐私协议兜底名称和项目说明中的可见产品名统一为 `LinkResume`。
- Compatibility: `linkcv_*` 本地存储键、包名、项目技术标识和示例域名保持不变，避免品牌展示替换破坏已有数据与运行契约。

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: 登录页与扫码确认页使用同一原始资产和同一 `aspectFit` 策略，已通过编译与样式检查；本次真实模拟器截图聚焦默认访客简历页，发布前仍可在真机上补一次两个入口页的视觉巡检。
---

# 求职进程五列看板 Design QA

## Evidence

- Source visual truth: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-5b314263-5205-4caf-969f-8963e5e49eb3.png`
- Browser-rendered implementation: `/private/tmp/linkcv-career-progress-qa/implementation-career-progress-source-size.png`
- Full-view comparison: `/private/tmp/linkcv-career-progress-qa/career-progress-design-comparison.png`
- Focused board comparison: `/private/tmp/linkcv-career-progress-qa/career-progress-focused-comparison.png`
- Responsive captures:
  - `/private/tmp/linkcv-career-progress-qa/implementation-career-progress-mid.png`
  - `/private/tmp/linkcv-career-progress-qa/implementation-career-progress-narrow.png`
- Route: `http://127.0.0.1:5174/career/applications`
- State: signed-in Development session, empty real application list using the existing development mock projection.
- Source pixels: 1379 x 861. Implementation pixels: 1378 x 860. Both use CSS density 1; the implementation was normalized by one pixel in each dimension for the side-by-side comparison.

## Findings

No actionable P0, P1, or P2 mismatch remains.

- Fonts and typography: the implementation retains the project Inter/PingFang stack, compact 9-13px board hierarchy, medium company-name weight, numeric emphasis, single-line role truncation, and title tooltips. The hierarchy remains readable at the requested desktop widths.
- Spacing and layout rhythm: the title/navigation/tool stack is compact, the summary is one 84px surface, the board uses five equal tracks with 10-12px gaps, and cards use restrained 8-11px internal rhythm. The five-column board does not overflow at the measured 1435px and 1216px browser content widths. At 818px it intentionally becomes a horizontally scrollable five-column track without creating page-level overflow.
- Colors and tokens: warm neutral canvas, white surfaces, near-black primary action, career orange selection/drop emphasis, existing semantic success/warning/accent colors, fine borders, and minimal elevation all map to existing `--ui-*` tokens. Stage color is restricted to small low-saturation badges.
- Image quality and assets: the existing LinkResume wordmark and account avatar remain unchanged. Cards use the existing company-initial avatar treatment allowed by the brief; all UI icons come from the existing Lucide dependency. No replacement CSS art, emoji, handcrafted SVG, gradient, or placeholder asset was introduced.
- Copy and content: title, description, four subnavigation items, metrics, five stage labels, mock company/job data, dates, next actions, and one-/two-round labels match the requested content model. The five-column grouping intentionally changes counts relative to the seven-column reference while preserving the underlying stage values.
- Interaction states: list/board switching, search, filter popover, and new-process dialog were exercised in the browser. Searching `字节跳动` returned three cards; the dialog opened and closed without submission. Drag transition semantics are covered by component tests and use the existing advance endpoint; destructive/ambiguous end-state drops remain read-only and direct the user to details.
- Console: no browser console errors were present after the interaction pass.

## Full-view comparison evidence

The side-by-side full view confirms the same global shell, title/tool placement, horizontal summary weight, five-column proportions, card density, and restrained surface treatment. The implementation differs only where the written brief overrides the screenshot: screening/communication are merged into `待推进`, interview rounds are merged into `面试中`, and one-/two-round identity moves to card badges.

## Focused region comparison evidence

The focused comparison covers subnavigation, summary icons/numbers/dividers, the first three columns, card avatar/title/role hierarchy, stage badges, metadata rows, add actions, and empty-column behavior. Text, borders, radii, and spacing remain visually consistent with the supplied target and current LinkCV design system.

## Comparison history

- Pass 1: no actionable P0/P1/P2 finding was identified, so no visual-fix iteration was required. The same browser state was used for the full-view and focused comparisons.

## Implementation checklist

- [x] Five-column board projection without changing backend stage values.
- [x] One-/two-round labels preserved on interview cards.
- [x] Four metrics combined into one horizontal summary surface.
- [x] Search, filter, sort, list/board switch, create and detail entry retained.
- [x] Forward drag uses the existing API; same-column, reverse, mock and ambiguous end-state drops do not perform unsafe writes.
- [x] 1200+ desktop layout remains free of horizontal overflow; narrow view scrolls inside the board.
- [x] Browser interaction and console checks completed.

## Follow-up polish

No P3 follow-up is required for this pass.

final result: passed

---

# 求职进程卡片像素对照 — 2026-08-26

## Evidence

- Reference: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-02afc6db-3ce5-4f4a-a158-8350dc63f911.png`
- Route: `http://127.0.0.1:5174/career/applications`
- Comparison viewport: `1355 × 649`
- Comparison artifact: `/private/tmp/linkcv-career-design-comparison.png`

## Visual checks

- Summary bar remains one low-weight horizontal surface with four evenly divided metrics.
- The board uses five equal columns with compact headers and no top add button.
- Cards match the reference structure: 28px avatar, company and role copy, trailing stage badge or drag handle, and a single metadata row.
- Card height, padding, border, radius, spacing, muted text, and low-saturation stage badges match the reference composition.
- The interview column includes the reference-style `全部 / 一面 / 二面` tab row and orange active underline.
- Existing data counts and company abbreviations remain data-driven; they are not replaced to mimic screenshot values or logos.

## Interaction checks

- Switching the interview filter to `二面` shows two matching cards and marks the tab pressed.
- Switching back to `全部` restores all six interview cards.
- Existing drag, create, edit, search, status update, sort, and board/list handlers remain wired to the original application logic.

## Automated checks

- `npm exec vitest run src/features/interviews/InterviewCenterPage.test.tsx`: 20 passed.
- `npm run typecheck`: passed.
- `git diff --check`: passed.

final result: passed

---

# 求职进程独立阶段与横向看板修正 — 2026-08-26

## Scope and source

- Reference card design: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-02afc6db-3ce5-4f4a-a158-8350dc63f911.png`
- Route opened in Chrome: `http://127.0.0.1:5174/career/applications`
- This pass changes only the board projection, horizontal browsing behavior, related styles, and component tests. It does not change API contracts, backend state values, or persistence models.

## Layout and visual checks

- The seven required base stages are separate columns: `筛选中 / 等待沟通 / 一面 / 二面 / HR 面 / Offer / 已结束`.
- Real additional labels such as `笔试` and `三面` produce additional independent columns instead of being folded into a generic interview column.
- At normal desktop widths, each column reuses the former five-column footprint (`calc((100vw - 88px) / 5)`, clamped to `252–292px`) with a `12px` gap. The first five stages therefore fill the initial board viewport, while stage count only extends the horizontal track and never participates in width calculation. At `900px` and below, columns remain `292px` and scroll horizontally instead of compressing.
- Horizontal overflow is owned by the board surface. Its content grid uses `width: max-content`, while the surface remains constrained by `max-width: 100%` and `min-width: 0`.
- Cards retain the previously accepted compact reference styling: white surface, fine border, 10px radius, 28px company avatar, stable 80px minimum height, restrained hover elevation, clear company/role/time hierarchy, and low-saturation stage badges.
- The summary remains one low-weight horizontal surface. No gradient, glass effect, heavy shadow, page-level carousel button, or per-column vertical scroller was introduced.

## Interaction checks

- Trackpad horizontal scrolling remains native through `overflow-x: auto`.
- `Shift + wheel` translates vertical wheel delta into board horizontal movement.
- Primary-button dragging on non-interactive blank board space pans horizontally; card buttons and draggable cards are excluded from panning capture.
- Dragging a card near either board edge starts low-speed horizontal auto-scroll and stops on drag end or drop.
- Board scroll position is persisted in `sessionStorage` and restored when the board mounts again.
- Drop transitions use the target column's real `stage_type`, `round_no`, and `stage_label`; same-column, reverse, ended, and not-ready transitions remain protected. Empty real datasets continue to show the product empty state instead of mock cards.

## Automated evidence

- `npm run test:web`: 57 files and 485 tests passed.
- `npm run typecheck` in `apps/web`: passed.
- `npm run build:web`: passed; only the repository's existing Vite large-chunk advisory was emitted.
- `UV_CACHE_DIR=/private/tmp/linkcv-uv-cache npm run check:design`: passed.
- `git diff --check`: passed.
- Component coverage includes independent base columns, dynamic `笔试/三面` columns, real first-/second-round transition payloads, scroll restoration, Shift+wheel, blank-space panning, and drag-edge auto-scroll.

## Browser QA limitation

- The local route loaded successfully in Chrome. Programmatic DOM measurement was unavailable because Chrome has `Allow JavaScript from Apple Events` disabled.
- A full-screen capture was intentionally not taken because it could include unrelated windows or sensitive screen content. The card visual remains covered by the preceding reference/implementation comparison; this pass's new layout and interaction contracts are covered by source inspection, focused component tests, full Web regression, typecheck, and production build.

final result: passed

---

# 日期时间选择器设计 QA

- source visual truth path: `/Users/jixu/.codex/generated_images/01a074c0-01f0-7381-84af-765f32909409/exec-eb1a7719-8023-47ea-a65b-487424bfb8a3.png`
- implementation screenshot path: `/Users/jixu/.codex/visualizations/2026/09/06/01a074c0-01f0-7381-84af-765f32909409/date-time-picker-implementation.jpg`
- full-view comparison: `/Users/jixu/.codex/visualizations/2026/09/06/01a074c0-01f0-7381-84af-765f32909409/date-time-picker-comparison.jpg`
- focused comparison: `/Users/jixu/.codex/visualizations/2026/09/06/01a074c0-01f0-7381-84af-765f32909409/date-time-picker-focused-comparison.jpg`
- source pixels: `1586 x 992`
- implementation pixels: `948 x 1018`
- implementation CSS viewport: `948 x 1018`, `devicePixelRatio: 1`
- final dialog size: `900 x 860` CSS px
- final picker size: `548 x 304` CSS px
- normalization: full view按各自完整画面等比缩放后并排；聚焦对照裁切同一日期时间选择器区域，再分别等比缩放到统一对照面板。来源图没有可恢复的 CSS viewport 或 devicePixelRatio，因此不做伪精确的像素级断言。
- state: 求职阶段弹窗选择“笔试”，结束时间选择器展开，日期为 `2026-09-06`，时间为 `14:30`。

## Findings

- 当前没有可执行的 P0/P1/P2 差异。
- 字体与排版：沿用 LinkCV 现有字体栈与字号 Token；标题、星期、日期、字段标签和结果摘要的层级与参考一致，没有截断或异常换行。
- 间距与布局：实现采用左日历、右时间的双栏结构，底部次要操作与主操作分组；弹层不再与外层操作栏重叠。真实表单保留产品已有的“投递日期”字段，所以外层内容密度高于参考图，这是业务结构约束，不属于选择器漂移。
- 颜色与 Token：边框、弱背景、蓝色选中态和黑色主按钮均复用项目 Token，视觉语义与参考一致。
- 图片与资产：选择器没有图片资产；图标继续使用项目既有 `lucide-react` 图标，没有 CSS 图形或自制 SVG 替代。
- 文案与内容：保留“时间 / 快捷选择 / 已选择 / 清除 / 今天 / 确定”。参考图在 `14:30` 结果下仍高亮 `14:00` 快捷项，状态彼此矛盾；实现只在时间精确匹配快捷值时高亮，避免误导。
- 交互与可访问性：小时和分钟使用有标签的 combobox/listbox；快捷时间使用可感知选中状态；确认按钮在日期和时间完整前禁用；Escape 和外部 pointer down 可关闭弹层。

## Comparison history

1. 首次真实页面对照发现 P2：业务表单比参考多一行“投递日期”，弹层底部进入外层弹窗操作栏区域。修复为打开选择器时把内部可滚动面板调整到刚好容纳完整弹层。修复后证据：选择器底边 `861.6875`，外层操作栏顶边 `862`，无重叠。
2. 第二次聚焦对照发现 P2：“确定”按钮被旧的 footer 通用选择器覆盖，显示为透明文字按钮。提高主按钮样式作用域并恢复 `120 x 40` 的深色主操作。最终聚焦对照显示按钮、双栏、摘要和 footer 与参考结构一致。

## Open Questions

- 无阻塞问题。来源图与浏览器窗口尺寸不同，因此最终判断基于同状态的完整画面和归一化聚焦区域，而不是未经证实的 1:1 像素匹配。

## Implementation Checklist

- [x] 双栏日期与时间布局
- [x] 小时、分钟下拉选择
- [x] `09:00 / 14:00 / 18:00` 快捷时间
- [x] 已选结果摘要
- [x] 清除、今天、确定操作
- [x] 真实业务弹窗内无重叠
- [x] 组件测试、类型检查和生产构建

## Follow-up Polish

- 移动端使用单列堆叠布局；本次来源只提供桌面视觉，未把移动端与未提供的移动稿做视觉像素对照。

final result: passed

---

# Time Range Picker Design QA

- Source visual truth: `/Users/jixu/.codex/generated_images/01a08ea8-b2f0-76e0-abc8-9fbdaae56825/exec-7e6d9d0e-a6bc-4ffa-b4c9-deced388588b.png`
- Initial implementation evidence: `/var/folders/hz/b8t5g29j71b5cpf22bvdflgw0000gn/T/codex-clipboard-0fec07fa-68d2-4f1e-b203-4a9ed8340186.png`
- Revised implementation evidence: inline CUA browser capture from `http://127.0.0.1:5174/career/applications` (the CUA screenshot API did not expose a filesystem path)
- Browser viewport: 1920 × 1022 CSS px, device scale factor 1
- Source image: 1398 × 1125 px
- Focused implementation capture: 750 × 500 px crop from the 1920 × 1022 viewport
- State: written-test record detail, answer-plan picker open, 2026-09-12 at 14:00, duration 2 hours

## Full-view comparison evidence

The revised picker follows the source composition: a contextual title and available-window notice sit above a two-column calendar/time layout; the start-time selector, four duration choices, derived end time, and footer actions are all visible without viewport overflow. The surrounding production dialog remains at its existing width, so the picker scales to that dialog rather than copying the mock's wider outer frame.

## Focused-region comparison evidence

The focused browser capture confirms that the native time input and clock affordance are gone. The start time is now a single text-capable combobox with a chevron and a 15-minute option list, while still accepting exact `HH:mm` input. The four duration choices share one row, and the summary separates the highlighted end time from the total duration. The official availability window uses the same blue information treatment as the source.

## Required fidelity surfaces

- Fonts and typography: existing LinkCV font stack, label hierarchy, numeric tabular alignment, and source-like weights retained.
- Spacing and layout rhythm: two-column ratio, full-width contextual header, four-column duration row, summary spacing, and footer separation now match the source hierarchy.
- Colors and visual tokens: existing LinkCV surface, border, accent, muted text, and primary-button tokens map cleanly to the source.
- Image quality and assets: no raster assets are required inside this control; the information and chevron icons use the project's existing Lucide icon set.
- Copy and content: `选择作答时间段`, `可安排`, `开始时间`, `预计时长`, `结束时间`, and total-duration copy match the selected design intent.

## Comparison history

1. Initial P1: duration mode still used a native `type="time"` field with a clock icon, retained the old quick-time row, and stacked the custom duration control. Fixed by introducing the source-aligned start-time combobox, removing quick times in duration mode, and using four equal duration choices.
2. Initial P2: picker width and vertical rhythm were too compact, and the record dialog clipped the footer and fourth duration choice. Fixed by using a wider maximum picker, restoring calendar row height, and portalling the picker to the record dialog with visible overflow and a dialog-aligned width.
3. Post-fix browser evidence: picker measured 670 × 423 px inside the existing 720 px record dialog; it stayed within the 1920 × 1022 viewport, displayed all four duration controls and the full footer, and contained no native time input.

## Findings

No actionable P0, P1, or P2 visual differences remain within the requested picker scope. The outer record dialog intentionally preserves the production LinkCV width instead of adopting the wider mock frame.

## Primary interactions tested

- Open and close the answer-plan picker without saving.
- Open the start-time dropdown and select 14:00.
- Verify the derived end time updates to 16:00 for a two-hour duration.
- Switch to a custom 90-minute duration and verify the derived end time updates to 15:30.
- Confirm the picker has no viewport overflow and does not persist draft changes when closed.

## Implementation checklist

- [x] Replace native duration-mode time input.
- [x] Match source information hierarchy and duration controls.
- [x] Preserve exact-minute typing and keyboard-accessible combobox semantics.
- [x] Prevent record-dialog clipping.
- [x] Verify the rendered Development route.

final result: passed
