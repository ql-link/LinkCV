# LinkResume 原生桌面客户端

`apps/mac` 是 SwiftUI 客户端，`apps/windows` 是 WinUI 3 客户端。界面使用系统控件，仅简历纸面嵌入离线网页视图，复用 Web 的 `renderResumePrintDocument`；`apps/desktop` 的 Electron 壳是独立线路。

正式 App 注入 desktop Bearer HTTP 客户端，支持微信扫码、手机确认后的领取、启动恢复、续期与退出。Mac 与 Windows 均直接进入工作区首页：未登录或恢复失败时仍可浏览随包提供的 9 套精选模板与虚构示例，不请求账号资源，不显示未经查询的个人数量。示例预览始终使用离线资源，不代表完整在线模板目录。登录入口位于侧栏和个人简历引导；“使用此模板”打开原生登录弹窗，取消保留当前预览，成功保留模板选择并进入创建准备状态。当前桌面简历权限仍只读，原生简历创建与编辑尚未接入，准备状态明确不表示简历已保存。退出后清理准备状态并返回游客首页。岗位看板、面试排期和模拟面试文字流程已使用原生页面接入现有接口；其他未接入业务页面仍为占位。Mock 只用于 Core 测试。协议与权限边界见 [桌面会话契约](../../docs/api/http-contracts.md#桌面-bearer-会话)。

## 界面与 Web 对齐

原生外壳以 `origin/dev` 中 `App.tsx` 实际挂载的 `apps/web/src/v3/Shell.tsx` 为准，使用 216px 侧栏和圆角内容面板：品牌、新建对话、首页、我的简历、简历模板、岗位看板、面试日程、模拟面试、资料库、最近对话与账号入口。`WorkspaceLayout.tsx` 的顶部导航不是该入口的视觉基准。原生默认展示首页；游客沿用 Web 空状态层级，示例不计入账号数量。品牌通过纸面构建脚本从 Web 同步；模板使用共享纸面渲染卡片网格与预览弹窗。字号、间距、颜色以 Dev 的 V3 CSS 为依据。AI 首页已实现 Dev 的游客引导布局（问候、输入区、快捷指令和三张引导卡），对话服务、首页账号进度和其他业务页尚未接入；岗位看板和排期已接入本文说明的求职接口；系统窗口装饰、字体回退、原生控件和 Windows 实机视觉仍需验收，不能据此外壳宣称全部页面已一致。

### 首页引导与输入

首页参考 Dev 的 `AssistantPage.tsx`、`HomeCards.tsx`、`homeDashboard.ts` 与 `assistant.css`，采用 720px 居中正文、120px 输入框、三条快捷指令和三张 236px 引导卡。游客使用 Web 新用户的引导文案，登录后因尚未查询个人进度使用中性文案，不把未知账号当作无简历账号。模型显示未连接，不虚构模型可用性；发送与添加资料触发登录或未开放提示，不模拟 AI 回答。

首页在右侧内容区水平、垂直居中，正文最大宽度 720px，随窗口宽度收缩；移除页面级滚动容器与固定顶部留白。较矮窗口缩减间距、插图和卡片高度，Mac 支持的最小窗口为 1080×700。Windows 同步尺寸响应，并在过小窗口使用仅缩小的 Viewbox 防止截断，实机视觉仍需验证。输入框内部仍支持长文本编辑。

输入只存当前窗口内存，切换页和取消登录保留；新建对话主动清空，退出或切换账号清空。不会写本地草稿文件或发送到后端。共用 `shared/home/content.json` 与三张引导插图，纸面构建同步到两端；插图源坐标取自 Dev HomeCards，修改后可运行 `node apps/native/scripts/build_home_art.mjs` 重新导出。

### 应用图标

应用图标统一来自 Web 的 `apps/web/src/assets/linkresume-mark.png`，保留原羽毛 Logo，叠加暖白色 `#F7F5F0` 圆角底板；底板外保留透明，Web 品牌源文件不变。更新品牌后执行 `uv run --directory apps/backend python ../native/scripts/generate_app_icons.py`，同步 Mac 运行时 PNG／ICNS、Windows 多尺寸 ICO 与 Electron 图标副本。Mac `swift run` 也会设置 Dock 图标；生成 `.app` 时须把 `apps/mac/Resources/LinkResume.icns` 复制到 `Contents/Resources`，并在 `Contents/Info.plist` 设置 `CFBundleIconFile=LinkResume.icns`。Windows 同时配置 exe 资源图标与窗口图标；Electron 开发态 Dock 和打包图标均使用更新后的副本。

## 配置与启动

两端从进程环境读取 `LINKRESUME_API_ORIGIN`，值必须是受信任的 HTTPS origin，不能包含路径、查询、用户信息或 fragment。缺失或非法时显示配置错误，不回退 Mock。仅本机 HTTP 调试可另设 `LINKRESUME_ALLOW_LOCAL_HTTP=1`，且地址仅限 localhost、127.0.0.1 或 ::1；这不允许远程明文服务。

```bash
npm ci --prefix apps/web
# 按实际本地后端端口配置；后端必须单独按明确的 Local/Development profile 启动。
LINKRESUME_API_ORIGIN=http://127.0.0.1:8000 LINKRESUME_ALLOW_LOCAL_HTTP=1 npm run dev:mac
RUN_DESKTOP_KEYCHAIN_TESTS=1 npm run test:mac
npm run test:windows-core
```

Windows PowerShell：

```powershell
$env:LINKRESUME_API_ORIGIN = "http://127.0.0.1:8000"
$env:LINKRESUME_ALLOW_LOCAL_HTTP = "1"
$env:RUN_DESKTOP_CREDENTIAL_TESTS = "1"
npm run test:windows-platform
npm run build:native-renderer
cd apps/windows
dotnet build src/LinkResume.App/LinkResume.App.csproj -p:Platform=x64 -r win-x64
dotnet run --project src/LinkResume.App/LinkResume.App.csproj -p:Platform=x64 -r win-x64
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

单张来源拒绝、404／403、网络、大小、格式或解码失败使用中性占位并显示“部分图片不可用，正文仍可预览”；正文及 layout_plan 保持原值。取消不转成图片失败，鉴权失效沿登录状态路径处理。Core 测试覆盖下载去重、输入来源、类型和体积、会话迟到结果及真实 HTTP 的 Cookie／重定向／流式大小边界；实际 Windows WebView2 图片展示仍需要 Windows 实机验收，完整“我的简历”业务页面仍属于另一个模块。


## 原生岗位看板

Mac 的 `JobsBoardView` 与 Windows 的 `JobsBoardPage/CareerDialogForm` 使用系统控件构建，按 Figma 的 04.1 岗位看板与 04.C01 岗位投递流程 V4 定稿构建页头、统计、看板/列表、阶段与分类结构，不嵌入 React。登录后分页读取全部本人进程与周概览；游客及已登录空账号均保留看板/列表切换、搜索筛选与完整空阶段列，不以插画提示页替代看板；游客提示不代表已查询到个人零条数据，导入/排期会打开登录弹窗，取消保持当前页面。统计来自实际账号数据，不复用 Web 中的示范数值。

支持公司/岗位/阶段搜索、最近排期或最先添加排序、分类分组、隐藏阶段、列拖动与左右移动、拖动岗位后确认推进，动态面试名称独立成列。列表包含公司/岗位、分类、进度、最近安排、投递日期和更新时间。岗位支持手填或文字智能提取、现有/新岗位面试排期、分类、备注、阶段历史、终止和已结束记录的确认删除；详情提供排期改期、作答计划、完成与取消。两端支持 PNG/JPEG 截图智能提取，并可在投递时选择已保存的本人简历。浏览器插件入口展示安装说明，安装包仍从 Web 下载。

业务调用经过已有续期与会话代次保护，退出/账号变化清除内存岗位数据及弹窗。创建结果未确认时要求先刷新，避免自动重复创建；已完成的阶段与排期步骤保留，剩余步骤复用固定请求，冲突显示错误。凭据不会传给网页。桌面仅开放 [契约中的岗位方法/路径](../../docs/api/http-contracts.md#桌面-bearer-会话)。

公司 Logo 只读取带有效 revision 的本人岗位 WebP 接口，单图最多 256 KiB、内存最多缓存 128 张，退出/换账号清理，读取失败保留公司名称与占位；完整岗位字段编辑、录音转文字和 AI 分析报告尚未接入岗位原生表单。最近排期排序使用下一场时间，并读取当前阶段最近已完成安排作为历史排序依据。Windows 窗口构建和交互需要 Windows 的 XAML 编译器，Core 跨平台测试通过不代表 WinUI 实机验收。旧生产服务尚未开放桌面岗位权限时会显示接口错误，不能据此声称云端全流程已验收。


原生 V4 的看板使用居中的 860px 内容区、164px 阶段列和紧凑岗位卡片，窄窗口仅在看板区域横向滚动。Figma 的阶段图标与点阵背景随两端产物打包，字体复用随包的 Noto Sans SC / Noto Serif SC，不在运行时访问 Figma。详情是内容区页面，展示只读进度轨道、状态决定的单个“下一步”按钮、阶段记录及投递信息；阶段操作通过原生弹窗确认，保存后刷新当前详情。阶段弹窗采用左侧说明与右侧八种阶段卡片，HR 面使用普通面试预设名称。

完整 Offer 流程为 OC（`offer_status=none`）→ 记录正式 Offer（`received`）→ 接受或婉拒（`accepted|declined`）；最终结果进入已结束列，归档/恢复不重启流程。正式 Offer 的日期、回复截止、薪酬说明、预计入职、试用期和材料名称保存在备注；材料名称只作记录，文件仍通过资料库管理。补充备注与阶段或 Offer 同事务提交，不改其他备注行。场次记录弹窗读取最新版本后编辑问题记录、复盘总结与改进计划，可确认完成或取消；重试保留原请求及操作类型，不能把失败的编辑请求误发给完成接口。


## 原生面试排期

入口为 SwiftUI 的 `InterviewScheduleView` 和 WinUI 的 `InterviewSchedulePage`，复用 Dev 的月/周日历结构、日期导航、搜索、取消状态筛选和底部最近三项安排。游客显示真实日历骨架，不请求账号数据；新建面试触发登录，取消登录保留当前日期和视图。日历按可用空间伸展，月历只补齐当月所需的四至六周；周历保留全天小时网格并默认滚动至 08:00。另有原生列表视图。

登录后按不透明游标读取本人未归档排期和求职进程。跨账号、退出、离开页面清理数据并拒绝迟到加载。固定场次显示在小时网格，测评/笔试开放窗口展示在顶部；窗口内的个人作答计划单独投影到小时网格，调整时调用 answer-plan，不改变官方窗口。固定场次和个人计划支持拖动提出改期，缩放边缘以 15 分钟步进提出新时段，操作均经过确认表单而非松手即写入。双击空白时间或拖选时间段进入新建；月历溢出安排在原生轻量弹层中查看。

创建可选择已有求职进程中仍等待排期的当前可排期阶段，也可创建新岗位并添加阶段；禁止孤立排期。阶段及场次分步保存，场次使用请求 UUID 幂等重试，部分成功后不重复创建岗位或阶段。详情可修改方式、链接、地点、面试官与准备备注，提供改期、完成及复盘文字、取消和开放窗口个人作答计划设置/清除。每次修改先读取最新场次并携带版本锁，明确参数或时间错误返回后允许修正输入，版本冲突要求刷新，网络结果不确定时重试保留原版本。时间重叠提示只是辅助确认，服务端沿用 Dev 的允许重叠规则；不增加独立排期数据或提醒后台。

当前原生时间表单使用系统日期/时间控件，结束时间显式填写；开放窗口个人计划仍须完整落在官方时段内。素材上传及资料关联可在独立资料库进行；AI 复盘、系统通知及远端日历同步未接入排期模块。Windows 的 XAML 构建、交互和视觉需在 Windows 实机验收，Mac 构建与本地虚构数据验证不代表真实微信账号及生产服务验收。

### 模拟面试

`MockInterviewView.swift` 与 `MockInterviewPage.cs` 实现游客首页、练习记录、背景配置、文字作答与评估报告。详情以真实后端状态为准；创建、题目、追问、评分和报告不在客户端模拟。准备/评估可离开后继续，回答结果不确定时保留同一 `Idempotency-Key` 安全重试；资料列表仅用于选择本人已解析的文档。流程及语音边界见 [模拟面试](../../docs/features/mock-interview.md#原生文字面试)。


### 资料库

`DatasetLibraryView.swift` 与 `DatasetLibraryPage.cs` 使用原生文件夹与文件表格，提供个人文件上传、解析预览、系统媒体播放、下载、重命名、批量移动/删除、解析重试及面试关联。游客显示空资料库，登录后读取本人数据；失败显示错误，不补入虚构资料。临时快照、幂等重试、替换确认、账号清理与 Markdown 图表/图片差异见 [原生资料库](../../docs/features/datasets.md#原生资料库)，接口权限见 [桌面资料库权限](../../docs/api/http-contracts.md#桌面资料库权限)。当前没有崩溃后的临时文件恢复清理器，Windows 系统交互需实机验证。
