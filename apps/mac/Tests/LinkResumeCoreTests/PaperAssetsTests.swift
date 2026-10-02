import Foundation
import Testing
@testable import LinkResumeCore

private let png = Data(base64Encoded: String(PaperAssets.placeholder.split(separator: ",")[1]))!
private func paper(_ sources: [String]) -> ResumeRenderRequest {
    ResumeRenderRequest(title: "虚构图片测试", data: .array(sources.map { .object(["media_kind": .string("resume_image"), "src": .string($0)]) }), style: .object([:]), layoutPlan: .null)
}
private actor ImageCalls {
    var paths: [String] = []
    func read(_ path: String, _ limit: Int) throws -> DesktopImage {
        paths.append(path)
        if path.contains("missing") { throw APIError.server(status: 404, code: "ASSET_NOT_FOUND") }
        return DesktopImage(data: png, contentType: "image/png")
    }
}

@Test func privateImagePathsRejectOtherOriginsTraversalAndForeignLegacyAccounts() throws {
    #expect(try PaperAssets.path("/api/resumes/42/assets/照片.png", account: "1") == "/api/resumes/42/assets/照片.png")
    #expect(try PaperAssets.path("/api/assets/users%2F1%2Fassets%2Ffixture.png", account: "1") == "/api/assets/users/1/assets/fixture.png")
    #expect(try PaperAssets.path("/api/assets/users%2F1%2Fassets%2Favatar%2Fa.png", account: "1") == "/api/assets/users/1/assets/avatar/a.png")
    for source in ["https://api.example.test/api/resumes/42/assets/a.png", "//evil.example/a.png", "/api/resumes/42/assets/%2e%2e.png", "/api/resumes/42/assets/a%252F.png", "/api/resumes/42/assets/a.png?download=1", "/api/assets/users%2F2%2Fassets%2Fa.png", "/api/resumes/42/assets/a.svg", "/api/resumes/42/assets/a%2F.png"] {
        #expect(throws: APIError.invalidResponse) { try PaperAssets.path(source, account: "1") }
    }
}

@Test func privateImageBytesValidateMimeDimensionsAndSize() throws {
    #expect(try PaperAssets.dataURL(DesktopImage(data: png, contentType: "image/png"), limit: png.count) == PaperAssets.placeholder)
    #expect(throws: APIError.invalidResponse) { try PaperAssets.dataURL(DesktopImage(data: png, contentType: "image/jpeg"), limit: 1000) }
    #expect(throws: APIError.invalidResponse) { try PaperAssets.dataURL(DesktopImage(data: Data("not an image".utf8), contentType: "image/png"), limit: 1000) }
    #expect(throws: APIError.invalidResponse) { try PaperAssets.dataURL(DesktopImage(data: png, contentType: "image/png"), limit: png.count - 1) }
}

@Test func privateImagesDeduplicateDegradeAndSerializeWithoutCredentials() async throws {
    let calls = ImageCalls()
    let source = "/api/resumes/42/assets/avatar.png"
    let missing = "/api/resumes/42/assets/missing.png"
    let original = paper([source, source, missing, "/templates/avatar-cat.jpg", "https://evil.example/image.png"])
    let prepared = try await PaperAssets.prepare(original, account: "1") { path, limit in try await calls.read(path, limit) }
    #expect(await calls.paths.count == 2)
    #expect(prepared.missingImageCount == 2)
    #expect(prepared.request.assets[source] == PaperAssets.placeholder)
    #expect(prepared.request.assets[missing] == PaperAssets.placeholder)
    #expect(prepared.request.data == original.data)
    let json = String(decoding: try JSONEncoder().encode(prepared.request), as: UTF8.self)
    #expect(json.contains("assets"))
    #expect(!json.contains("Authorization") && !json.contains("refresh_token"))
}

@Test func privateImageBudgetLimitsDownloadsAndCancellationDoesNotDegrade() async throws {
    let calls = ImageCalls()
    let prepared = try await PaperAssets.prepare(paper((1...40).map { "/api/resumes/42/assets/\($0).png" }), account: "1") { path, limit in try await calls.read(path, limit) }
    #expect(await calls.paths.count == 32)
    #expect(prepared.missingImageCount == 8)
    await #expect(throws: CancellationError.self) {
        try await PaperAssets.prepare(paper(["/api/resumes/42/assets/a.png"]), account: "1") { _, _ in throw CancellationError() }
    }
    await #expect(throws: APIError.unauthorized) {
        try await PaperAssets.prepare(paper(["/api/resumes/42/assets/a.png"]), account: "1") { _, _ in throw APIError.unauthorized }
    }
}


@Test func privateImageBudgetIsSharedAcrossAssetsAndJPEGIsAccepted() async throws {
    let jpegURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("web/public/templates/avatar-cat.jpg")
    let jpeg = try Data(contentsOf: jpegURL)
    #expect(try PaperAssets.dataURL(DesktopImage(data: jpeg, contentType: "image/jpeg"), limit: PaperAssets.maximumBytes).hasPrefix("data:image/jpeg;base64,"))
    var large = png
    large.append(Data(repeating: 0, count: PaperAssets.maximumBytes - large.count))
    let image = DesktopImage(data: large, contentType: "image/png")
    let prepared = try await PaperAssets.prepare(paper(["/api/resumes/42/assets/a.png", "/api/resumes/42/assets/b.png"]), account: "1") { _, _ in image }
    #expect(prepared.missingImageCount == 1)
    #expect(prepared.request.assets["/api/resumes/42/assets/b.png"] == PaperAssets.placeholder)
}
