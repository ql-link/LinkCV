# LinkResume 原生桌面客户端

两套原生客户端：`apps/mac`（SwiftUI）和 `apps/windows`（WinUI 3）。它们不加载线上网页，界面全部用系统控件；只有「简历纸面」这一块嵌入一个离线网页视图，用来保证纸面和 Web 端、PDF 完全一致。`apps/desktop` 下的 Electron 套壳是另一条线路，互不影响。

当前处于架构骨架阶段。已经跑通的是：登录（mock）、工作区侧栏、简历模板页（列表加纸面预览）。其余页面还是占位。

## 分层

```text
             Mac (SwiftUI)                         Windows (WinUI 3)
┌───────────────────────────────┐   ┌───────────────────────────────┐
│ LinkResumeApp   窗口/侧栏/页面 │   │ LinkResume.App  窗口/侧栏/页面 │
│ LinkResumeRender  WKWebView   │   │ Paper/ResumePaperView WebView2 │
│ LinkResumeCore  模型/API/会话  │   │ LinkResume.Core 模型/API/会话  │
└──────────────┬────────────────┘   └──────────────┬────────────────┘
               │  同一份 paper.html、同一份 mock fixture  │
               └──────────────┬─────────────────────────┘
                     apps/native（共享产物）
            renderer/entry.ts ← 复用 apps/web 的 renderResumePrintDocument
            shared/fixtures   ← 后端布局编译器生成的虚构模板数据
```

- **Core 层**：两端结构一一对应，同一组 5 条单测（`CoreTests`）。平台无关，Windows 的 Core 在 macOS 上也能编译和测试。
- **API 层**：界面只依赖 `APIClient` / `IApiClient` 接口。目前注入 mock 实现；`HTTPAPIClient` / `HttpApiClient` 已经实现请求管线，包括 Bearer、X-Request-ID 和错误码转换，但登录依赖后端的 desktop 渠道。
- **纸面**：原生层把 `ResumeRenderRequestV1` 序列化后，调用 `window.linkresume.render(...)` 传给网页；页面通过 `postMessage` 回传 `ready` 和 `rendered(heightPx)`。页面的 CSP 禁止任何外部请求，内置头像以 data URL 内联。

## 命令

```bash
npm run build:native-renderer  # 生成 paper.html 并复制进两端资源目录（需要 apps/web 的 node_modules）
npm run dev:mac                # 构建并启动 Mac 客户端
npm run test:mac               # Mac Core 单测（兼容只装 Command Line Tools 的环境）
npm run test:windows-core      # Windows Core 单测（需要 .NET 10 SDK，macOS 上也能跑）
```

Windows 应用本体（`LinkResume.App`）只能在 Windows 上用 Visual Studio 2022+ 构建。重新生成 mock fixture：

```bash
uv run --directory apps/backend python ../native/scripts/generate_fixtures.py
```

## 需后端

| 事项 | 说明 |
| --- | --- |
| desktop 会话渠道 | 后端会话目前只区分 `web`（Cookie）和 `miniprogram`（Bearer）。桌面需要新增 `channel=desktop` 的 Bearer 与 refresh 轮换，refresh 分别存进 Keychain / Credential Locker。改动涉及鉴权和 Redis session，需要先通过 `flow-router` 出方案 |
| 登录方式 | 渠道就绪后：生产环境用微信扫码（复用 `/api/auth/wechat/qrcode` 流程），Dev 环境用邮箱密码 |
| 私有图片 | 纸面里的用户上传图片要由原生层带 Bearer 下载后，通过 `assets` 以 data URL 传给纸面，因为网页视图拿不到凭据 |

## 已知限制

- 纸面暂时没有内嵌字体。完整字体约 70MB，所以先回退到系统字体（Mac 用 PingFang，Windows 用 Microsoft YaHei），字形和 PDF 会有细微差异。后续可以只打包子集化字体。
- Mac 端未签名、未公证，Windows 端未打 MSIX 包。这两项都属于发布阶段的工作。
