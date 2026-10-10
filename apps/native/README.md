# DrawOffer 原生桌面客户端

`apps/mac` 是 SwiftUI 客户端，`apps/windows` 是 WinUI 3 客户端。界面使用系统控件，仅简历纸面嵌入离线网页视图，复用 Web 的 `renderResumePrintDocument`；`apps/desktop` 的 Electron 壳是独立线路。

正式 App 注入 desktop Bearer HTTP 客户端，支持微信扫码、手机确认后的领取、启动恢复、续期与退出。Mac 与 Windows 均直接进入工作区首页：未登录或恢复失败时仍可浏览随包提供的 9 套精选模板与虚构示例，不请求账号资源，不显示未经查询的个人数量；后端模板接口要求登录，所以游客只能看到随包示例，不代表完整在线模板目录。Mac 登录后模板页改为读取 `GET /api/resume-templates` 的真实启用模板（过滤已退役 `blank-cn`，显示使用次数），游客“使用此模板”先登录，成功后回到模板页按模板 key 匹配真实模板并打开创建弹窗。Mac 简历管理与原生编辑器见下文“Mac 我的简历”；Windows 仍只读。退出后清理准备状态并返回游客首页。Mac 的首页卡片、我的简历、模板、岗位看板与岗位详情、面试排期、文字与语音模拟面试、资料库、账号设置与 AI 对话均已使用原生页面接入现有接口，简历编辑覆盖文字格式、版式与模板切换；桌面端不提供注销账号、密码与微信绑定。Windows 仍以看板、排期、模拟面试与资料库为主。Mock 只用于 Core 测试。协议与权限边界见 [桌面会话契约](../../docs/api/http-contracts.md#桌面-bearer-会话)。

## 界面与 Web 对齐

原生外壳以 `origin/dev` 中 `App.tsx` 实际挂载的 `apps/web/src/v3/Shell.tsx` 为准，使用 216px 侧栏和圆角内容面板：品牌、新建对话、首页、我的简历、简历模板、岗位看板、面试日程、模拟面试、资料库、最近对话与账号入口。`WorkspaceLayout.tsx` 的顶部导航不是该入口的视觉基准。原生默认展示首页；游客沿用 Web 空状态层级，示例不计入账号数量。品牌通过纸面构建脚本从 Web 同步；模板使用共享纸面渲染卡片网格与预览弹窗。字号、间距、颜色以 Dev 的 V3 CSS 为依据。AI 首页已实现 Dev 的游客引导布局（问候、输入区、快捷指令和三张引导卡）；Mac 登录后按真实数据生成首页卡片，并接入 AI 对话（见下文）；岗位看板和排期已接入本文说明的求职接口；系统窗口装饰、字体回退、原生控件和 Windows 实机视觉仍需验收，不能据此外壳宣称全部页面已一致。

### 首页引导与输入

首页参考 Dev 的 `AssistantPage.tsx`、`HomeCards.tsx`、`homeDashboard.ts` 与 `assistant.css`，采用 720px 居中正文、120px 输入框、三条快捷指令和三张 236px 引导卡。游客使用 Web 新用户的引导文案，发送与添加资料触发登录，不模拟 AI 回答。Mac 登录后由 Core 的 `HomeDashboard` 移植 Web `homeDashboard.ts` 规则：并行读取本人简历、本周起两周的排期（`start_at/end_at`）与进行中求职进程，三个卡片位依次取 Offer 待回复/今日面试/三天内笔试截止/本周安排，Offer 对比或最近编辑的简历，岗位推荐或求职进度；问候副标题与快捷指令随位置 1 变化。位置 2 的完整度由 Core 的 `ResumeCompleteness` 移植 Web `resumeCompleteness.ts`：从最近编辑简历的预览正文投影 Markdown，按同样 12 项检查与示例上限计分，低于 90 分显示“待完善”卡，点击直接进入原生编辑器。推荐岗位卡读取 `/api/job-matches/recommendations`，可计算时调用 `:ensure`，随后每 3 秒轮询、最多 20 次，各状态与 Web 文案一致。读取失败显示重新加载，不当作无数据。发送按钮把输入带入新的 AI 对话。

首页在右侧内容区水平、垂直居中，正文最大宽度 720px，随窗口宽度收缩；移除页面级滚动容器与固定顶部留白。较矮窗口缩减间距、插图和卡片高度，Mac 支持的最小窗口为 1080×700。Windows 同步尺寸响应，并在过小窗口使用仅缩小的 Viewbox 防止截断，实机视觉仍需验证。输入框内部仍支持长文本编辑。

输入只存当前窗口内存，切换页和取消登录保留；新建对话主动清空，退出或切换账号清空。不会写本地草稿文件或发送到后端。共用 `shared/home/content.json` 与三张引导插图，纸面构建同步到两端；插图源坐标取自 Dev HomeCards，修改后可运行 `node apps/native/scripts/build_home_art.mjs` 重新导出。

### 应用图标

应用图标统一来自 Web 的 `apps/web/src/assets/drawoffer-mark.png`，保留原羽毛 Logo，叠加暖白色 `#F7F5F0` 圆角底板；底板外保留透明，Web 品牌源文件不变。更新品牌后执行 `uv run --directory apps/backend python ../native/scripts/generate_app_icons.py`，同步 Mac 运行时 PNG／ICNS、Windows 多尺寸 ICO 与 Electron 图标副本。Mac `swift run` 也会设置 Dock 图标；生成 `.app` 时须把 `apps/mac/Resources/DrawOffer.icns` 复制到 `Contents/Resources`，并以 `apps/mac/Resources/Info.plist` 作为 `Contents/Info.plist`（已含 `CFBundleIconFile=DrawOffer.icns` 与语音面试所需的 `NSMicrophoneUsageDescription`）；`swift run` 时麦克风授权归属启动它的终端。Windows 同时配置 exe 资源图标与窗口图标；Electron 开发态 Dock 和打包图标均使用更新后的副本。

## 配置与启动

两端从进程环境读取 `DRAWOFFER_API_ORIGIN`，值必须是受信任的 HTTPS origin，不能包含路径、查询、用户信息或 fragment。缺失或非法时显示配置错误，不回退 Mock。仅本机 HTTP 调试可另设 `DRAWOFFER_ALLOW_LOCAL_HTTP=1`，且地址仅限 localhost、127.0.0.1 或 ::1；这不允许远程明文服务。

```bash
npm ci --prefix apps/web
# 按实际本地后端端口配置；后端必须单独按明确的 Local/Development profile 启动。
DRAWOFFER_API_ORIGIN=http://127.0.0.1:8000 DRAWOFFER_ALLOW_LOCAL_HTTP=1 npm run dev:mac
RUN_DESKTOP_KEYCHAIN_TESTS=1 npm run test:mac
npm run test:windows-core
```

Windows PowerShell：

```powershell
$env:DRAWOFFER_API_ORIGIN = "http://127.0.0.1:8000"
$env:DRAWOFFER_ALLOW_LOCAL_HTTP = "1"
$env:RUN_DESKTOP_CREDENTIAL_TESTS = "1"
npm run test:windows-platform
npm run build:native-renderer
cd apps/windows
dotnet build src/DrawOffer.App/DrawOffer.App.csproj -p:Platform=x64 -r win-x64
dotnet run --project src/DrawOffer.App/DrawOffer.App.csproj -p:Platform=x64 -r win-x64
```

后端必须启用 desktop 能力及微信配置，并通过私密配置提供独立的 `AUTH_DESKTOP_RETRY_ENCRYPTION_KEY`。多实例共享该 key；客户端不持有它。小程序确认页必须与 desktop 协议版本匹配。配置细节见 [开发文档](../../docs/ops/development.md)。

## 凭据与并发边界

Mac 的 `KeychainTokenStore` 将 refresh 与恢复 journal 编码成一个 Keychain item，通过 `SecItemUpdate` 原子替换，不先删除；使用仅本机、解锁可访问的属性，不允许鉴权调用弹出系统交互。拒绝访问、损坏记录和保存失败均传播为错误，access 只在保存成功后进入内存。

Windows 的 `CredentialLockerTokenStore` 用 `PasswordVault.Add` 替换同一 resource/account 的完整记录，只将明确的 not-found 视为无登录。Credential Locker 可能漫游，因此 resource 增加本机 MachineGuid 的 SHA-256，防止其他设备自动复用同一 refresh family；它不保证凭据永不漫游，也不向后端发送设备标识。读取设备标识失败时停止接入。

App 共享一个会话协调器。Mac 窗口共享该实例；两端 App 的进程租约拒绝第二个进程争用凭据（Mac flock、Windows 当前用户命名 Mutex）。Core 的单次续期合并仅适用于单个协调器，直接调用 Core 的其他宿主也必须保证单个凭据 scope 的唯一所有者。

取消领取等待者不会取消共享领取；保存失败可以沿用同一 challenge 重试。业务 401 最多续期并重试一次，再次 401 清理登录态。退出先禁用本地会话，拒绝迟到写回；清理失败仍尝试远端撤销，远端失败保留进程内恢复证明供重试。该退出恢复信息不跨进程持久化，因此远端撤销未确认时不应强制结束进程。

## 验证入口与限制

Mac 测试脚本兼容 CLT 的 Testing 框架路径，并在 CLT 残留旧 PackageDescription 私有接口时只修正临时副本，不修改系统文件。Windows Core 可在 macOS 上用 .NET 10 测试；WinUI XAML 编译与 Credential Locker 实机测试需要 Windows。平台测试使用唯一虚构 scope，并在 finally 清理；Mac 真实 Keychain 测试需显式设置 `RUN_DESKTOP_KEYCHAIN_TESTS=1`，Windows 需 `RUN_DESKTOP_CREDENTIAL_TESTS=1`，未启用时跳过。

`.github/workflows/native-desktop.yml` 配置 Mac 编译/Keychain、Windows Core/Credential Locker/App 构建以及隔离真实 Redis 验证。工作流配置存在不代表远端运行已通过，也不替代手机和桌面 GUI 验收。

实际微信扫码、手机取消与确认、重启恢复、休眠唤醒、双窗口、第二进程、凭据库拒绝访问仍需在对应系统和实际服务上验收。Mac 未签名/公证，Windows 未打签名 MSIX 包；小程序发布、后端部署和正式密钥分发属于独立发布操作。

纸面暂未内嵌字体，Mac 回退 PingFang、Windows 回退 Microsoft YaHei，字形与 PDF 可能有差异。私有图片由原生层携 Bearer 下载并注入纸面 assets，离线网页视图不持有凭据。


## 纸面预览契约

原生离线入口与 Web／PDF 加载相同的基础、应用、打印及 Muse 样式，复用 `renderResumePrintDocument`，使用同一份 canonical data、template snapshot 与 layout_plan。内容、模块顺序、模板结构、配色、图片及关键布局应保留；这不是字形、换行、分页或像素一致的承诺。Mac 使用 WebKit，Windows 使用 WebView2，最终 PDF 由 Chromium 生成，并使用其内嵌字体。最终排版以生成的 PDF 为准，原生模板舞台常驻显示差异提示。

原生预览为可滚动的连续纸面，不模拟 PDF 的物理分页。页面等待图片解码与字体就绪后上报高度，两端舞台使用该高度，避免固定一页遮住长正文。快速切换只上报最新请求；版本不匹配或无效 layout_plan 会显示失败提示；单张图片解码失败保留正文和实际高度，显示占位及图片不可用提示。原生网页视图只允许离线资源；内置头像随包内联，私有图片由宿主通过桌面会话先安全下载，再通过两端原生请求模型的 assets 字段注入，参见下文。

共享 Mock 保留三套旧模板，另含工牌侧栏、HELLO 分栏、深蓝代码、拍立得衬线、黑色页眉及三区 Muse 样例。独立验证数据覆盖衬线、手写字体、不存在字体的回退以及超过一页的正文、私有头像 assets 注入。它们用于代表性验证，不等于全部模板或所有字体组合已经验收。

```bash
# 更新虚构样例并同步 Mac／Windows Core 资源
uv run --directory apps/backend python ../native/scripts/generate_fixtures.py
# 重新生成纸面，复制同一份 HTML 至两端；契约检查也校验两份资源没有过期
npm run test:native-renderer
# macOS：同一数据在 Chromium 与真实 WKWebView 中核对内容、顺序、模板与图片
# 会短暂打开测试窗口，结束自动关闭
npm run test:native-webkit
# 实际 PDF 导出；macOS 用 PDFKit 检查文本与长正文分页
npm run test:native-pdf
```

Chromium 检查比较共享渲染函数与原生离线包的 DOM、关键配色及图片加载，WebKit 检查相同请求的文本、标题顺序、节点锚点、模板主题、图片与长文高度；PDF 检查旧模板、Muse、衬线字体与长正文的实际生成结果。它们不替代实际 Web 编辑器交互验收，也不证明跨引擎像素一致。Windows WebView2 实机布局和全部模板的视觉验收仍需在对应系统执行。共享 Web 渲染代码／样式／头像变更会触发原生 CI 的重新构建与纸面检查；工作流配置存在不代表远端已通过。


## 私有图片链路

Swift／C# 的纸面请求包含 `assets`。现有模板纸面入口在渲染前调用 API client 的 preparePaper，遍历 canonical 媒体引用，去重后通过当前会话下载简历级 `/api/resumes/:id/assets/:name` 或本人旧 `/api/assets/users/.../assets/...` 资源（包括 avatar 子目录）。现有后端 GET 已支持 desktop Bearer，并继续检查所有权；这里不新增接口、不改权限。绝对 URL、外部来源、查询参数、路径穿越、二次编码及非 PNG／JPEG 私有资源均降级，不尝试任意 URL 下载。

下载复用禁用 Cookie／重定向的原生 HTTP transport。流式读取同时校验响应 MIME、声明大小和实际大小；图片头、格式与像素尺寸通过校验后转换为 data URL。单次纸面最多下载 32 个去重资源，单张及全部私有图片合计不超过 10 MiB，单张最多 4000 万像素。这些是原生内存安全边界；PDF 的输入限制仍以服务端契约为准。Windows Core 校验 PNG／JPEG 头与尺寸，最终解码由 WebView 执行；损坏图片不会被当作整份预览成功而静默忽略。

本次不建立图片缓存，也不写磁盘。图片仅存在当前准备结果和离线 WebView 中，每次准备重新请求；会话协调器按 origin 和当前账号取得凭据，并用 generation 拒绝退出／切换后的迟到结果，401 最多续期后重试一次。旧用户级路径在原生层先核对账号，简历级路径仍由后端核验归属。页面切换取消准备并清空旧纸面；Mac 销毁纸面时清空 HTML，Windows 卸载时关闭 WebView2。纸面导航限制在随包入口和空白页，网页不接收 Bearer 或 refresh。

单张来源拒绝、404／403、网络、大小、格式或解码失败使用中性占位并显示“部分图片不可用，正文仍可预览”；正文及 layout_plan 保持原值。取消不转成图片失败，鉴权失效沿登录状态路径处理。Core 测试覆盖下载去重、输入来源、类型和体积、会话迟到结果及真实 HTTP 的 Cookie／重定向／流式大小边界；实际 Windows WebView2 图片展示仍需要 Windows 实机验收，Mac“我的简历”见下一节。


## Mac 我的简历

`ResumesView.swift` 按 Web `features/home/HomePage.tsx` 的 02.1 列表结构重做：页头“RESUMES · N 份”眉题、衬线标题与副标题，工具栏为“全部简历 N”与 220px 搜索框，卡片网格最小 199px，卡片显示 A4 缩略纸面、标题与“更新时间 · 已保存”，末尾为跳转模板页的“新建空白简历”虚线卡。更新时间按 Web `formatUpdatedAt` 口径显示（今天时刻、昨天、月-日、跨年年-月-日）。游客保留原新用户引导，不请求账号数据；登录后读取 `GET /api/resumes`，加载中显示骨架，失败显示重新加载，空账号显示新建引导。

缩略图与预览弹窗直接使用列表摘要中后端编译好的 `preview.data/style/layout_plan`，经 `preparePaper` 由桌面会话下载私有图片后交给离线纸面；没有预览快照时显示“预览不可用”，单张图片失败沿用私有图片链路的占位提示。导出 PDF 先由用户在系统保存面板选择位置，再以列表中的 `lock_version` 请求 `GET /api/resumes/{id}/pdf`；客户端只接受数字 ID，流式校验 `application/pdf`、声明与实际大小（单份最多 20 MiB）及 `%PDF-` 文件头，数据只在内存中写入所选文件。版本过期（`409 RESUME_PDF_SNAPSHOT_STALE`）或简历已删除时刷新列表并提示重试；鉴权失效沿登录状态路径处理；退出或切换账号清空列表、预览与提示，并用会话 generation 拒绝迟到结果。

卡片菜单提供预览、重命名、复制为新简历、分享链接、导出 PDF 与删除；达到 10 份上限时禁用新建与复制，最终以后端 `RESUME_LIMIT_REACHED` 为准。重命名经 `PUT /api/resumes/{id}` 只提交 `title` 与 `base_lock_version`；复制提交固定 `client_request_id`，网络结果不确定时可原样重试而不重复复制；删除前确认分享失效与求职记录解除关联。分享弹窗对齐 Web `SharePanel`：未创建时选择公开/仅自己、7 天/30 天/永久与是否允许下载；已创建时显示 `{origin}/share/{token}` 并可复制、调整可见性/有效期/下载、重新生成（保留可见性与下载，已过期按原有效时长顺延，推算不出默认 7 天）和删除。模板页“创建简历”弹窗提交 `POST /api/resumes {title, template_id}`，成功后进入“我的简历”并打开新简历预览；该接口没有幂等标识，网络不确定时引导先查看列表，避免重复创建。

导入简历通过系统打开面板选择 Markdown/DOCX/PDF（最多 10 MiB，客户端先校验扩展名、空文件与大小），以固定 `Idempotency-Key` 提交 `POST /api/resumes/import`，模板沿用 Web 规则优先 `classic-technical-cn`。导入任务卡读取 `GET /api/resume-overview` 的进行中与失败任务，进行中每 3 秒刷新，有任务结束即刷新列表；失败任务可经 `DELETE /api/resume-imports/{id}` 删除记录。新建按钮进入模板页。点击卡片或菜单“编辑”进入 `ResumeEditorView` 原生结构化编辑器（新建简历后也直接进入）：编辑姓名、一句话介绍、头像（上传 PNG/JPEG、调整 56–220px 尺寸、更换或移除）、联系方式，模块的类型与标题、条目字段（名称/单位/角色/学位/专业/地点/起止时间/链接）与内容块：段落（左/中/右对齐）、项目符号/编号列表（回车新增一项、可互换类型）、两栏/三栏/四栏信息行（两栏可调左栏宽度）与图片（上传、说明、10–100% 宽度、左/中/右/通栏）；支持增删与上下移动模块、条目和内容块。所有文字使用 `RichTextEditor.swift` 的原生富文本框，格式工具条对应 Web 选区工具：加粗（⌘B）、斜体（⌘I）、下划线（⌘U）、删除线、代码、6–48pt 字号、与 Web 相同色板的文字颜色和背景色、http(s) 链接、12 个图标与清除格式；格式真值保存在自定义文本属性中，显示样式由它重算，图标与行内图片以附件保留原始 JSON，粘贴一律按纯文本。段落里只输入“/”时显示斜杠插入条，可转为列表、分栏或图片。顶部工具栏：大纲跳转到模块，“顺序”弹窗拖动排序（双栏模板按侧栏/主栏分组、各栏内移动，可恢复 Web 默认语义顺序），“版式”弹层调整字体（思源宋体/霞鹜文楷/系统黑体）、正文字号 8–16pt、行距 1.1–1.8、上下 6–30mm 与左右 10–30mm 边距和智能一页（Core `ResumeTypeSettings` 移植 Web `styleToEditorSettings/editorSettingsToStyle`），“模板”弹窗按风格/场景筛选真实模板并以 `POST /api/resumes/{id}/apply-template` 切换（随请求提交当前正文与名称，未保存的版式设置在新模板上重新套用后待保存）。保存以 `PUT /api/resumes/{id}` 提交 `data`、`style`（与改名时的 `title`）和 `base_lock_version`；保存前按 Web `canonicalV1SourceDispositions` 重算来源处置，删除节点不留悬空引用，新节点使用随机 `node_` 标识。冲突（`RESUME_EDIT_CONFLICT`）时提示重新载入，不覆盖他处修改。右侧纸面停顿 0.4 秒后实时预览未保存内容：Core `ResumeLayout` 移植后端 `compile_layout_plan` 在本地生成版式计划（模板放不下某个模块类型时提示而不渲染），保存或切换模板后改用服务端返回的 layout_plan；纸面可在 40%–120% 间缩放。图片经 `POST /api/resumes/{id}/assets` 以 data URL 上传（单张 10 MiB，PNG/JPEG），返回地址写入简历。卡片菜单仍保留“在 Web 编辑器打开”，用默认浏览器打开 `{origin}/resumes/{id}/edit`（网页使用自己的登录态）。Web 画布内的所见即所得编辑在原生端以结构化表单加实时纸面替代。SwiftUI 部分尚未在 macOS 上编译和界面验收。

## 原生岗位看板

Mac 的 `JobsBoardView` 与 Windows 的 `JobsBoardPage/CareerDialogForm` 使用系统控件构建，按 Figma 的 04.1 岗位看板与 04.C01 岗位投递流程 V4 定稿构建页头、统计、看板/列表、阶段与分类结构，不嵌入 React。登录后分页读取全部本人进程与周概览；游客及已登录空账号均保留看板/列表切换、搜索筛选与完整空阶段列，不以插画提示页替代看板；游客提示不代表已查询到个人零条数据，导入/排期会打开登录弹窗，取消保持当前页面。统计来自实际账号数据，不复用 Web 中的示范数值。

支持公司/岗位/阶段搜索、最近排期或最先添加排序、分类分组、隐藏阶段、列拖动与左右移动、拖动岗位后确认推进，动态面试名称独立成列。列表包含公司/岗位、分类、进度、最近安排、投递日期和更新时间。岗位支持手填或文字智能提取、现有/新岗位面试排期、分类、备注、阶段历史、终止和已结束记录的确认删除；详情提供排期改期、作答计划、完成与取消。两端支持 PNG/JPEG 截图智能提取，并可在投递时选择已保存的本人简历。浏览器插件入口展示安装说明，安装包仍从 Web 下载。

业务调用经过已有续期与会话代次保护，退出/账号变化清除内存岗位数据及弹窗。创建结果未确认时要求先刷新，避免自动重复创建；已完成的阶段与排期步骤保留，剩余步骤复用固定请求，冲突显示错误。凭据不会传给网页。桌面仅开放 [契约中的岗位方法/路径](../../docs/api/http-contracts.md#桌面-bearer-会话)。

公司 Logo 只读取带有效 revision 的本人岗位 WebP 接口，单图最多 256 KiB、内存最多缓存 128 张，退出/换账号清理，读取失败保留公司名称与占位；Mac 完整岗位字段编辑与匹配度见下文“Mac 岗位详情与匹配度”，录音转写与 AI 分析报告见 Mac 求职进度一节。最近排期排序使用下一场时间，并读取当前阶段最近已完成安排作为历史排序依据。Windows 窗口构建和交互需要 Windows 的 XAML 编译器，Core 跨平台测试通过不代表 WinUI 实机验收。旧生产服务尚未开放桌面岗位权限时会显示接口错误，不能据此声称云端全流程已验收。


Mac 看板按 Web `ApplicationsBoard.tsx` 与 `InterviewCenterPage` 的 V3 样式重做：页头为“JOBS · 本周”眉题、衬线标题与“进行中/本周面试/待回复 Offer”副标题，四格统计含“待回复”标注；工具栏为看板/列表分段、180px 搜索框、排序菜单与“分组/排序/展示阶段”筛选浮层。阶段列宽在 220–280px 之间按内容区宽度均分，88px 岗位卡显示“公司 · 岗位”、分类标签、状态圆点与文字（今天稍后开始时改为黑色“今天 HH:mm”标签）及公司标，悬停出现 ⋯ 菜单（查看详情、修改分类、推进流程、终止求职；已结束列为删除岗位）。卡片状态、倒计时、颜色与列表进度文案由 Core 的 `CareerBoard` 移植 Web `applicationProgress.ts`；已接受的 Offer 与 Web 一样留在 Offer 列。拖入不允许的列时显示 Web 同款原因提示。列表视图的列与文案对齐 Web（最近安排取本人未结束的下一场）。Windows 仍为原 V4 看板。Figma 阶段图标随两端产物打包，字体复用随包的 Noto Sans SC / Noto Serif SC，不在运行时访问 Figma。

Mac 添加阶段弹窗按 Web `AddNextStageDialog` 重做：880×780，左侧 272px 点阵摘要显示“这一场怎么安排/这次投递怎么记”等标题、最近三段阶段记录（已通过/未通过/已沟通）与“本次”、将保存的条目与自动进入“等待结果”的说明；右侧一行八个阶段卡（允许补录较早阶段）。待投递时先填投递日期、渠道与关联简历；面试与 HR 面填写开始时间、时长、方式（视频/现场/电话）、面试官或联系人、会议链接或地点和准备提醒，面试另有一面/二面/三面/自定义轮次；测评固定为截止前完成并提供 24 小时/3 天/7 天快捷截止，笔试可选按时参加或截止前完成，AI 面试仅按时参加；开放窗口可填个人作答计划（开始时间加时长）。只有填写了任一安排信息才创建场次；“安排时间”类入口要求至少有开始或截止时间。OC 需填写沟通时间，并可记录沟通方式、口头薪酬、预计到岗与补充说明（分别写入 `oc_communicated_at`、`oc_contact`、`oc_salary_text`、`oc_start_text`、`oc_note`）。场次额外提交 `interviewer_name`、`preparation_note`，HR 面场次使用 `hr` 类型。从看板把待投递卡片拖到“筛选中”时改用 Web 同款 480px 记录投递小弹窗。个人计划须在官方窗口内，创建场次后通过既有 answer-plan 接口保存；计划响应丢失时读取场次确认，重试不重复创建阶段或场次。

完整 Offer 流程为 OC（`oc` 阶段，`offer_status=none`）→ 记录正式 Offer（OC 为当前阶段时先追加 Offer 阶段，再写 `received`）→ 接受或婉拒（`accepted|declined`）；最终结果进入已结束列，归档/恢复不重启流程。Mac 表单把 HR 面、OC 作为独立阶段类型提交，投递渠道写 `applied_channel`，OC 写口头薪酬与沟通方式，正式 Offer 的收到日期、回复截止、预计入职与试用期写入对应字段；只有薪酬说明和材料名称仍保存在备注，旧记录备注中的同名字段只作为回填来源。Windows 表单仍按旧方式写备注。材料名称只作记录，文件仍通过资料库管理。补充备注与阶段或 Offer 同事务提交，不改其他备注行。场次记录弹窗读取最新版本后编辑问题记录、复盘总结与改进计划，可确认完成或取消；重试保留原请求及操作类型，不能把失败的编辑请求误发给完成接口。


## 原生面试排期

入口为 SwiftUI 的 `InterviewScheduleView` 和 WinUI 的 `InterviewSchedulePage`，复用 Dev 的月/周日历结构、日期导航、搜索、取消状态筛选和底部最近三项安排。游客显示真实日历骨架，不请求账号数据；新建面试触发登录，取消登录保留当前日期和视图。日历按可用空间伸展，月历只补齐当月所需的四至六周；周历保留全天小时网格并默认滚动至 08:00。另有原生列表视图。

登录后按不透明游标读取本人未归档排期和求职进程。跨账号、退出、离开页面清理数据并拒绝迟到加载。固定场次显示在小时网格，测评/笔试开放窗口展示在顶部；窗口内的个人作答计划单独投影到小时网格，调整时调用 answer-plan，不改变官方窗口。固定场次和个人计划支持拖动提出改期，缩放边缘以 15 分钟步进提出新时段，操作均经过确认表单而非松手即写入。双击空白时间或拖选时间段进入新建；月历溢出安排在原生轻量弹层中查看。

创建可选择已有求职进程中仍等待排期的当前可排期阶段，也可创建新岗位并添加阶段；禁止孤立排期。阶段及场次分步保存，场次使用请求 UUID 幂等重试，部分成功后不重复创建岗位或阶段。详情可修改方式、链接、地点、面试官与准备备注，提供改期、完成及复盘文字、取消和开放窗口个人作答计划设置/清除。每次修改先读取最新场次并携带版本锁，明确参数或时间错误返回后允许修正输入，版本冲突要求刷新，网络结果不确定时重试保留原版本。时间重叠提示只是辅助确认，服务端沿用 Dev 的允许重叠规则；不增加独立排期数据或提醒后台。

Mac 日程已按 Web `ScheduleView` 重做：页头为“SCHEDULE · 年 · 月/周视图”眉题、可点开日期选择的衬线标题与“本月/本周 N 个日程 · 今天 N 场面试”副标题，右侧为月/周分段和上一周期/今天/下一周期；不再提供列表视图、搜索与取消状态筛选（与 Web 一致，已取消安排不显示）。日历固定 480pt 高：月视图灰底事件条带彩色圆点、公司、阶段和时间，今天以蓝色圆点标示，点日期数字切到该周；周视图 56pt 日期表头、开放窗口“全天”行（超过三项可展开）、52pt 时间刻度、按颜色淡底的事件块与当前时间红线。单击选中、双击打开 05.2b 详情弹窗：标题与状态胶囊、日期插图、时间/面试官/形式/地点/链接信息卡，开放窗口可直接保存或清除个人作答计划，主按钮为进入会议或查看求职记录（在日程页内打开该岗位的求职进度）。下方“接下来”固定展示三条。⌘N 新建面试；拖动改期仍经过确认表单。Windows 仍为原排期页。

当前 Windows 时间表单使用系统日期/时间控件，结束时间显式填写；开放窗口个人计划仍须完整落在官方时段内。素材上传及资料关联可在独立资料库进行；AI 复盘、系统通知及远端日历同步未接入排期模块。Windows 的 XAML 构建、交互和视觉需在 Windows 实机验收，Mac 构建与本地虚构数据验证不代表真实微信账号及生产服务验收。

### Mac 求职进度、阶段详情与 AI 分析报告

Mac 的岗位详情按 Figma 04.C01 与 Web `ApplicationProgressPage`/`StageDetailPage`/AI 报告页重做，Windows 暂未跟进。页面结构与 Web 相同：860px 内容区，求职进度步骤条、唯一“下一步”卡片（日期块或状态块、状态标签、说明与主次操作）、按时间倒序的阶段记录与 276px 侧栏（Offer/口头意向、投递信息、关联资料）。状态投影由 Core 的 `CareerDetailModel` 移植 Web `applicationDetailModel.ts`，同样按结束时间把已过期场次视为已完成、等待结果，不提供手动“标记完成”；`CareerReview`/`CareerTranscript` 对应 Web 的报告与文字稿解析规则，Core 测试覆盖主要状态与解析。

阶段记录的“查看详情”进入 04.C03 阶段详情：面试显示录音播放条、自动转写状态（排队/失败重试/完成后待替换）与按说话人分段的文字稿，笔试显示编号题目、导入题目（粘贴文本、资料库文档、1–5 张截图，预览后保存）与开放窗口作答计划；还有准备清单勾选、复盘笔记、本轮信息以及 AI 分析报告摘要。添加内容可上传文件到该场次（录音上传即触发服务端转写）、从资料库关联或粘贴文字。录音播放通过本人资料源文件下载到私有临时目录后交给 AVPlayer，离开页面清理。AI 复盘先展示分析依据（05.N22），再以固定 `request_id` 提交后台生成；生成或转写进行中时页面定时刷新。完整报告页展示结果判断与面试官信号、总分与计算式、五维雷达与维度说明、逐题得分与问答分析、逐题笔记（答得好/待改进 + 文字）、未匹配笔记、改进建议与分析依据，可把题目加入下一轮准备清单，或“模拟下一轮”把题目和建议答法放进首页对话输入框（由用户确认后发送）；旧版报告保留三项评分展示。

准备清单与 Web `PrepChecklistCard` 一致：每场待进行面试可由 AI 生成一次（`POST .../prep-items:generate`），并可勾选、添加（最多 12 项、标题 80 字）与删除。“管理关联资料”（更多菜单与侧栏）与 Web 一致跳转到资料库。深层页面通过 `WorkspaceRouter` 切换工作区栏目。SwiftUI 部分只在 Linux 上做过语法解析，类型检查、构建与界面需在 macOS 上编译验收；Core 部分在 Linux Swift 工具链下编译并通过测试。

### Mac 岗位详情与匹配度

`JobDetailView.swift` 对齐 Web `JobDetailPage.tsx` 与 `JobMatchCard.tsx`，从求职进度页“岗位详情”进入（原岗位已删除时退回只读描述）。页头为来源、更新时间、职位名称、当前阶段、薪资与工作条件；简历匹配度卡显示分数、“还缺”标题、已命中/待补充标签与过期提示，分析只由用户触发，`JOB_MATCH_IN_PROGRESS` 或 pending 时每 3 秒轮询、最多 20 次，错误码文案与 Web 相同。未关联简历时可从本人简历中选择，经 `PUT /api/job-applications/{id}` 写入 `resume_id` 并带锁版本。岗位描述以原生 Markdown 显示，JD 已覆盖/待补充要求以标签列出（不做行内高亮）；另有核心技能、工作安排、公司信息与个人备注（可直接编辑）。“编辑岗位”表单覆盖 Web 全部可编辑字段，PUT 由当前记录与修改合成完整字段并携带 `base_lock_version`；永久删除前确认会一并删除求职进程、阶段、复盘与排期。

### Mac 账号设置

`AccountView.swift` 从侧栏账号菜单进入，读取 `GET /api/account/profile`、`/user-profile` 与 `/preferences`。可更换头像（选图后裁成居中正方形、缩放到 512px 内以 JPEG 经 `PUT /api/account/avatar` 上传，可移除；头像经桌面会话下载显示，不缓存）、修改昵称（`PATCH /api/account/profile`，侧栏名称立即更新）、联系邮箱、求职资料画像（求职类型、身份与毕业年份/工作年限、意向城市、期望薪资、学历院校专业与层次、技能语言证书、荣誉与校园经历；PUT 完整替换并带锁版本，冲突时读取最新版本提示确认）与偏好（语言、面试提醒开关）。桌面只能微信登录，账号页不提供注销账号、密码与微信绑定。

### Mac AI 对话

`AssistantChatView.swift` 使用用户侧 `/api/agent/*`：侧栏“最近对话”列出未归档会话（置顶优先、最近消息优先），首页发送或新对话在第一次发送时创建会话。消息以固定 UUID `idempotency_key` 经 SSE 发送，Core 的 `streamAgent` 逐帧解析已知事件、单帧 1 MiB／整条 16 MiB 上限，收到终止事件结束，未收到则提示中断并刷新会话确认结果；只在响应开始前处理 401 续期，不重放已开始的流。打开会话时检查 `active-run` 并经 `GET /api/agent/runs/{id}/events` 重新接入；生成中可停止。助手的追问以选项卡呈现，提交时附 `reply_to_sequence_no` 与 `clarification_answers`；修改建议显示摘要与前后对比，可“应用到简历”或“不采用”，应用仍由服务端校验归属与锁版本。“+”菜单从 `GET /api/agent/contexts` 附加简历、岗位、资料等引用。会话头部可切换模型（`GET /api/agent/models`，新会话创建时携带，已有会话 `PATCH modelId`）；服务端开放 steering 时，生成中可继续发送，消息经 `POST /api/agent/runs/{id}/steer` 插入当前运行；含一级标题的回复可“保存到资料库”，选择或新建文件夹后作为 `.md` 上传，重名时追加时间后缀，上传使用固定标识。右侧文件预览对齐 Web `PreviewPanel`：点击消息附加的简历/资料、修改建议的“在简历中预览”、生成文档的“预览文档”或头部“文件 N”打开，最多 6 个标签；简历用列表预览快照经纸面渲染，并把待确认修改的原文所在段落与列表项标黄（`ResumePaperView` 的 `highlights` 在渲染后只改元素内联样式，按 Web `HighlightedContent` 的文字匹配规则）；资料读取 `GET /api/datasets/{id}/content`（只预览 md/txt/pdf 文字），生成文档可复制或保存；403/404 时引用标灰不可再打开。截图可从“+”菜单截取屏幕区域（系统 `screencapture -i`，首次需授予屏幕录制权限）、粘贴剪贴板图片、选择图片文件或拖入输入框添加，一次最多 9 张、单张 10 MiB，可在右侧以 25%–300% 查看。与 Web 相同，截图只保存在本机内存：带截图发送时不请求后端，在对话中留下本地消息与说明回复；明确要求生成文档时提示先移除截图。

### 浏览器插件与 Web 跳转

首页插件卡与提示提供“在浏览器打开”，进入 Web 岗位看板查看安装包与说明。`WebBridge` 只打开同一 origin 下的固定站内路径，不携带桌面凭据。

### 模拟面试

`MockInterviewView.swift` 与 `MockInterviewPage.cs` 实现游客首页、练习记录、背景配置、文字作答与评估报告。Mac 已按 Web `MockInterviewHome`/`MockInterviewNew`/`MockInterviewSession`/`MockInterviewReport` 重做界面：首页含最近面试卡（日期卡、准备度与题型覆盖、推荐练习）、未完成场次条、首次使用引导、练习数据（平均分环、得分趋势、五维雷达）、在投岗位卡与通用练习入口；练习记录为状态分段、岗位/类型/排序筛选与六列表格；新建页为 560pt 单列表单与“更多设置”弹窗；作答页为题号进度条、按题分组的对话线程与圆角输入框（Enter 发送、Shift+Enter 换行）；报告页含总分与计算式、能力维度雷达与条形、可展开的逐题问答与分析、改进建议、简历风险与事实核验。Mac 也支持语音面试（见下文“Mac 语音面试”）。详情以真实后端状态为准；创建、题目、追问、评分和报告不在客户端模拟。准备/评估可离开后继续，回答结果不确定时保留同一 `Idempotency-Key` 安全重试；资料列表仅用于选择本人已解析的文档。流程及语音边界见 [模拟面试](../../docs/features/mock-interview.md#原生面试)。


### Mac 语音面试

语音线路（识别与合成）可用时，新建面试可选“语音面试”，再练沿用原模式。`VoiceRecorder` 用 AVAudioEngine 采集麦克风，经 AVAudioConverter 转为 16 kHz 单声道 PCM16，约每 100ms 一帧经 `WS /api/mock-interviews/{id}/speech?question_id=&purpose=voice_answer` 发送，握手携带 desktop Bearer（15 秒超时）；实时显示 partial 字幕，停止时发送 `{"type":"stop"}`，30 秒内取得 `final` 的一次性 `session_id` 后以 `speech_session_id` 提交回答（同样带固定 `Idempotency-Key`）。发送积压超过 1 MB、连接中断或关闭码 4401/4409 时停止并提示重录；录音不落盘。面试官语音来自回合 SSE 的 `interviewer.audio`（mp3，按 seq 播放），首题或未带语音的新题经 `POST .../speech/playback` 朗读，也可手动重听；合成失败只保留字幕。每次进入未完成的语音场次先显示设备检测（Web `DeviceCheck`）：申请麦克风并显示电平（4 秒无声提示），可试听面试官声音（`speech/playback` 不带题目时合成固定问候语），麦克风授权且题目就绪后才能开始；macOS 跟随系统默认输入设备，“更换”打开系统声音设置。“返回修改”与“改为文字面试”需确认，都会先放弃本场，前者带原设置回到新建页，后者按相同设置新建文字场次。完成的语音场次可播放逐题录音（`GET .../recording`）、修改识别稿并重新评估、AI 修正识别稿和删除全部录音，成功提示以绿色显示。首次使用会请求麦克风权限，打包 `.app` 必须带 `NSMicrophoneUsageDescription`。真实麦克风、识别与合成线路需要在 macOS 上联调验收。

### 资料库

`DatasetLibraryView.swift` 与 `DatasetLibraryPage.cs` 使用原生文件夹与文件表格，Mac 已按 Web `DatasetsPage` 的 06.1/06.2 结构重做：根目录为“DATASETS · N 份”眉题、搜索与“新建文件夹”、按最近上传排序的文件夹卡（缩略纸张按格式着色）、新建文件夹虚线卡与“最近上传”列表；文件夹内为“DATASETS · 文件夹名”可返回的眉题、“共 N 份资料 · M 份已关联面试”、批量操作与上传资料按钮，表格列为格式/名称与状态/关联/大小/上传日期（失败时为重试）/⋯，点击可用行直接预览或播放，批量模式下显示复选框与底部操作栏；Mac 不再显示右侧详情面板与类型筛选。提供个人文件上传、解析预览、系统媒体播放、下载、重命名、批量移动/删除、解析重试及面试关联。游客显示空资料库，登录后读取本人数据；失败显示错误，不补入虚构资料。临时快照、幂等重试、替换确认、账号清理与 Markdown 图表/图片差异见 [原生资料库](../../docs/features/datasets.md#原生资料库)，接口权限见 [桌面资料库权限](../../docs/api/http-contracts.md#桌面资料库权限)。当前没有崩溃后的临时文件恢复清理器，Windows 系统交互需实机验证。
