import LinkResumeCore
import SwiftUI

/// 工作区外壳：原生 NavigationSplitView 侧栏 + 详情区，对应 Web 的 V3Shell。
struct WorkspaceView: View {
    let user: User
    @State private var selection: WorkspaceSection? = .templates

    var body: some View {
        NavigationSplitView {
            List(WorkspaceSection.allCases, selection: $selection) { section in
                Label(section.title, systemImage: section.symbol).tag(section)
            }
            .navigationSplitViewColumnWidth(min: 200, ideal: 220)
            .safeAreaInset(edge: .bottom) {
                Label(user.nickname, systemImage: "person.crop.circle")
                    .foregroundStyle(Tokens.Color.textMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(Tokens.Space.s4)
            }
        } detail: {
            switch selection {
            case .templates: TemplatesView()
            case let section?: PlaceholderView(section: section)
            case nil: PlaceholderView(section: .home)
            }
        }
    }
}

/// 尚未实现的功能页。
struct PlaceholderView: View {
    let section: WorkspaceSection

    var body: some View {
        ContentUnavailableView(section.title, systemImage: section.symbol, description: Text("原生版本待实现"))
            .navigationTitle(section.title)
    }
}
