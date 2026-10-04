/// 导航标识保持兼容；客户端入口以 origin/dev 的 V3Shell 工作区侧栏为准。
public enum WorkspaceSection: String, CaseIterable, Identifiable, Sendable {
    case home, resumes, templates, jobs, schedule, mock, datasets

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .home: "首页"
        case .resumes: "我的简历"
        case .templates: "简历模板"
        case .jobs: "岗位看板"
        case .schedule: "面试日程"
        case .mock: "模拟面试"
        case .datasets: "资料库"
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
        }
    }
}
