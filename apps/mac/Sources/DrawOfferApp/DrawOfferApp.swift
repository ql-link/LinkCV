import AppKit
import Foundation
import DrawOfferCore
import SwiftUI

@main
struct DrawOfferApp: App {
    @State private var session: SessionStore?
    @State private var configurationError: String?
    @State private var started = false
    private let lease: DesktopInstanceLease?

    init() {
        var instanceLease: DesktopInstanceLease?
        do {
            guard let value = ProcessInfo.processInfo.environment["DRAWOFFER_API_ORIGIN"],
                  let origin = URL(string: value) else { throw APIError.invalidResponse }
            let directory = try FileManager.default.url(for: .applicationSupportDirectory,
                in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("DrawOffer")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            instanceLease = try DesktopInstanceLease(fileURL: directory.appendingPathComponent("desktop-session.lock"))
            let api = try HTTPAPIClient(baseURL: origin, tokens: KeychainTokenStore(),
                allowLocalHTTP: ProcessInfo.processInfo.environment["DRAWOFFER_ALLOW_LOCAL_HTTP"] == "1")
            _session = State(initialValue: SessionStore(api: api))
        } catch APIError.server(status: 409, code: "DESKTOP_ALREADY_RUNNING") {
            _configurationError = State(initialValue: "DrawOffer 已在运行，请使用已打开的窗口。")
        } catch {
            _configurationError = State(initialValue: "API 地址未配置或无效。请设置 DRAWOFFER_API_ORIGIN 后重新启动。")
        }
        lease = instanceLease
    }

    var body: some Scene {
        WindowGroup("DrawOffer") {
            Group {
                if let session {
                    RootView().environment(session)
                        .task {
                            guard !started else { return }
                            started = true
                            await session.restore()
                        }
                } else {
                    ContentUnavailableView("无法连接服务", systemImage: "network.slash",
                        description: Text(configurationError ?? "配置无效"))
                }
            }.frame(minWidth: 1080, minHeight: 700)
                .onAppear {
                    if let url = Bundle.module.url(forResource: "AppIcon", withExtension: "png"),
                       let icon = NSImage(contentsOf: url) {
                        NSApplication.shared.applicationIconImage = icon
                    }
                }
        }
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("账号") {
                Button("退出登录") { Task { await session?.signOut() } }
                    .disabled(session == nil)
            }
        }
        Settings {
            Text("设置（待实现）").padding(Tokens.Space.s6)
        }
    }
}

struct RootView: View {
    @Environment(SessionStore.self) private var session

    var body: some View {
        WorkspaceView()
    }
}
