import Foundation

/// 真实后端客户端（骨架）。与 Web 的区别只在凭据载体：
///   Web     HttpOnly Cookie（channel=web）
///   小程序  Bearer + JSON refresh（channel=miniprogram）
///   桌面    Bearer + Keychain 保存 refresh（channel=desktop，需后端新增，见 apps/native/README.md）
/// 目前后端没有 desktop 渠道，所以这里只实现请求管线，登录相关方法直接报未实现。
public struct HTTPAPIClient: APIClient {
    public let baseURL: URL
    private let tokens: TokenStore
    private let session: URLSession

    public init(baseURL: URL, tokens: TokenStore, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.tokens = tokens
        self.session = session
    }

    public func currentUser() async throws -> User? {
        struct Envelope: Decodable { let user: User? }
        return try await request(Envelope.self, path: "/api/auth/me").user
    }

    public func signIn(email: String, password: String) async throws -> User {
        throw APIError.server(status: 501, code: "DESKTOP_CHANNEL_NOT_AVAILABLE")
    }

    public func signOut() async throws {
        try tokens.clear()
    }

    public func listResumeTemplates() async throws -> [ResumeTemplate] {
        struct Envelope: Decodable { let templates: [ResumeTemplate] }
        return try await request(Envelope.self, path: "/api/resume-templates").templates
    }

    /// 统一请求管线：注入 Bearer 与 X-Request-ID，按后端 `{error: CODE}` 约定转换错误。
    /// 401 后的 refresh 轮换等 desktop 渠道落地后在这里补。
    func request<T: Decodable>(_ type: T.Type, path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Request-ID")
        if let token = try tokens.accessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 { throw APIError.unauthorized }
            let code = (try? JSONDecoder().decode([String: JSONValue].self, from: data))?["error"]?.stringValue
            throw APIError.server(status: http.statusCode, code: code ?? "HTTP_\(http.statusCode)")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

/// 令牌存储抽象。正式实现走 Keychain（KeychainTokenStore，desktop 渠道落地时补），测试用内存实现。
public protocol TokenStore: Sendable {
    func accessToken() throws -> String?
    func clear() throws
}
