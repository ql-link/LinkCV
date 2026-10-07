import Foundation
import Testing
@testable import LinkResumeCore

@Test func mockTemplatesRequireSignIn() async throws {
    let api = MockAPIClient()
    await #expect(throws: APIError.unauthorized) { try await api.listResumeTemplates() }
}

@Test func mockTemplatesCarryLayoutPlans() async throws {
    let templates = try await MockAPIClient(signedIn: true).listResumeTemplates()
    #expect(templates.count == 9)
    #expect(templates.allSatisfy { $0.layoutPlan != nil })
}

@Test func renderRequestMatchesWebPresentationRule() async throws {
    let template = try #require(try await MockAPIClient(signedIn: true).listResumeTemplates().first)
    let encoded = try JSONEncoder().encode(template.renderRequest())
    let request = try JSONDecoder().decode(JSONValue.self, from: encoded)
    #expect(request["protocol_version"] == .number(1))
    #expect(request["style"]?["schema_version"]?.stringValue == "resume-presentation.v1")
    #expect(request["style"]?["template_scoped"]?[template.key] == .object([:]))
    #expect(request["style"]?["template_snapshot"] == template.style)
}

@MainActor
@Test func sessionRestoreAndSignOut() async {
    let session = SessionStore(api: MockAPIClient(signedIn: true))
    await session.restore()
    #expect(session.phase == .signedIn(MockAPIClient.previewUser))
    await session.signOut()
    #expect(session.phase == .signedOut)
}

private actor DelayedIdentityAPI: APIClient {
    private var result: CheckedContinuation<User?, any Error>?
    private var entered: CheckedContinuation<Void, Never>?

    func currentUser() async throws -> User? {
        try await withCheckedThrowingContinuation {
            result = $0
            entered?.resume()
            entered = nil
        }
    }
    func waitForRestore() async {
        if result != nil { return }
        await withCheckedContinuation { entered = $0 }
    }
    func finishRestore(failure: Bool) {
        if failure { result?.resume(throwing: APIError.unauthorized) }
        else { result?.resume(returning: MockAPIClient.previewUser) }
        result = nil
    }
    func signIn(email: String, password: String) async throws -> User { MockAPIClient.previewUser }
    func signOut() async throws {}
    func listResumeTemplates() async throws -> [ResumeTemplate] { [] }
}

@MainActor
@Test(arguments: [false, true]) func sessionIgnoresRestoreAfterSignOut(failure: Bool) async {
    let api = DelayedIdentityAPI()
    let session = SessionStore(api: api)
    let restore = Task { await session.restore() }
    await api.waitForRestore()
    await session.signOut()
    await api.finishRestore(failure: failure)
    await restore.value
    #expect(session.phase == .signedOut)
    #expect(session.errorMessage == nil)
}

@Test func navigationMatchesWebOrder() {
    #expect(WorkspaceSection.sidebar.map(\.title) == ["首页", "我的简历", "简历模板", "岗位看板", "面试日程", "模拟面试", "资料库"])
}

@Test func guestExamplesWorkWithoutGrantingAccountAccess() async throws {
    let api = MockAPIClient()
    let templates = try GuestTemplates.load()
    #expect(templates.count == 9)
    for template in templates {
        let paper = try await GuestTemplates.prepare(template)
        #expect(paper.missingImageCount == 0)
        #expect(paper.request.layoutPlan != nil)
    }
    await #expect(throws: APIError.unauthorized) { try await api.listResumeTemplates() }
    #expect(try await api.currentUser() == nil)
}
