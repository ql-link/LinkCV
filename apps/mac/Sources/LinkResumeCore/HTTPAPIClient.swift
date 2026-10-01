import Foundation

private final class RedirectBlocker: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

protocol DesktopRequesting: Sendable {
    var origin: URL { get }
    func send<T: Decodable & Sendable>(_ type: T.Type, path: String, body: [String: String]?, access: String?) async throws -> T
}

extension DesktopRequesting {
    func send<T: Decodable & Sendable>(_ type: T.Type, path: String, body: [String: String]? = nil) async throws -> T {
        try await send(type, path: path, body: body, access: nil)
    }
}

final class DesktopTransport: DesktopRequesting {
    let origin: URL
    private let session: URLSession

    init(origin: URL, allowLocalHTTP: Bool = false, protocolClasses: [AnyClass]? = nil) throws {
        guard let host = origin.host, !host.isEmpty,
              origin.user == nil, origin.password == nil, origin.query == nil, origin.fragment == nil,
              origin.path.isEmpty || origin.path == "/",
              origin.scheme == "https" || (allowLocalHTTP && origin.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(origin.host ?? "")) else {
            throw APIError.invalidResponse
        }
        self.origin = origin.appendingPathComponent("")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.protocolClasses = protocolClasses
        session = URLSession(configuration: configuration, delegate: RedirectBlocker(), delegateQueue: nil)
    }

    deinit { session.invalidateAndCancel() }

    func send<T: Decodable & Sendable>(_ type: T.Type, path: String, body: [String: String]? = nil, access: String? = nil) async throws -> T {
        guard path.hasPrefix("/api/"), !path.contains(".."), !path.contains("?"), !path.contains("#") else { throw APIError.invalidResponse }
        var request = URLRequest(url: origin.appending(path: path))
        request.httpMethod = body == nil ? "GET" : "POST"
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Request-ID")
        if let access { request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
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

public struct DesktopCapabilities: Decodable, Sendable {
    public let wechat_login_enabled: Bool
    public let session_protocol: Int
}

public struct DesktopQRCode: Decodable, Sendable {
    public let scene: String
    public let poll_token: String
    public let qr_base64: String
    public let expires_in: Int
    public let poll_interval_seconds: Int
}

struct DesktopTokens: Decodable, Sendable {
    let user: User
    let access_token: String
    let refresh_token: String
    let expires_in: Int
    let session_protocol: Int
}

public struct HTTPAPIClient: APIClient {
    public let coordinator: SessionCoordinator

    public init(baseURL: URL, tokens: any TokenStore, allowLocalHTTP: Bool = false) throws {
        coordinator = SessionCoordinator(transport: try DesktopTransport(origin: baseURL, allowLocalHTTP: allowLocalHTTP), tokens: tokens)
    }

    init(coordinator: SessionCoordinator) { self.coordinator = coordinator }

    public func capabilities() async throws -> DesktopCapabilities { try await coordinator.capabilities() }
    public func beginLogin(clientVersion: String) async throws -> DesktopLoginChallenge { try await coordinator.beginLogin(clientVersion: clientVersion) }
    public func loginStatus(_ challenge: DesktopLoginChallenge) async throws -> String { try await coordinator.loginStatus(challenge) }
    public func completeLogin(_ challenge: DesktopLoginChallenge) async throws -> User { try await coordinator.completeLogin(challenge) }
    public func currentUser() async throws -> User? { try await coordinator.restore() }
    public func signIn(email: String, password: String) async throws -> User {
        throw APIError.server(status: 405, code: "DESKTOP_WECHAT_LOGIN_REQUIRED")
    }
    public func signOut() async throws { try await coordinator.signOut() }
    public func listResumeTemplates() async throws -> [ResumeTemplate] {
        struct Envelope: Decodable, Sendable { let templates: [ResumeTemplate] }
        return try await coordinator.request(Envelope.self, path: "/api/resume-templates").templates
    }
}
