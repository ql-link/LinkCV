import Foundation

/// App 注入真实 HTTP 客户端；Mock 仅用于离线测试。
public protocol APIClient: Sendable {
    func uploadDataset(_ upload: DatasetUpload) async throws -> JSONValue
    func downloadDataset(id: String, limit: Int64) async throws -> DatasetFile
    func careerRequest(path: String, method: String, query: [String: String], body: JSONValue?) async throws -> JSONValue
    func currentUser() async throws -> User?
    func signIn(email: String, password: String) async throws -> User
    func signOut() async throws
    func preparePaper(_ request: ResumeRenderRequest) async throws -> PaperPreparation
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


extension APIClient {
    public func uploadDataset(_ upload: DatasetUpload) async throws -> JSONValue { throw APIError.unauthorized }
    public func downloadDataset(id: String, limit: Int64) async throws -> DatasetFile { throw APIError.unauthorized }
    public func careerRequest(path: String, method: String = "GET", query: [String: String] = [:], body: JSONValue? = nil) async throws -> JSONValue { throw APIError.unauthorized }
    public func preparePaper(_ request: ResumeRenderRequest) async throws -> PaperPreparation {
        try await PaperAssets.prepare(request, account: "") { _, _ in throw APIError.invalidResponse }
    }
}
