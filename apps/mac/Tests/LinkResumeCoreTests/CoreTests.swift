import Foundation
import Testing
@testable import LinkResumeCore

@Test func mockTemplatesRequireSignIn() async throws {
    let api = MockAPIClient()
    await #expect(throws: APIError.unauthorized) { try await api.listResumeTemplates() }
}

@Test func mockTemplatesCarryLayoutPlans() async throws {
    let templates = try await MockAPIClient(signedIn: true).listResumeTemplates()
    #expect(templates.count == 3)
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

@Test func navigationMatchesWebOrder() {
    #expect(WorkspaceSection.allCases.map(\.title) == ["首页", "我的简历", "简历模板", "岗位看板", "面试日程", "模拟面试", "资料库"])
}
