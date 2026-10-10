import AppKit
import DrawOfferCore
import SwiftUI

struct WorkspaceView: View {
    @Environment(SessionStore.self) private var session
    @State private var selection: WorkspaceSection? = .home
    private struct LoginRequest: Identifiable {
        let id = UUID()
        let template: ResumeTemplate?
        let reasonOverride: String?
        init(template: ResumeTemplate?, reasonOverride: String? = nil) {
            self.template = template; self.reasonOverride = reasonOverride
        }
        var reason: String { reasonOverride ?? template.map { "登录后继续使用「\($0.name)」。" } ?? "登录后查看和同步你的简历。" }
    }
    @State private var loginRequest: LoginRequest?
    @State private var pendingCreateKey: String?
    private struct ChatTarget: Equatable { let token = UUID(); let sessionID: String?; let initial: String? }
    @State private var chat: ChatTarget?
    @State private var agentSessions = AgentSessionsModel()
    @State private var focusResumeID: String?
    @State private var editResumeID: String?
    @State private var featureNotice = false
    @State private var homeDraft = ""
    @State private var pluginNotice = false
    @State private var router = WorkspaceRouter()

    private var user: User? {
        if case .signedIn(let user) = session.phase { return user }
        return nil
    }

    var body: some View {
        HStack(spacing: 13) {
            VStack(alignment: .leading, spacing: 4) {
                Button { selection = .home } label: {
                    if let url = Bundle.module.url(forResource: "wordmark", withExtension: "png", subdirectory: "Branding"),
                       let image = NSImage(contentsOf: url) {
                        Image(nsImage: image).resizable().scaledToFit().frame(width: 146, height: 30)
                    } else { Text("DrawOffer").font(.title3.bold()) }
                }.buttonStyle(.plain).accessibilityLabel("DrawOffer 首页").padding(.leading, 8).padding(.top, 24).padding(.bottom, 10)
                Button { selection = .home; homeDraft = "" } label: {
                    Label("新建对话", systemImage: "plus").font(.system(size: 13.5))
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).frame(height: 34)
                }.buttonStyle(.plain)
                VStack(spacing: 4) {
                    ForEach(WorkspaceSection.sidebar) { section in
                        Button { selection = section } label: {
                            Label(section.title, systemImage: section.symbol)
                                .font(.system(size: 14, weight: selection == section ? .medium : .regular))
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).frame(height: 34)
                                .foregroundStyle(selection == section ? Color(hex: 0x1D1D1B) : Color(hex: 0x55554F))
                                .background(selection == section ? Color(hex: 0xE6E6E2) : .clear, in: RoundedRectangle(cornerRadius: 8))
                        }.buttonStyle(.plain)
                    }
                }.padding(.top, 12)
                HStack {
                    Text("最近对话").font(.system(size: 11.5)).foregroundStyle(Color(hex: 0x96968F))
                    Spacer()
                    Button { selection = .home; homeDraft = "" } label: { Image(systemName: "plus") }
                        .buttonStyle(.plain).accessibilityLabel("新建对话")
                }.padding(.horizontal, 12).padding(.top, 22).padding(.bottom, 8)
                if user == nil || (agentSessions.loaded && agentSessions.sessions.isEmpty) {
                    Text(user == nil ? "登录后读取对话" : "还没有对话")
                        .font(.system(size: 12)).foregroundStyle(Color(hex: 0x96968F)).padding(.horizontal, 12)
                } else {
                    ScrollView {
                        VStack(spacing: 2) {
                            ForEach(agentSessions.sessions.prefix(20), id: \.self) { item in
                                let active = selection == .assistant && chat?.sessionID == item.text("id")
                                Button { chat = ChatTarget(sessionID: item.text("id"), initial: nil); selection = .assistant } label: {
                                    Text(item.text("title").isEmpty ? "新对话" : item.text("title")).font(.system(size: 13)).lineLimit(1)
                                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).frame(height: 30)
                                        .foregroundStyle(active ? Color(hex: 0x1D1D1B) : Color(hex: 0x55554F))
                                        .background(active ? Color(hex: 0xE6E6E2) : .clear, in: RoundedRectangle(cornerRadius: 8))
                                }.buttonStyle(.plain)
                            }
                        }
                    }.frame(maxHeight: 240)
                }
                Spacer()
                if user == nil {
                    Button { requestLogin() } label: {
                        HStack(spacing: 8) {
                            Text("我").foregroundStyle(.white).frame(width: 36, height: 36).background(Color(hex: 0x17191C), in: Circle())
                            VStack(alignment: .leading, spacing: 3) {
                                Text("游客模式").font(.system(size: 13.5, weight: .medium))
                                Text("登录 / 恢复登录").font(.system(size: 11)).foregroundStyle(Color(hex: 0x96968F))
                            }
                        }
                    }.buttonStyle(.plain).padding(.horizontal, 6).padding(.bottom, 26)
                } else {
                    Menu {
                        Text(user?.nickname ?? "个人资料")
                        Button("账号设置") { selection = .account }
                        Button("退出登录") { Task { await session.signOut() } }
                    } label: { Label(user?.nickname ?? "个人资料", systemImage: "person.crop.circle") }
                        .padding(.bottom, 26)
                }
            }.padding(.horizontal, 14).frame(width: 216)
            VStack(spacing: 0) {
                if let message = session.errorMessage {
                    HStack {
                        Text(message).font(.callout)
                        if case .restoring = session.phase {
                            Button("重试恢复") { Task { await session.restore() } }
                        }
                    }.padding(12).frame(maxWidth: .infinity).background(.yellow.opacity(0.1))
                }
                switch selection {
                case .home, nil:
                    AssistantHomeView(nickname: user?.nickname, draft: $homeDraft,
                        browse: { selection = .templates }, requireAccount: { requestLogin(reason: "登录 DrawOffer；你的输入会保留。") }, showPlugin: { pluginNotice = true },
                        navigate: { selection = $0 }, editResume: { editResumeID = $0; selection = .resumes },
                        send: { text in chat = ChatTarget(sessionID: nil, initial: text); homeDraft = ""; selection = .assistant })
                case .datasets: DatasetLibraryView(requireAccount: { requestLogin(reason: "登录后管理你的资料库。") })
                        case .mock: MockInterviewView(requireAccount: { requestLogin(reason: "登录后开始模拟面试。") }, showSchedule: { selection = .schedule })
                case .schedule: InterviewScheduleView(requireAccount: { requestLogin(reason: "登录后管理面试安排。") })
                case .jobs: JobsBoardView(requireAccount: { requestLogin(reason: "登录后管理岗位和求职进度。") })
                case .templates:
                    TemplatesView(pendingCreateKey: $pendingCreateKey,
                                  requireLogin: { loginRequest = LoginRequest(template: $0) },
                                  onCreated: { id in editResumeID = id.isEmpty ? nil : id; selection = .resumes })
                case .resumes:
                    ResumesView(focusResumeID: $focusResumeID, editResumeID: $editResumeID, browse: { selection = .templates }, login: { requestLogin() })
                case .assistant:
                    if user != nil, let chat {
                        AssistantChatView(sessionID: chat.sessionID, initialMessage: chat.initial,
                                          created: { _ in Task { await agentSessions.load(api: session.api, account: user?.id ?? "") } },
                                          deleted: { self.chat = nil; selection = .home; Task { await agentSessions.load(api: session.api, account: user?.id ?? "") } },
                                          sessionsChanged: { Task { await agentSessions.load(api: session.api, account: user?.id ?? "") } })
                            .id(chat.token)
                    } else { PlaceholderView(section: .assistant) }
                case .account:
                    if user != nil { AccountView() } else { PlaceholderView(section: .account) }
                case let section?: PlaceholderView(section: section)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.white).clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: 0xE4E4E0)))
                .padding(.vertical, 12).padding(.trailing, 12)
        }.background(Color(hex: 0xF1F1EF))
        .alert("安装浏览器插件", isPresented: $pluginNotice) {
            Button("在浏览器打开") { WebBridge.open("/career/applications", api: session.api) }
            Button("知道了", role: .cancel) {}
        } message: { Text("浏览器插件在 Chrome / Edge 中使用，安装包与安装说明在 Web 的岗位看板页面提供。") }
        .alert("此功能尚未开放", isPresented: $featureNotice) {
            Button("知道了", role: .cancel) {}
        } message: { Text("此功能将在后续版本开放。你已输入的内容会保留，可以继续浏览模板。") }
        .sheet(item: $loginRequest) { request in
            VStack(spacing: 12) {
                HStack {
                    Text(request.reason).font(.headline)
                    Spacer()
                    Button("暂不登录") { loginRequest = nil }
                }.padding(20)
                SignInView()
            }.frame(width: 520, height: 560)
        }
        .environment(router)
        .onChange(of: router.pending) {
            switch router.take() {
            case .section(let section): selection = section
            case .draft(let text): homeDraft = String(text.prefix(4000)); selection = .home
            case .editResume(let id): editResumeID = id; selection = .resumes
            case nil: break
            }
        }
        .task(id: user?.id ?? "") { await agentSessions.load(api: session.api, account: user?.id ?? "") }
        .onChange(of: session.phase) { previous, current in
            if case .signedIn(let nextUser) = current {
                if case .signedIn(let oldUser) = previous, oldUser.id != nextUser.id {
                    pendingCreateKey = nil
                    focusResumeID = nil
                    editResumeID = nil
                    chat = nil
                    loginRequest = nil
                    homeDraft = ""
                    selection = .home
                }
                let template = loginRequest?.template
                loginRequest = nil
                // 登录前选中的示例模板：回到模板页，按 key 匹配真实模板后打开创建弹窗
                if let template { pendingCreateKey = template.key; selection = .templates }
            } else if case .signedIn = previous {
                pendingCreateKey = nil
                focusResumeID = nil
                editResumeID = nil
                chat = nil
                loginRequest = nil
                homeDraft = ""
                selection = .home
            }
        }
    }

    private func requestLogin(reason: String? = nil) {
        if user != nil { featureNotice = true; return }
        loginRequest = LoginRequest(template: nil, reasonOverride: reason)
    }

}

struct WebActionStyle: ButtonStyle {
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.system(size: 13, weight: .medium))
            .foregroundStyle(.white).opacity(enabled ? 1 : 0.5).padding(.horizontal, 16).padding(.vertical, 10)
            .background(Color(hex: 0x17191C).opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct EmptyResumeArt: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            Canvas { context, _ in
                for x in stride(from: 0, through: 504, by: 12) {
                    for y in stride(from: 0, through: 236, by: 12) {
                        context.fill(Path(ellipseIn: CGRect(x: x, y: y, width: 1, height: 1)), with: .color(.gray.opacity(0.15)))
                    }
                }
            }
            VStack(alignment: .leading, spacing: 14) {
                RoundedRectangle(cornerRadius: 2).fill(Color(hex: 0x17191C)).frame(width: 48, height: 7)
                Rectangle().fill(Color(hex: 0xDCDCD8)).frame(width: 72, height: 3)
                ForEach(0..<3) { _ in RoundedRectangle(cornerRadius: 4).stroke(Color(hex: 0xE9E9E5), style: StrokeStyle(lineWidth: 1, dash: [3])).frame(height: 28) }
            }.padding(16).frame(width: 132, height: 176).background(.white)
                .clipShape(RoundedRectangle(cornerRadius: 5)).overlay(RoundedRectangle(cornerRadius: 5).stroke(Color(hex: 0xE4E4E0)))
                .shadow(color: .black.opacity(0.04), radius: 8, y: 4).offset(x: 186, y: 30)
            chip("教育经历", x: 90, y: 68, angle: -4)
            chip("项目经历", x: 336, y: 110, angle: 3)
            chip("专业技能", x: 104, y: 158, angle: 2)
        }.accessibilityHidden(true)
    }
    private func chip(_ title: String, x: CGFloat, y: CGFloat, angle: Double) -> some View {
        Label(title, systemImage: "square.grid.2x2").font(.system(size: 11)).padding(10).background(.white)
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(Color(hex: 0xE4E4E0)))
            .rotationEffect(.degrees(angle)).offset(x: x, y: y)
    }
}

struct PlaceholderView: View {
    let section: WorkspaceSection
    var body: some View {
        ContentUnavailableView(section.title, systemImage: section.symbol,
            description: Text("原生版本待实现"))
            .navigationTitle(section.title)
    }
}
