import Foundation
import Testing
@testable import DrawOfferCore

@Test(.enabled(if: ProcessInfo.processInfo.environment["RUN_DESKTOP_KEYCHAIN_TESTS"] == "1"))
func desktopRealKeychainRoundTripRotationAndScopeIsolation() throws {
    let store = KeychainTokenStore(service: "com.linkresume.test.\(UUID())")
    let scope = "fixture-origin-a"
    defer { try? store.clear(scope: scope); try? store.clear(scope: "fixture-origin-b") }
    #expect(try store.load(scope: scope) == nil)
    let journal = RefreshJournal(requestID: UUID().uuidString, refreshToken: "fixture-refresh", startedAt: Date())
    let record = DesktopCredentialRecord(accountID: "1", refreshToken: "fixture-refresh", generation: UUID(), pending: journal)
    try store.save(record, scope: scope)
    let restored = try #require(try store.load(scope: scope))
    #expect(restored.pending?.requestID == journal.requestID)
    #expect(restored.generation == record.generation)
    #expect(try store.load(scope: "fixture-origin-b") == nil)
    try store.save(DesktopCredentialRecord(accountID: "1", refreshToken: "fixture-rotated", generation: record.generation), scope: scope)
    #expect(try store.load(scope: scope)?.refreshToken == "fixture-rotated")
    #expect(try store.load(scope: scope)?.pending == nil)
    try store.clear(scope: scope)
    try store.clear(scope: scope)
    #expect(try store.load(scope: scope) == nil)
}

@Test func desktopInstanceLeaseRejectsCompetingOwnersAndReleasesOnClose() throws {
    let file = FileManager.default.temporaryDirectory.appendingPathComponent("drawoffer-lease-\(UUID())")
    defer { try? FileManager.default.removeItem(at: file) }
    var first: DesktopInstanceLease? = try DesktopInstanceLease(fileURL: file)
    #expect(first != nil)
    #expect(throws: APIError.server(status: 409, code: "DESKTOP_ALREADY_RUNNING")) {
        try DesktopInstanceLease(fileURL: file)
    }
    first = nil
    let next = try DesktopInstanceLease(fileURL: file)
    withExtendedLifetime(next) {}
}
