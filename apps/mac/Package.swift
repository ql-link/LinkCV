// swift-tools-version:6.0
import PackageDescription

// DrawOffer macOS 原生客户端。分三层：
//   DrawOfferCore   平台无关：模型、API 协议与 mock、会话、导航定义（可单测）
//   DrawOfferRender 简历纸面：WKWebView 加载离线 paper.html（与 Web / PDF 同一渲染器）
//   DrawOfferApp    SwiftUI 界面：窗口、侧栏、各功能页
let package = Package(
    name: "DrawOfferMac",
    defaultLocalization: "zh-Hans",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "DrawOffer", targets: ["DrawOfferApp"]),
    ],
    targets: [
        .target(
            name: "DrawOfferCore",
            resources: [.copy("Resources/resume-templates.json")]
        ),
        .target(
            name: "DrawOfferRender",
            dependencies: ["DrawOfferCore"],
            resources: [.copy("Resources/paper.html")]
        ),
        .executableTarget(
            name: "DrawOfferApp",
            dependencies: ["DrawOfferCore", "DrawOfferRender"],
            resources: [.copy("Resources/Branding"), .copy("Resources/Home"), .copy("Resources/Library"), .copy("Resources/Career"), .copy("Resources/AppIcon.png")]
        ),
        .testTarget(
            name: "DrawOfferCoreTests",
            dependencies: ["DrawOfferCore"]
        ),
    ],
    swiftLanguageModes: [.v6]
)
