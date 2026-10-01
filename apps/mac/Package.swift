// swift-tools-version:6.0
import PackageDescription

// LinkResume macOS 原生客户端。分三层：
//   LinkResumeCore   平台无关：模型、API 协议与 mock、会话、导航定义（可单测）
//   LinkResumeRender 简历纸面：WKWebView 加载离线 paper.html（与 Web / PDF 同一渲染器）
//   LinkResumeApp    SwiftUI 界面：窗口、侧栏、各功能页
let package = Package(
    name: "LinkResumeMac",
    defaultLocalization: "zh-Hans",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "LinkResume", targets: ["LinkResumeApp"]),
    ],
    targets: [
        .target(
            name: "LinkResumeCore",
            resources: [.copy("Resources/resume-templates.json")]
        ),
        .target(
            name: "LinkResumeRender",
            dependencies: ["LinkResumeCore"],
            resources: [.copy("Resources/paper.html")]
        ),
        .executableTarget(
            name: "LinkResumeApp",
            dependencies: ["LinkResumeCore", "LinkResumeRender"]
        ),
        .testTarget(
            name: "LinkResumeCoreTests",
            dependencies: ["LinkResumeCore"]
        ),
    ]
)
