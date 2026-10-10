import Foundation
import Testing
@testable import DrawOfferCore

@Test func librarySurfaceKeepsOwnershipRoutesAndRejectsArbitraryPaths() {
    for (path,method) in [("/api/datasets","POST"),("/api/datasets/folders","GET"),("/api/datasets/folders/1","DELETE"),("/api/datasets/1/source","GET"),("/api/datasets/1/content","GET"),("/api/datasets/1/file","PUT"),("/api/datasets/move-batch","POST"),("/api/interview-sessions/2/assets/attach","POST"),("/api/interview-sessions/2/assets/1","DELETE")] { #expect(CareerRequest.allowed(path:path,method:method)) }
    for path in ["/api/datasets/01/source","/api/datasets/1/../source","/api/datasets/1/source?token=x","/api/datasets/1/source/","/api/datasets/1/signed-url","/api/interview-sessions/2/assets/upload","/api/datasets/١/content","https://evil.invalid/api/datasets","/api/datasets/1/source"] { #expect(!DatasetRequest.allowed(path:path,method:"POST")) }
    #expect(!DatasetRequest.allowed(path:"/api/datasets/01/source",method:"GET"))
}
@Test func libraryRetrySnapshotPreservesContentAndIsPrivate() throws {
    let directory = try DatasetUpload.privateDirectory(); defer { try? FileManager.default.removeItem(at:directory) }
    let original = directory.appendingPathComponent("fictional.md"); try Data("# fictional original".utf8).write(to:original)
    let upload = try DatasetUpload.snapshot(original,folder:"1",limit:1024); defer { upload.discard() }
    try Data("changed externally".utf8).write(to:original)
    #expect(try String(contentsOf:upload.file,encoding:.utf8) == "# fictional original")
    let retry = upload; #expect(retry.id == upload.id && retry.folder == "1")
    #expect(upload.rekey().id != upload.id)
    #expect((try FileManager.default.attributesOfItem(atPath:upload.directory.path)[.posixPermissions] as? NSNumber)?.intValue == 0o700)
    #expect((try FileManager.default.attributesOfItem(atPath:upload.file.path)[.posixPermissions] as? NSNumber)?.intValue == 0o600)
    #expect(throws:(any Error).self) { try DatasetUpload.snapshot(original,folder:"../1",limit:1024) }
    #expect(throws:(any Error).self) { try DatasetUpload.snapshot(original,folder:"1",limit:1) }
    upload.discard(); #expect(!FileManager.default.fileExists(atPath:upload.directory.path))
}
@Test func libraryMediaDoesNotNeedDocumentParsingAndFailuresCanRetry() {
    let audio = DatasetRecord(.object(["asset_kind":.string("audio"),"upload_status":.string("succeeded"),"parse_status":.null]))
    #expect(audio.ready && !audio.retryable)
    let doc = DatasetRecord(.object(["asset_kind":.string("document"),"upload_status":.string("succeeded"),"parse_status":.string("failed")]))
    #expect(!doc.ready && doc.retryable && doc.status == "解析失败")
}
