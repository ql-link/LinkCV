import AppKit
import LinkResumeCore
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
    @State private var creationTemplate: ResumeTemplate?
    @State private var featureNotice = false
    @State private var homeDraft = ""
    @State private var pluginNotice = false

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
                    } else { Text("LinkResume").font(.title3.bold()) }
                }.buttonStyle(.plain).accessibilityLabel("LinkResume 首页").padding(.leading, 8).padding(.top, 24).padding(.bottom, 10)
                Button { selection = .home; homeDraft = "" } label: {
                    Label("新建对话", systemImage: "plus").font(.system(size: 13.5))
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).frame(height: 34)
                }.buttonStyle(.plain)
                VStack(spacing: 4) {
                    ForEach(WorkspaceSection.allCases) { section in
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
                Text(user == nil ? "登录后读取对话" : "原生对话列表尚未接入")
                    .font(.system(size: 12)).foregroundStyle(Color(hex: 0x96968F)).padding(.horizontal, 12)
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
                        browse: { selection = .templates }, requireAccount: { requestLogin(reason: "登录 LinkResume；你的输入会保留。") }, showPlugin: { pluginNotice = true })
                case .datasets: DatasetLibraryView(requireAccount: { requestLogin(reason: "登录后管理你的资料库。") })
                        case .mock: MockInterviewView(requireAccount: { requestLogin(reason: "登录后开始模拟面试。") }, showSchedule: { selection = .schedule })
                case .schedule: InterviewScheduleView(requireAccount: { requestLogin(reason: "登录后管理面试安排。") })
                case .jobs: JobsBoardView(requireAccount: { requestLogin(reason: "登录后管理岗位和求职进度。") })
                case .templates: TemplatesView(initialSelectedID: creationTemplate?.id, onUseTemplate: useTemplate)
                case .resumes:
                    if let template = creationTemplate, user != nil {
                        VStack(alignment: .leading, spacing: 20) {
                            Text("已选择：\(template.name)").font(.title2.bold())
                            Text("登录已完成，模板选择已保留。原生简历创建与编辑尚未接入，此时没有保存新的简历。")
                            Button("返回模板预览") { selection = .templates }.buttonStyle(WebActionStyle())
                        }.padding(52).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    } else { HomeView(nickname: user?.nickname, browse: { selection = .templates }, login: { requestLogin() }) }
                case let section?: PlaceholderView(section: section)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.white).clipShape(RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: 0xE4E4E0)))
                .padding(.vertical, 12).padding(.trailing, 12)
        }.background(Color(hex: 0xF1F1EF))
        .alert("安装浏览器插件", isPresented: $pluginNotice) {
            Button("知道了", role: .cancel) {}
        } message: { Text("插件安装入口尚未开放。你仍可以浏览模板和示例简历。") }
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
        .onChange(of: session.phase) { previous, current in
            if case .signedIn(let nextUser) = current {
                if case .signedIn(let oldUser) = previous, oldUser.id != nextUser.id {
                    creationTemplate = nil
                    loginRequest = nil
                    homeDraft = ""
                    selection = .home
                }
                let template = loginRequest?.template
                loginRequest = nil
                if let template { creationTemplate = template; selection = .resumes }
            } else if case .signedIn = previous {
                creationTemplate = nil
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

    private func useTemplate(_ template: ResumeTemplate) {
        if user != nil { creationTemplate = template; selection = .resumes }
        else {
            loginRequest = LoginRequest(template: template)
        }
    }
}

private struct HomeView: View {
    let nickname: String?
    let browse: () -> Void
    let login: () -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("RESUMES  /  \(nickname == nil ? "游客预览" : "个人工作区")")
                    .font(.system(size: 11, weight: .medium)).foregroundStyle(Tokens.Color.textMuted)
                Text("我的简历").font(.custom("Songti SC", size: 28).weight(.semibold)).padding(.top, 9)
                Text("每份简历独立编辑，需要时复制一份按岗位修改。")
                    .font(.system(size: 13)).foregroundStyle(Tokens.Color.textMuted).padding(.top, 6)
                Divider().padding(.top, 24)
                VStack(spacing: 12) {
                    EmptyResumeArt().frame(width: 504, height: 236)
                    Text(nickname == nil ? "从第一份简历开始" : "个人简历列表尚未接入")
                        .font(.custom("Songti SC", size: 18).weight(.semibold))
                    Text(nickname == nil ? "新建时选一套模板、起个名字；已有简历文件可以用「导入简历」。" : "尚未查询你的账号数据，这里不代表你没有简历。")
                        .font(.system(size: 13)).foregroundStyle(Tokens.Color.textMuted)
                    HStack(spacing: 20) {
                        Button("新建简历 →", action: browse).buttonStyle(WebActionStyle())
                        Button("导入简历", systemImage: "square.and.arrow.up", action: login).buttonStyle(.plain)
                    }.padding(.top, 8)
                    Text("内置示例可离线预览；保存、导入与个人数据需登录，原生写入功能尚未接入。")
                        .font(.system(size: 12)).foregroundStyle(Tokens.Color.textMuted).padding(.top, 8)
                }.frame(maxWidth: .infinity).padding(.top, 42)
            }.frame(maxWidth: 860, alignment: .leading).padding(.horizontal, 52).padding(.vertical, 51)
                .frame(maxWidth: .infinity)
        }
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

private struct EmptyResumeArt: View {
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
