/// 导航标识保持兼容；客户端入口以 origin/dev 的 V3Shell 工作区侧栏为准。
public enum WorkspaceSection: String, CaseIterable, Identifiable, Sendable {
    case home, resumes, templates, jobs, schedule, mock, datasets, account, assistant

    public var id: String { rawValue }

    /// 侧栏主导航（账号页从底部账号入口进入，AI 对话从“新建对话”与最近对话进入）。
    public static let sidebar: [WorkspaceSection] = [.home, .resumes, .templates, .jobs, .schedule, .mock, .datasets]

    public var title: String {
        switch self {
        case .home: "首页"
        case .resumes: "我的简历"
        case .templates: "简历模板"
        case .jobs: "岗位看板"
        case .schedule: "面试日程"
        case .mock: "模拟面试"
        case .datasets: "资料库"
        case .account: "账号设置"
        case .assistant: "AI 对话"
        }
    }

    /// SF Symbols 名称；Windows 端用 Segoe Fluent Icons 的对应图标。
    public var symbol: String {
        switch self {
        case .home: "sun.max"
        case .resumes: "doc.text"
        case .templates: "rectangle.3.group"
        case .jobs: "briefcase"
        case .schedule: "calendar"
        case .mock: "mic"
        case .datasets: "folder"
        case .account: "person.crop.circle"
        case .assistant: "bubble.left.and.text.bubble.right"
        }
    }
}
