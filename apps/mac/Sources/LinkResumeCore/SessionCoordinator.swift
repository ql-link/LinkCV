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
    private let transport: any DesktopRequesting
    private let tokens: any TokenStore
    private let scope: String
    private var generation = UUID()
    private var disabled = false
    private var access: String?
    private var accessDeadline = Date.distantPast
    private var flight: (id: UUID, task: Task<DesktopTokens, Error>)?
    private var exchange: (requestID: String, task: Task<DesktopTokens, Error>)?

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
        do { result = try await shared.task.value }
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
        guard !disabled else { throw APIError.unauthorized }
        let current = generation
        if access == nil || accessDeadline <= Date() { _ = try await refresh() }
        guard generation == current, !disabled else { throw APIError.unauthorized }
        let sentAccess = access
        do {
            let result = try await transport.send(type, path: path, body: nil, access: sentAccess)
            guard generation == current, !disabled else { throw APIError.unauthorized }
            return result
        } catch APIError.unauthorized {
            guard generation == current, !disabled else { throw APIError.unauthorized }
            if access == sentAccess { _ = try await refresh() }
            guard generation == current, !disabled else { throw APIError.unauthorized }
            do {
                let result = try await transport.send(type, path: path, body: nil, access: access)
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
        let result = try await shared.task.value
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
        let saved = try tokens.load(scope: scope)
        try tokens.clear(scope: scope)
        guard saved != nil || pendingExchange != nil else { return }
        var refresh = saved?.refreshToken ?? ""
        do {
            if let pendingExchange { refresh = try await pendingExchange.task.value.refresh_token }
            else if let shared {
                do { refresh = try await shared.task.value.refresh_token }
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
