import CryptoKit
import Foundation
import Security

public struct RefreshJournal: Codable, Sendable {
    public let requestID: String
    public let refreshToken: String
    public let startedAt: Date
}

public struct DesktopCredentialRecord: Codable, Sendable {
    public let accountID: String
    public let refreshToken: String
    public let generation: UUID
    public let pending: RefreshJournal?

    public init(accountID: String, refreshToken: String, generation: UUID, pending: RefreshJournal? = nil) {
        self.accountID = accountID
        self.refreshToken = refreshToken
        self.generation = generation
        self.pending = pending
    }
}

// Implementations must atomically replace the record in a system credential store, scoped by origin/channel/app.
public protocol TokenStore: Sendable {
    func load(scope: String) throws -> DesktopCredentialRecord?
    func save(_ record: DesktopCredentialRecord, scope: String) throws
    func clear(scope: String) throws
}

public struct DesktopLoginChallenge: Sendable {
    public let qrcode: DesktopQRCode
    fileprivate let verifier: String
    fileprivate let requestID: String
    fileprivate let generation: UUID
}

public actor SessionCoordinator {
    public nonisolated var origin: URL { transport.origin }
    private let transport: any DesktopRequesting
    private let tokens: any TokenStore
    private let scope: String
    private var generation = UUID()
    private var disabled = false
    private var access: String?
    private var accessDeadline = Date.distantPast
    private var flight: (id: UUID, task: Task<DesktopTokens, Error>)?
    private var exchange: (requestID: String, task: Task<DesktopTokens, Error>)?
    private typealias LogoutRecovery = (id: UUID, saved: DesktopCredentialRecord?, refresh: Task<DesktopTokens, Error>?, exchange: Task<DesktopTokens, Error>?)
    private var logoutRecovery: LogoutRecovery?
    private var logoutFlight: (id: UUID, task: Task<Void, Error>)?

    init(transport: any DesktopRequesting, tokens: any TokenStore) {
        self.transport = transport
        self.tokens = tokens
        scope = "LinkResume:macos:desktop:\(transport.origin.absoluteString)"
    }

    public func capabilities() async throws -> DesktopCapabilities {
        let result = try await transport.send(DesktopCapabilities.self, path: "/api/auth/desktop/capabilities")
        guard result.session_protocol == 1 else { throw APIError.invalidResponse }
        return result
    }

    public func beginLogin(clientVersion: String) async throws -> DesktopLoginChallenge {
        let current = UUID()
        try await signOut(generation: current)
        guard generation == current else { throw APIError.unauthorized }
        disabled = false
        var random = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, random.count, &random) == errSecSuccess else { throw APIError.invalidResponse }
        let verifier = base64url(Data(random))
        let challenge = base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        let qr = try await transport.send(DesktopQRCode.self, path: "/api/auth/desktop/wechat/qrcode", body: [
            "platform": "macos", "client_version": clientVersion,
            "code_challenge": challenge, "code_challenge_method": "S256",
        ])
        guard current == generation, !disabled else { throw APIError.unauthorized }
        return DesktopLoginChallenge(qrcode: qr, verifier: verifier, requestID: UUID().uuidString, generation: current)
    }

    public func loginStatus(_ challenge: DesktopLoginChallenge) async throws -> String {
        guard challenge.generation == generation, !disabled else { throw APIError.unauthorized }
        struct Status: Decodable, Sendable { let status: String }
        let result = try await transport.send(Status.self, path: "/api/auth/desktop/wechat/status", body: [
            "scene": challenge.qrcode.scene, "poll_token": challenge.qrcode.poll_token,
        ])
        guard challenge.generation == generation, !disabled else { throw APIError.unauthorized }
        return result.status
    }

    public func completeLogin(_ challenge: DesktopLoginChallenge) async throws -> User {
        guard challenge.generation == generation, !disabled else { throw APIError.unauthorized }
        guard exchange == nil || exchange?.requestID == challenge.requestID else { throw APIError.unauthorized }
        if exchange == nil {
            exchange = (challenge.requestID, Task {
                try await transport.send(DesktopTokens.self, path: "/api/auth/desktop/wechat/exchange", body: [
                    "scene": challenge.qrcode.scene, "poll_token": challenge.qrcode.poll_token,
                    "code_verifier": challenge.verifier, "request_id": challenge.requestID,
                ])
            })
        }
        let shared = exchange!
        let result: DesktopTokens
        do { result = try await sharedTaskValue(shared.task) }
        catch is CancellationError { throw CancellationError() }
        catch {
            if exchange?.requestID == shared.requestID { exchange = nil }
            throw error
        }
        try Task.checkCancellation()
        guard challenge.generation == generation, !disabled else { throw APIError.unauthorized }
        if exchange?.requestID == shared.requestID {
            try persist(result, expectedAccount: nil)
            exchange = nil
        }
        return result.user
    }

    public func restore() async throws -> User? {
        guard !disabled, try tokens.load(scope: scope) != nil else { return nil }
        let current = generation
        _ = try await refresh()
        guard generation == current, !disabled else { throw APIError.unauthorized }
        struct Envelope: Decodable, Sendable { let user: User }
        let result = try await request(Envelope.self, path: "/api/auth/desktop/me")
        guard generation == current, !disabled else { throw APIError.unauthorized }
        return result.user
    }

    func request<T: Decodable & Sendable>(_ type: T.Type, path: String) async throws -> T {
        let transport = self.transport
        return try await authorized { access in try await transport.send(type, path: path, body: nil, access: access) }
    }

    public func careerRequest(path: String, method: String, query: [String: String], body: JSONValue?) async throws -> JSONValue {
        guard CareerRequest.allowed(path: path, method: method) else { throw APIError.invalidResponse }
        let transport = self.transport
        return try await authorized { access in try await transport.career(path: path, method: method, query: query, body: body, access: access) }
    }

    public func uploadDataset(_ upload: DatasetUpload) async throws -> JSONValue {
        let transport = self.transport
        return try await authorized { access in try await transport.uploadDataset(upload, access: access) }
    }
    public func downloadDataset(id: String, limit: Int64) async throws -> DatasetFile {
        let directory = try DatasetUpload.privateDirectory(), target = directory.appendingPathComponent("source")
        let transport = self.transport
        do { try await authorized { access in try await transport.downloadDataset(id:id, to:target, limit:limit, access:access) }; return DatasetFile(url:target,directory:directory) }
        catch { try? FileManager.default.removeItem(at:directory); throw error }
    }

    /// 本人简历列表；generation 拒绝退出或切换账号后的迟到结果。
    public func listResumes() async throws -> [ResumeSummary] {
        struct Envelope: Decodable, Sendable { let resumes: [ResumeSummary] }
        let current = generation
        let result = try await request(Envelope.self, path: "/api/resumes").resumes
        guard current == generation, !disabled else { throw APIError.unauthorized }
        return result
    }

    /// 单份 PDF 最多 20 MiB，只保存在内存，由界面写到用户选择的位置。
    public func downloadResumePDF(id: String, lockVersion: Int) async throws -> Data {
        let transport = self.transport, current = generation
        let data = try await authorized { access in try await transport.downloadResumePDF(id: id, lockVersion: lockVersion, limit: 20 * 1024 * 1024, access: access) }
        guard current == generation, !disabled else { throw APIError.unauthorized }
        return data
    }

    /// 本人头像（`/api/assets/users/{本人}/assets/avatar/...`），只接受当前账号路径与 PNG/JPEG，最多 4 MiB，不缓存。
    public func accountAvatar(path: String) async throws -> Data {
        guard !disabled, let account = try tokens.load(scope: scope)?.accountID else { throw APIError.unauthorized }
        let checked = try PaperAssets.path(path, account: account)
        guard checked.hasPrefix("/api/assets/users/\(account)/assets/") else { throw APIError.invalidResponse }
        let current = generation
        let image = try await self.image(path: checked, limit: 4 * 1024 * 1024)
        guard current == generation, !disabled else { throw APIError.unauthorized }
        return image.data
    }

    public func mockAudio(path: String, method: String, body: JSONValue?) async throws -> Data {
        let transport = self.transport
        return try await authorized { access in try await transport.mockAudio(path: path, method: method, body: body, access: access) }
    }

    /// 打开识别 WebSocket 前先确保 access 有效；握手失败（4401）由界面按登录失效处理。
    public func speechSocket(interviewID: String, questionID: String, purpose: String) async throws -> URLSessionWebSocketTask {
        let transport = self.transport
        return try await authorized { access in
            try transport.speechSocket(path: "/api/mock-interviews/\(interviewID)/speech", query: ["question_id": questionID, "purpose": purpose], access: access)
        }
    }

    public func importResume(_ upload: ResumeImportUpload) async throws -> JSONValue {
        let transport = self.transport
        return try await authorized { access in try await transport.importResume(upload, access: access) }
    }

    /// AI 助手 SSE。只在开始响应前处理 401 续期；已开始的流不重放，避免重复提交消息（消息自带幂等键）。
    public func streamAgent(path: String, method: String, body: JSONValue?, onEvent: @MainActor @Sendable (AgentEvent) async -> Void) async throws {
        let transport = self.transport, current = generation
        try await authorized { access in
            try await transport.streamAgent(path: path, method: method, body: body, access: access, onEvent: onEvent)
        }
        guard current == generation, !disabled else { throw APIError.unauthorized }
    }

    public func preparePaper(_ request: ResumeRenderRequest) async throws -> PaperPreparation {
        guard !disabled, let account = try tokens.load(scope: scope)?.accountID else { throw APIError.unauthorized }
        let current = generation
        let result = try await PaperAssets.prepare(request, account: account) { path, limit in
            try await self.image(path: path, limit: limit)
        }
        guard current == generation, !disabled else { throw APIError.unauthorized }
        return result
    }

    private func image(path: String, limit: Int) async throws -> DesktopImage {
        let transport = self.transport
        return try await authorized { access in try await transport.downloadImage(path: path, limit: limit, access: access) }
    }

    private func authorized<T: Sendable>(_ send: @Sendable (String?) async throws -> T) async throws -> T {
        guard !disabled else { throw APIError.unauthorized }
        let current = generation
        if access == nil || accessDeadline <= Date() { _ = try await refresh() }
        guard generation == current, !disabled else { throw APIError.unauthorized }
        let sentAccess = access
        do {
            let result = try await send(sentAccess)
            guard generation == current, !disabled else { throw APIError.unauthorized }
            return result
        } catch APIError.unauthorized {
            guard generation == current, !disabled else { throw APIError.unauthorized }
            if access == sentAccess { _ = try await refresh() }
            guard generation == current, !disabled else { throw APIError.unauthorized }
            do {
                let result = try await send(access)
                guard generation == current, !disabled else { throw APIError.unauthorized }
                return result
            } catch APIError.unauthorized {
                if generation == current { try invalidate() }
                throw APIError.unauthorized
            }
        }
    }

    private func refresh() async throws -> DesktopTokens {
        guard !disabled, let saved = try tokens.load(scope: scope) else { throw APIError.unauthorized }
        let current = generation
        if flight == nil {
            let journal = saved.pending ?? RefreshJournal(requestID: UUID().uuidString, refreshToken: saved.refreshToken, startedAt: Date())
            guard Date().timeIntervalSince(journal.startedAt) < 120 else {
                try invalidate()
                throw APIError.unauthorized
            }
            try tokens.save(DesktopCredentialRecord(accountID: saved.accountID, refreshToken: saved.refreshToken,
                                                   generation: saved.generation, pending: journal), scope: scope)
            let id = UUID()
            flight = (id, Task {
                do {
                    let result = try await transport.send(DesktopTokens.self, path: "/api/auth/desktop/refresh", body: [
                        "refresh_token": journal.refreshToken, "request_id": journal.requestID,
                    ])
                    if generation == current, !disabled {
                        access = nil
                        try persist(result, expectedAccount: saved.accountID)
                    }
                    if flight?.id == id { flight = nil }
                    return result
                } catch {
                    if flight?.id == id { flight = nil }
                    if generation == current, case APIError.unauthorized = error { try invalidate() }
                    throw error
                }
            })
        }
        let shared = flight!
        let result = try await sharedTaskValue(shared.task)
        try Task.checkCancellation()
        guard generation == current, !disabled else { throw APIError.unauthorized }
        return result
    }

    private func persist(_ result: DesktopTokens, expectedAccount: String?) throws {
        guard result.session_protocol == 1, result.expires_in >= 0,
              !result.access_token.isEmpty, !result.refresh_token.isEmpty,
              expectedAccount == nil || expectedAccount == result.user.id else { throw APIError.invalidResponse }
        try tokens.save(DesktopCredentialRecord(accountID: result.user.id, refreshToken: result.refresh_token,
                                               generation: generation), scope: scope)
        access = result.access_token
        accessDeadline = Date().addingTimeInterval(TimeInterval(result.expires_in))
    }

    private func invalidate() throws {
        disabled = true
        generation = UUID()
        access = nil
        flight = nil
        try tokens.clear(scope: scope)
    }

    public func signOut() async throws {
        try await signOut(generation: UUID())
    }

    private func signOut(generation nextGeneration: UUID) async throws {
        disabled = true
        generation = nextGeneration
        access = nil
        let shared = flight
        flight = nil
        let pendingExchange = exchange
        exchange = nil
        let currentSaved = try tokens.load(scope: scope)
        if logoutRecovery == nil, currentSaved != nil || pendingExchange != nil {
            logoutRecovery = (UUID(), currentSaved, shared?.task, pendingExchange?.task)
        }
        var clearError: (any Error)?
        do { try tokens.clear(scope: scope) } catch { clearError = error }
        guard let recovery = logoutRecovery else {
            if let clearError { throw clearError }
            return
        }
        if logoutFlight == nil {
            logoutFlight = (UUID(), Task { try await revoke(recovery) })
        }
        let remote = logoutFlight!
        do { try await remote.task.value }
        catch {
            if logoutFlight?.id == remote.id { logoutFlight = nil }
            throw APIError.server(status: 503, code: "REMOTE_LOGOUT_UNCONFIRMED")
        }
        if logoutFlight?.id == remote.id { logoutFlight = nil }
        if let clearError { throw clearError }
        if logoutRecovery?.id == recovery.id { logoutRecovery = nil }
    }

    private func revoke(_ recovery: LogoutRecovery) async throws {
        let saved = recovery.saved
        var refresh = saved?.refreshToken ?? ""
        do {
            if let pendingExchange = recovery.exchange { refresh = try await pendingExchange.value.refresh_token }
            else if let shared = recovery.refresh {
                do { refresh = try await shared.value.refresh_token }
                catch {
                    guard let journal = saved?.pending else { throw error }
                    let recovered = try await transport.send(DesktopTokens.self, path: "/api/auth/desktop/refresh", body: [
                        "refresh_token": journal.refreshToken, "request_id": journal.requestID,
                    ])
                    refresh = recovered.refresh_token
                }
            }
            else if let journal = saved?.pending {
                let recovered = try await transport.send(DesktopTokens.self, path: "/api/auth/desktop/refresh", body: [
                    "refresh_token": journal.refreshToken, "request_id": journal.requestID,
                ])
                refresh = recovered.refresh_token
            }
            struct Result: Decodable, Sendable { let ok: Bool }
            let result = try await transport.send(Result.self, path: "/api/auth/desktop/logout", body: ["refresh_token": refresh])
            guard result.ok else { throw APIError.invalidResponse }
        } catch {
            throw APIError.server(status: 503, code: "REMOTE_LOGOUT_UNCONFIRMED")
        }
    }

    private func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
