import Foundation
import Testing
@testable import DrawOfferCore

private final class CredentialStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var saved: DesktopCredentialRecord? = DesktopCredentialRecord(accountID: "1", refreshToken: "fixture-session.old-secret", generation: UUID())
    private var failCommit = false
    private var failClear = false
    private var cleared = false

    func load(scope: String) throws -> DesktopCredentialRecord? { lock.withLock { saved } }
    func save(_ record: DesktopCredentialRecord, scope: String) throws {
        try lock.withLock {
            if failCommit && record.pending == nil { throw APIError.invalidResponse }
            saved = record
        }
    }
    private var clearWaiters: [CheckedContinuation<Void, Never>] = []
    func clear(scope: String) throws {
        let waiters = try lock.withLock {
            if failClear { throw APIError.invalidResponse }
            saved = nil
            cleared = true
            let waiters = clearWaiters
            clearWaiters = []
            return waiters
        }
        for waiter in waiters { waiter.resume() }
    }
    func waitForClear() async {
        await withCheckedContinuation { continuation in
            lock.withLock {
                if cleared { continuation.resume() }
                else { clearWaiters.append(continuation) }
            }
        }
    }
    func setFailCommit(_ value: Bool) { lock.withLock { failCommit = value } }
    func setFailClear(_ value: Bool) { lock.withLock { failClear = value } }
    func seed(_ record: DesktopCredentialRecord) { lock.withLock { saved = record } }
    func prepareForClear() { lock.withLock { cleared = false } }
}

private actor SessionTransport: DesktopRequesting {
    nonisolated let origin = URL(string: "https://api.example.test/")!
    struct Call: Sendable {
        let path: String
        let body: [String: String]?
        let access: String?
    }
    private(set) var calls: [Call] = []
    private var failure: APIError?
    private var hold = false
    private var heldPath = "/api/auth/desktop/refresh"
    private var failNextRefresh = false
    private var rejectBusiness = false
    private var imageFailures = 0
    private var release: CheckedContinuation<Void, Never>?
    private var entered: CheckedContinuation<Void, Never>?

    func setImageFailures(_ count: Int) { imageFailures = count }
    func setFailure(_ error: APIError?) { failure = error }
    func holdRefresh() { holdRequest(path: "/api/auth/desktop/refresh") }
    func holdRequest(path: String) { hold = true; heldPath = path }
    func failOneRefresh() { failNextRefresh = true }
    func setRejectBusiness() { rejectBusiness = true }
    func waitForRequest() async {
        if release != nil { return }
        await withCheckedContinuation { entered = $0 }
    }
    func releaseRequest() { hold = false; release?.resume(); release = nil }

    private(set) var datasetTarget: URL?
    func downloadDataset(id: String, to target: URL, limit: Int64, access: String?) async throws {
        datasetTarget = target; calls.append(Call(path:"/api/datasets/" + id + "/source",body:nil,access:access))
        if hold { await withCheckedContinuation { release = $0; entered?.resume(); entered = nil } }
        try Data("fictional private file".utf8).write(to:target)
    }
    func downloadImage(path: String, limit: Int, access: String?) async throws -> DesktopImage {
        calls.append(Call(path: path, body: nil, access: access))
        if path == heldPath, hold {
            await withCheckedContinuation { release = $0; entered?.resume(); entered = nil }
        }
        if imageFailures > 0 { imageFailures -= 1; throw APIError.unauthorized }
        return DesktopImage(data: Data(base64Encoded: String(PaperAssets.placeholder.split(separator: ",")[1]))!, contentType: "image/png")
    }

    func send<T: Decodable & Sendable>(_ type: T.Type, path: String, body: [String: String]?, access: String?) async throws -> T {
        calls.append(Call(path: path, body: body, access: access))
        if path == heldPath, hold {
            await withCheckedContinuation {
                release = $0
                entered?.resume()
                entered = nil
            }
        }
        if path == "/api/auth/desktop/refresh", failNextRefresh {
            failNextRefresh = false
            throw APIError.server(status: 503, code: "FIXTURE_LOST_RESPONSE")
        }
        if let failure { throw failure }
        if rejectBusiness && path == "/api/resume-templates" { throw APIError.unauthorized }
        let json: String
        if path == "/api/auth/desktop/refresh" || path == "/api/auth/desktop/wechat/exchange" {
            json = """
            {"user":{"id":"1","email":null,"nickname":"张三","is_admin":false},
             "access_token":"fixture-access","refresh_token":"fixture-session.new-secret","expires_in":600,"session_protocol":1}
            """
        } else if path == "/api/auth/desktop/wechat/qrcode" {
            json = "{\"scene\":\"desktop:0123456789abcdef\",\"poll_token\":\"fixture-poll\",\"qr_base64\":\"Zml4dHVyZQ==\",\"expires_in\":300,\"poll_interval_seconds\":2}"
        } else if path == "/api/auth/desktop/wechat/status" {
            json = "{\"status\":\"confirmed\"}"
        } else if path == "/api/auth/desktop/logout" {
            json = "{\"ok\":true}"
        } else {
            json = "{\"templates\":[]}"
        }
        return try JSONDecoder().decode(type, from: Data(json.utf8))
    }
}

@Test func desktopConcurrentRequestsShareRefresh() async throws {
    let store = CredentialStore()
    let transport = SessionTransport()
    await transport.holdRefresh()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    let api = HTTPAPIClient(coordinator: coordinator)
    let requests = (0..<10).map { _ in Task { try await api.listResumeTemplates() } }
    await transport.waitForRequest()
    await transport.releaseRequest()
    for request in requests { _ = try await request.value }
    let calls = await transport.calls
    #expect(calls.filter { $0.path == "/api/auth/desktop/refresh" }.count == 1)
    #expect(calls.filter { $0.path == "/api/resume-templates" }.allSatisfy { $0.access == "fixture-access" })
    let saved = try #require(try store.load(scope: "fixture"))
    #expect(saved.refreshToken == "fixture-session.new-secret")
    #expect(saved.pending == nil)
}

@Test func desktopNetworkFailurePreservesFixedJournal() async throws {
    let store = CredentialStore()
    let transport = SessionTransport()
    await transport.setFailure(.server(status: 503, code: "FIXTURE_OFFLINE"))
    let api = HTTPAPIClient(coordinator: SessionCoordinator(transport: transport, tokens: store))
    await #expect(throws: APIError.server(status: 503, code: "FIXTURE_OFFLINE")) { try await api.listResumeTemplates() }
    let journal = try #require(try store.load(scope: "fixture")?.pending)
    await transport.setFailure(nil)
    _ = try await api.listResumeTemplates()
    let calls = await transport.calls
    #expect(calls.filter { $0.path == "/api/auth/desktop/refresh" }.allSatisfy { $0.body?["request_id"] == journal.requestID })
}

@Test func desktopSaveFailureCannotExposeAccess() async throws {
    let store = CredentialStore()
    store.setFailCommit(true)
    let transport = SessionTransport()
    let api = HTTPAPIClient(coordinator: SessionCoordinator(transport: transport, tokens: store))
    await #expect(throws: APIError.invalidResponse) { try await api.listResumeTemplates() }
    let journal = try #require(try store.load(scope: "fixture")?.pending)
    #expect(await transport.calls.allSatisfy { $0.path != "/api/resume-templates" })
    store.setFailCommit(false)
    _ = try await api.listResumeTemplates()
    #expect(await transport.calls.filter { $0.path == "/api/auth/desktop/refresh" }.allSatisfy { $0.body?["request_id"] == journal.requestID })
}

@Test func desktopUnauthorizedClearsCredentials() async throws {
    let store = CredentialStore()
    let transport = SessionTransport()
    await transport.setFailure(.unauthorized)
    let api = HTTPAPIClient(coordinator: SessionCoordinator(transport: transport, tokens: store))
    await #expect(throws: APIError.unauthorized) { try await api.listResumeTemplates() }
    #expect(try store.load(scope: "fixture") == nil)
    #expect(try await api.currentUser() == nil)
}

@Test func desktopSignOutRejectsLateRefresh() async throws {
    let store = CredentialStore()
    let transport = SessionTransport()
    await transport.holdRefresh()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    let api = HTTPAPIClient(coordinator: coordinator)
    let request = Task { try await api.listResumeTemplates() }
    await transport.waitForRequest()
    let logout = Task { try await api.signOut() }
    await store.waitForClear()
    await transport.releaseRequest()
    try await logout.value
    await #expect(throws: APIError.unauthorized) { try await request.value }
    #expect(try store.load(scope: "fixture") == nil)
    let calls = await transport.calls
    #expect(calls.first { $0.path == "/api/auth/desktop/logout" }?.body?["refresh_token"] == "fixture-session.new-secret")
}

@Test func desktopSignOutRecoversFailedRefreshWithFixedJournal() async throws {
    let store = CredentialStore()
    let transport = SessionTransport()
    await transport.holdRefresh()
    await transport.failOneRefresh()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    let api = HTTPAPIClient(coordinator: coordinator)
    let request = Task { try await api.listResumeTemplates() }
    await transport.waitForRequest()
    let journal = try #require(try store.load(scope: "fixture")?.pending)
    let logout = Task { try await api.signOut() }
    await store.waitForClear()
    await transport.releaseRequest()
    try await logout.value
    await #expect(throws: APIError.server(status: 503, code: "FIXTURE_LOST_RESPONSE")) { try await request.value }
    let calls = await transport.calls
    let refreshes = calls.filter { $0.path == "/api/auth/desktop/refresh" }
    #expect(refreshes.count == 2)
    #expect(refreshes.allSatisfy { $0.body?["request_id"] == journal.requestID && $0.body?["refresh_token"] == journal.refreshToken })
    #expect(calls.first { $0.path == "/api/auth/desktop/logout" }?.body?["refresh_token"] == "fixture-session.new-secret")
    #expect(try store.load(scope: "fixture") == nil)
    #expect(try await api.currentUser() == nil)
}

@Test func desktopBeginLoginCannotUndoNewerSignOut() async throws {
    let store = CredentialStore()
    let transport = SessionTransport()
    await transport.holdRequest(path: "/api/auth/desktop/logout")
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    let login = Task { try await coordinator.beginLogin(clientVersion: "1.0.0") }
    await transport.waitForRequest()
    store.prepareForClear()
    let logout = Task { try await coordinator.signOut() }
    await store.waitForClear()
    await transport.releaseRequest()
    try await logout.value
    await #expect(throws: APIError.unauthorized) { try await login.value }
    #expect(await transport.calls.allSatisfy { $0.path != "/api/auth/desktop/wechat/qrcode" })
    #expect(try await coordinator.restore() == nil)
    #expect(await transport.calls.filter { $0.path == "/api/auth/desktop/logout" }.count == 1)
}

@Test func desktopSignOutRejectsLateLoginStatus() async throws {
    let store = CredentialStore()
    try store.clear(scope: "fixture")
    let transport = SessionTransport()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    let challenge = try await coordinator.beginLogin(clientVersion: "1.0.0")
    await transport.holdRequest(path: "/api/auth/desktop/wechat/status")
    let status = Task { try await coordinator.loginStatus(challenge) }
    await transport.waitForRequest()
    try await coordinator.signOut()
    await transport.releaseRequest()
    await #expect(throws: APIError.unauthorized) { try await status.value }
    #expect(try store.load(scope: "fixture") == nil)
    #expect(try await coordinator.restore() == nil)
}

@Test func desktopRejectsUntrustedOrigins() {
    for value in ["http://api.example.test", "http://localhost:8000", "https://user:secret@api.example.test", "https://api.example.test/untrusted"] {
        #expect(throws: APIError.invalidResponse) { try DesktopTransport(origin: URL(string: value)!) }
    }
}

@Test func desktopLoginSaveFailureRetriesSameExchangeWithoutExposingAccess() async throws {
    let store = CredentialStore()
    try store.clear(scope: "fixture")
    let transport = SessionTransport()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    let challenge = try await coordinator.beginLogin(clientVersion: "1.0.0")
    store.setFailCommit(true)
    await #expect(throws: APIError.invalidResponse) { try await coordinator.completeLogin(challenge) }
    #expect(try store.load(scope: "fixture") == nil)
    await #expect(throws: APIError.unauthorized) { try await coordinator.request([String: JSONValue].self, path: "/api/resume-templates") }
    store.setFailCommit(false)
    let user = try await coordinator.completeLogin(challenge)
    #expect(user.id == "1")
    #expect(await transport.calls.filter { $0.path == "/api/auth/desktop/wechat/exchange" }.count == 1)
    #expect(try store.load(scope: "fixture")?.refreshToken == "fixture-session.new-secret")
}

@Test func desktopCancelledLoginWaiterCanRetrySharedExchange() async throws {
    let store = CredentialStore()
    try store.clear(scope: "fixture")
    let transport = SessionTransport()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    let challenge = try await coordinator.beginLogin(clientVersion: "1.0.0")
    await transport.holdRequest(path: "/api/auth/desktop/wechat/exchange")
    let waiter = Task { try await coordinator.completeLogin(challenge) }
    await transport.waitForRequest()
    waiter.cancel()
    await #expect(throws: CancellationError.self) { try await waiter.value }
    #expect(try store.load(scope: "fixture") == nil)
    await transport.releaseRequest()
    #expect(try await coordinator.completeLogin(challenge).id == "1")
    #expect(await transport.calls.filter { $0.path == "/api/auth/desktop/wechat/exchange" }.count == 1)
}

@Test func desktopSignOutRejectsLateExchangeAndRevokesIssuedToken() async throws {
    let store = CredentialStore()
    try store.clear(scope: "fixture")
    let transport = SessionTransport()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    let challenge = try await coordinator.beginLogin(clientVersion: "1.0.0")
    await transport.holdRequest(path: "/api/auth/desktop/wechat/exchange")
    let waiter = Task { try await coordinator.completeLogin(challenge) }
    await transport.waitForRequest()
    store.prepareForClear()
    let logout = Task { try await coordinator.signOut() }
    await store.waitForClear()
    await transport.releaseRequest()
    try await logout.value
    await #expect(throws: APIError.unauthorized) { try await waiter.value }
    #expect(try store.load(scope: "fixture") == nil)
    #expect(await transport.calls.first { $0.path == "/api/auth/desktop/logout" }?.body?["refresh_token"] == "fixture-session.new-secret")
}

@Test func desktopSecondBusinessUnauthorizedInvalidatesWithoutInfiniteRetry() async throws {
    let store = CredentialStore()
    let transport = SessionTransport()
    await transport.setRejectBusiness()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    await #expect(throws: APIError.unauthorized) { try await coordinator.request([String: JSONValue].self, path: "/api/resume-templates") }
    let calls = await transport.calls
    #expect(calls.filter { $0.path == "/api/resume-templates" }.count == 2)
    #expect(calls.filter { $0.path == "/api/auth/desktop/refresh" }.count == 2)
    #expect(try store.load(scope: "fixture") == nil)
    #expect(try await coordinator.restore() == nil)
}

@Test func desktopExpiredJournalNeverReplaysAndClearsCredentials() async throws {
    let store = CredentialStore()
    store.seed(DesktopCredentialRecord(accountID: "1", refreshToken: "fixture-token", generation: UUID(),
        pending: RefreshJournal(requestID: UUID().uuidString, refreshToken: "fixture-token", startedAt: Date().addingTimeInterval(-121))))
    let transport = SessionTransport()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    await #expect(throws: APIError.unauthorized) { try await coordinator.restore() }
    #expect(await transport.calls.isEmpty)
    #expect(try store.load(scope: "fixture") == nil)
}

@Test func desktopStorageClearFailureRemainsDisabledAndCanRetryCleanup() async throws {
    let store = CredentialStore()
    store.setFailClear(true)
    let transport = SessionTransport()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    await #expect(throws: APIError.invalidResponse) { try await coordinator.signOut() }
    #expect(await transport.calls.filter { $0.path == "/api/auth/desktop/logout" }.count == 1)
    #expect(try store.load(scope: "fixture") != nil)
    #expect(try await coordinator.restore() == nil)
    await #expect(throws: APIError.unauthorized) { try await coordinator.request([String: JSONValue].self, path: "/api/resume-templates") }
    store.setFailClear(false)
    try await coordinator.signOut()
    #expect(try store.load(scope: "fixture") == nil)
}

@Test func desktopRemoteLogoutFailureCanRetryAfterLocalCredentialsWereCleared() async throws {
    let store = CredentialStore()
    let transport = SessionTransport()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    await transport.setFailure(.server(status: 503, code: "FIXTURE_OFFLINE"))
    await #expect(throws: APIError.server(status: 503, code: "REMOTE_LOGOUT_UNCONFIRMED")) { try await coordinator.signOut() }
    #expect(try store.load(scope: "fixture") == nil)
    await transport.setFailure(nil)
    try await coordinator.signOut()
    let logouts = await transport.calls.filter { $0.path == "/api/auth/desktop/logout" }
    #expect(logouts.count == 2)
    #expect(logouts.allSatisfy { $0.body?["refresh_token"] == "fixture-session.old-secret" })
    #expect(try await coordinator.restore() == nil)
}

@Test func desktopCancelledRefreshWaiterReturnsBeforeNetworkAndRetrySharesFlight() async throws {
    let store = CredentialStore()
    let transport = SessionTransport()
    await transport.holdRefresh()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    let waiter = Task { try await coordinator.request([String: JSONValue].self, path: "/api/resume-templates") }
    await transport.waitForRequest()
    waiter.cancel()
    await #expect(throws: CancellationError.self) { try await waiter.value }
    #expect(try store.load(scope: "fixture")?.pending != nil)
    let retry = Task { try await coordinator.request([String: JSONValue].self, path: "/api/resume-templates") }
    await transport.releaseRequest()
    _ = try await retry.value
    #expect(await transport.calls.filter { $0.path == "/api/auth/desktop/refresh" }.count == 1)
    #expect(await transport.calls.filter { $0.path == "/api/resume-templates" }.count == 1)
    #expect(try store.load(scope: "fixture")?.pending == nil)
}


private func imagePaper() -> ResumeRenderRequest {
    ResumeRenderRequest(title: "虚构头像", data: .object(["media_kind": .string("avatar"), "src": .string("/api/resumes/42/assets/a.png")]), style: .null, layoutPlan: .null)
}

@Test func desktopPrivateImageUsesAccessAndRejectsLateResultAfterLogout() async throws {
    let store = CredentialStore(), transport = SessionTransport()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    await transport.holdRequest(path: "/api/resumes/42/assets/a.png")
    let task = Task { try await coordinator.preparePaper(imagePaper()) }
    await transport.waitForRequest()
    try await coordinator.signOut()
    await transport.releaseRequest()
    await #expect(throws: APIError.unauthorized) { try await task.value }
    #expect(await transport.calls.first { $0.path.hasSuffix("a.png") }?.access == "fixture-access")
    #expect(try store.load(scope: "fixture") == nil)
}

@Test func desktopPrivateImageUnauthorizedRefreshesOnceThenInvalidates() async throws {
    let store = CredentialStore(), transport = SessionTransport()
    let coordinator = SessionCoordinator(transport: transport, tokens: store)
    await transport.setImageFailures(1)
    let prepared = try await coordinator.preparePaper(imagePaper())
    #expect(prepared.missingImageCount == 0)
    #expect(await transport.calls.filter { $0.path.hasSuffix("a.png") }.count == 2)
    await transport.setImageFailures(2)
    await #expect(throws: APIError.unauthorized) { try await coordinator.preparePaper(imagePaper()) }
    #expect(try store.load(scope: "fixture") == nil)
}

@Test func libraryDownloadAfterLogoutRejectsAndCleansPrivateTemporaryFile() async throws {
    let store = CredentialStore(), transport = SessionTransport()
    let coordinator = SessionCoordinator(transport:transport,tokens:store)
    _ = try await coordinator.request([String:JSONValue].self,path:"/api/resume-templates")
    await transport.holdRequest(path:"/api/datasets/1/source")
    let pending = Task { try await coordinator.downloadDataset(id:"1",limit:1024) }
    await transport.waitForRequest(); let target = try #require(await transport.datasetTarget)
    try await coordinator.signOut(); await transport.releaseRequest()
    await #expect(throws: APIError.unauthorized) { try await pending.value }
    #expect(!FileManager.default.fileExists(atPath:target.deletingLastPathComponent().path))
}
