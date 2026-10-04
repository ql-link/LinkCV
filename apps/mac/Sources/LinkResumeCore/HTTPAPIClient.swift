import Foundation

private final class RedirectBlocker: NSObject, URLSessionTaskDelegate, Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

protocol DesktopRequesting: Sendable {
    func uploadDataset(_ upload: DatasetUpload, access: String?) async throws -> JSONValue
    func downloadDataset(id: String, to: URL, limit: Int64, access: String?) async throws
    var origin: URL { get }
    func downloadImage(path: String, limit: Int, access: String?) async throws -> DesktopImage
    func career(path: String, method: String, query: [String: String], body: JSONValue?, access: String?) async throws -> JSONValue
    func send<T: Decodable & Sendable>(_ type: T.Type, path: String, body: [String: String]?, access: String?) async throws -> T
}

extension DesktopRequesting {
    func uploadDataset(_ upload: DatasetUpload, access: String?) async throws -> JSONValue { throw APIError.invalidResponse }
    func downloadDataset(id: String, to: URL, limit: Int64, access: String?) async throws { throw APIError.invalidResponse }
    func career(path: String, method: String, query: [String: String], body: JSONValue?, access: String?) async throws -> JSONValue { throw APIError.invalidResponse }
    func downloadImage(path: String, limit: Int, access: String?) async throws -> DesktopImage { throw APIError.invalidResponse }
    func send<T: Decodable & Sendable>(_ type: T.Type, path: String, body: [String: String]? = nil) async throws -> T {
        try await send(type, path: path, body: body, access: nil)
    }
}

final class DesktopTransport: DesktopRequesting {
    let origin: URL
    let session: URLSession

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

    func downloadImage(path: String, limit: Int, access: String?) async throws -> DesktopImage {
        guard path.hasPrefix("/api/"), !path.contains(".."), !path.contains("?"), !path.contains("#"), limit > 0 else { throw APIError.invalidResponse }
        var request = URLRequest(url: origin.appending(path: path), cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("image/png, image/jpeg", forHTTPHeaderField: "Accept")
        if let access { request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization") }
        let (bytes, response) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard http.statusCode == 200 else {
            if http.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.server(status: http.statusCode, code: "IMAGE_READ_FAILED")
        }
        guard let type = http.mimeType?.lowercased(), ["image/png", "image/jpeg"].contains(type),
              http.expectedContentLength <= Int64(limit) else { throw APIError.invalidResponse }
        var data = Data()
        for try await byte in bytes {
            try Task.checkCancellation()
            guard data.count < limit else { throw APIError.invalidResponse }
            data.append(byte)
        }
        return DesktopImage(data: data, contentType: type)
    }

    func career(path: String, method: String, query: [String: String], body: JSONValue?, access: String?) async throws -> JSONValue {
        guard CareerRequest.allowed(path: path, method: method), !query.keys.contains(where: { !["scope", "cursor", "limit", "week_start", "timezone", "application_id", "include_archived", "v", "job_application_id", "resume_id", "status", "folder_id", "confirm_contents"].contains($0) }) else { throw APIError.invalidResponse }
        var url = URLComponents(url: origin.appending(path: path), resolvingAgainstBaseURL: false)!
        url.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
        var request = URLRequest(url: url.url!)
        request.httpMethod = method
        var payload = body
        if MockInterviewRequest.allowed(path: path, method: method), path.hasSuffix("/answers") || path.hasSuffix("/skip") {
            guard let key = body?.text("__idempotency_key"), let id = UUID(uuidString: key), id.uuidString.lowercased() == key,
                  case .object(var fields) = body else { throw APIError.invalidResponse }
            fields.removeValue(forKey: "__idempotency_key"); payload = .object(fields)
            request.setValue(key, forHTTPHeaderField: "Idempotency-Key")
        }
        request.timeoutInterval = 180
        request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Request-ID")
        if let access { request.setValue("Bearer \(access)", forHTTPHeaderField: "Authorization") }
        if path.hasSuffix("/logo") {
            guard method == "GET", query.count == 1, let revision = query["v"], revision.count == 64,
                  revision.allSatisfy({ ("0"..."9").contains(String($0)) || ("a"..."f").contains(String($0)) }) else { throw APIError.invalidResponse }
            request.setValue("image/webp", forHTTPHeaderField: "Accept")
            let (bytes, response) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
            if http.statusCode == 401 { throw APIError.unauthorized }
            guard http.statusCode == 200, http.mimeType == "image/webp", http.expectedContentLength <= 256 * 1024 else { throw APIError.invalidResponse }
            var data = Data()
            for try await byte in bytes {
                try Task.checkCancellation()
                guard data.count < 256 * 1024 else { throw APIError.invalidResponse }
                data.append(byte)
            }
            guard data.count >= 12, String(decoding: data.prefix(4), as: UTF8.self) == "RIFF",
                  String(decoding: data[8..<12], as: UTF8.self) == "WEBP" else { throw APIError.invalidResponse }
            return .object(["image_base64": .string(data.base64EncodedString())])
        }
        if let body {
            if path == "/api/job-descriptions/parse-draft" {
                let boundary = "LinkResume-" + UUID().uuidString
                var data = Data()
                func append(_ text: String) { data.append(Data(text.utf8)) }
                if let encoded = body["image_base64"]?.stringValue {
                    guard let image = Data(base64Encoded: encoded), image.count <= 10 * 1024 * 1024 else { throw APIError.invalidResponse }
                    let type = body.text("content_type")
                    guard ["image/png", "image/jpeg"].contains(type) else { throw APIError.invalidResponse }
                    append("--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"upload.\(type == "image/png" ? "png" : "jpg")\"\r\nContent-Type: \(type)\r\n\r\n")
                    data.append(image); append("\r\n")
                } else { append("--\(boundary)\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n\(body.text("text"))\r\n") }
                append("--\(boundary)--\r\n"); request.httpBody = data
                request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            } else if path.hasSuffix("/written-questions:extract") {
                let (data, type) = try CareerUpload.writtenImport(body)
                request.httpBody = data; request.setValue(type, forHTTPHeaderField: "Content-Type")
            } else { request.httpBody = try JSONEncoder().encode(payload); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        }
        let data: Data
        let response: URLResponse
        if path.hasPrefix("/api/mock-interviews/") && method == "POST" && ["answers", "skip", "reply:retry"].contains(String(path.split(separator: "/").last ?? "")) {
            let (bytes, headers) = try await session.bytes(for: request)
            defer { bytes.task.cancel() }
            guard headers.expectedContentLength <= 4 * 1024 * 1024 else { throw APIError.invalidResponse }
            var buffer = Data()
            for try await byte in bytes {
                try Task.checkCancellation()
                guard buffer.count < 4 * 1024 * 1024 else { throw APIError.invalidResponse }
                buffer.append(byte)
            }
            data = buffer; response = headers
        } else { (data, response) = try await session.data(for: request) }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let code = (try? JSONDecoder().decode(JSONValue.self, from: data))?["error"]?.stringValue
            throw APIError.server(status: http.statusCode, code: code ?? "HTTP_\(http.statusCode)")
        }
        if http.mimeType == "text/event-stream", path.hasPrefix("/api/mock-interviews/") { return try MockInterviewRequest.decodeEvents(data) }
        if http.statusCode == 204 || data.isEmpty { return .null }
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

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

    public func preparePaper(_ request: ResumeRenderRequest) async throws -> PaperPreparation { try await coordinator.preparePaper(request) }
    public func uploadDataset(_ upload: DatasetUpload) async throws -> JSONValue { try await coordinator.uploadDataset(upload) }
    public func downloadDataset(id: String, limit: Int64) async throws -> DatasetFile { try await coordinator.downloadDataset(id: id, limit: limit) }
    public func careerRequest(path: String, method: String, query: [String: String], body: JSONValue?) async throws -> JSONValue { try await coordinator.careerRequest(path: path, method: method, query: query, body: body) }
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
