import LinkResumeCore
import SwiftUI

@main
struct LinkResumeApp: App {
    // 现在固定用 mock；desktop 渠道上线后按构建配置切到 HTTPAPIClient
    @State private var session = SessionStore(api: MockAPIClient())

    var body: some Scene {
        WindowGroup("LinkResume") {
            RootView()
                .environment(session)
                .frame(minWidth: 1080, minHeight: 700)
                .task { await session.restore() }
        }
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandMenu("账号") {
                Button("退出登录") { Task { await session.signOut() } }
                    .disabled(session.phase == .signedOut)
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
        switch session.phase {
        case .restoring:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .signedOut:
            SignInView()
        case .signedIn(let user):
            WorkspaceView(user: user)
        }
    }
}
