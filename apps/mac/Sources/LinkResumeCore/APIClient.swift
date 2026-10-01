import Foundation

/// 业务数据入口。界面只依赖这个协议：现在用 MockAPIClient 跑通，
/// 后端补上 desktop 渠道（Bearer 会话）后换成 HTTPAPIClient，界面不用改。
public protocol APIClient: Sendable {
    func currentUser() async throws -> User?
    func signIn(email: String, password: String) async throws -> User
    func signOut() async throws
    func listResumeTemplates() async throws -> [ResumeTemplate]
}

public enum APIError: Error, Equatable {
    case unauthorized
    case server(status: Int, code: String)
    case invalidResponse
}

/// 离线 mock：模板来自 apps/native/shared/fixtures（后端布局编译器生成，内容虚构）。
/// 需后端：登录目前不校验密码，任意邮箱都能进。
public actor MockAPIClient: APIClient {
    private var user: User?

    public init(signedIn: Bool = false) {
        user = signedIn ? MockAPIClient.previewUser : nil
    }

    public static let previewUser = User(id: "1", email: "v3-preview@example.com", nickname: "预览用户", isAdmin: false)

    public func currentUser() async throws -> User? { user }

    public func signIn(email: String, password: String) async throws -> User {
        guard !email.isEmpty, !password.isEmpty else { throw APIError.server(status: 400, code: "INVALID_CREDENTIALS") }
        let signedIn = User(id: "1", email: email, nickname: email.split(separator: "@").first.map(String.init) ?? "用户", isAdmin: false)
        user = signedIn
        return signedIn
    }

    public func signOut() async throws { user = nil }

    public func listResumeTemplates() async throws -> [ResumeTemplate] {
        guard user != nil else { throw APIError.unauthorized }
        guard let url = Bundle.module.url(forResource: "resume-templates", withExtension: "json") else {
            throw APIError.invalidResponse
        }
        struct Envelope: Decodable { let templates: [ResumeTemplate] }
        return try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: url)).templates
    }
}
