import Darwin
import Foundation
import Testing
@testable import LinkResumeCore

/// Real TCP fixture: redirects target an additional request that must never be sent.
private final class HTTPFixture: @unchecked Sendable {
    let origin: URL
    private let descriptor: Int32
    private let images: Bool
    private let interview: Bool
    private let library: Bool
    private let lock = NSLock()
    private var received: [String] = []
    var requests: [String] { lock.withLock { received } }

    init(images: Bool = false, interview: Bool = false, library: Bool = false) throws {
        self.library = library
        self.interview = interview
        self.images = images
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        self.descriptor = descriptor
        guard descriptor >= 0 else { throw APIError.invalidResponse }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let bound = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bound == 0, listen(descriptor, 5) == 0 else {
            close(descriptor)
            throw APIError.invalidResponse
        }
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        _ = withUnsafeMutablePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(descriptor, $0, &length) }
        }
        origin = URL(string: "http://127.0.0.1:\(UInt16(bigEndian: address.sin_port))/")!
        DispatchQueue.global().async { [self] in serve() }
    }

    private func serve() {
        defer { close(descriptor) }
        for index in 0..<(images ? 5 : library ? 4 : 3) {
            var polling = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
            guard poll(&polling, 1, 10_000) > 0 else { return }
            let client = accept(descriptor, nil, nil)
            guard client >= 0 else { return }
            var timeout = timeval(tv_sec: 5, tv_usec: 0)
            _ = setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
            var bytes = [UInt8](repeating: 0, count: 8192)
            var request = ""
            while !request.contains("\r\n\r\n") {
                let count = read(client, &bytes, bytes.count)
                if count <= 0 { break }
                request += String(decoding: bytes.prefix(count), as: UTF8.self)
            }
            if let head = request.range(of: "\r\n\r\n") {
                let count = request[..<head.lowerBound].components(separatedBy: "\r\n").first { $0.lowercased().hasPrefix("content-length:") }.flatMap { Int($0.split(separator: ":").last!.trimmingCharacters(in: .whitespaces)) } ?? 0
                while request[head.upperBound...].utf8.count < count { let size = read(client, &bytes, bytes.count); if size <= 0 { break }; request += String(decoding: bytes.prefix(size), as: UTF8.self) }
            }
            lock.withLock { received.append(request) }
            if library {
                let body = index < 2 ? Data("{\"id\":\"1\"}".utf8) : Data("fictional-source".utf8)
                let status = index == 1 ? "302 Found\r\nLocation: \(origin.absoluteString)api/redirect-target" : "200 OK"
                var response = Data("HTTP/1.1 \(status)\r\nSet-Cookie: library-fixture=secret; Path=/\r\nContent-Type: \(index < 2 ? "application/json" : "text/plain")\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n".utf8)
                response.append(body); response.withUnsafeBytes { _ = write(client, $0.baseAddress!, $0.count) }
            } else if interview {
                let body = index == 0 ? "event: answer.accepted\ndata: {\"question_id\":\"1\"}\n\nevent: interviewer.turn\ndata: {\"status\":\"in_progress\"}\n\n" : "event: answer.accepted\ndata: {\"question_id\":\"1\"}\n\n"
                let status = index == 2 ? "302 Found\r\nLocation: \(origin.absoluteString)api/redirect-target" : "200 OK"
                let response = "HTTP/1.1 \(status)\r\nSet-Cookie: transport-fixture=secret; Path=/\r\nContent-Type: text/event-stream\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n" + body
                response.withCString { _ = write(client, $0, response.utf8.count) }
            } else if images {
                let png = Data(base64Encoded: String(PaperAssets.placeholder.split(separator: ",")[1]))!
                let body = index == 1 ? Data(repeating: 65, count: 1000) : (index == 2 ? Data(repeating: 65, count: 100) : png)
                let status = index == 3 ? "302 Found\r\nLocation: \(origin.absoluteString)api/redirect-target" : "200 OK"
                let length = index == 2 ? "" : "Content-Length: \(index == 1 ? 1000 : body.count)\r\n"
                let type = index == 4 ? "text/html" : "image/png"
                var response = Data("HTTP/1.1 \(status)\r\nSet-Cookie: image-fixture=secret; Path=/\r\nContent-Type: \(type)\r\n\(length)Connection: close\r\n\r\n".utf8)
                response.append(body)
                response.withUnsafeBytes { bytes in _ = write(client, bytes.baseAddress!, bytes.count) }
            } else {
                let headers = index == 2 ? "302 Found\r\nLocation: \(origin.absoluteString)api/redirect-target" : "200 OK\r\nSet-Cookie: transport-fixture=secret; Path=/"
                let response = "HTTP/1.1 \(headers)\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}"
                response.withCString { pointer in _ = write(client, pointer, strlen(pointer)) }
            }
            close(client)
        }
    }
}

@Test func desktopRealHTTPDoesNotSendOrAcceptCookiesAndRejectsRedirects() async throws {
    let fixture = try HTTPFixture()
    let cookie = try #require(HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "linkresume-test-\(UUID())", .value: "fixture-cookie"]))
    HTTPCookieStorage.shared.setCookie(cookie)
    defer { HTTPCookieStorage.shared.deleteCookie(cookie) }
    let transport = try DesktopTransport(origin: fixture.origin, allowLocalHTTP: true)
    struct Result: Decodable, Sendable { let ok: Bool }
    #expect(try await transport.send(Result.self, path: "/api/first", access: "fixture-access").ok)
    #expect(try await transport.send(Result.self, path: "/api/second").ok)
    await #expect(throws: APIError.server(status: 302, code: "HTTP_302")) {
        try await transport.send(Result.self, path: "/api/redirect", access: "fixture-access")
    }
    #expect(fixture.requests.count == 3)
    #expect(fixture.requests.allSatisfy { !$0.lowercased().contains("\r\ncookie:") })
    #expect(fixture.requests[0].contains("Bearer fixture-access"))
    #expect(!fixture.requests[1].lowercased().contains("authorization:"))
    #expect(HTTPCookieStorage.shared.cookies?.contains { $0.name == "transport-fixture" } != true)
}


@Test func privateImageRealHTTPStreamsBoundedBytesRejectsMimeAndRedirectsWithoutCookies() async throws {
    let fixture = try HTTPFixture(images: true)
    let transport = try DesktopTransport(origin: fixture.origin, allowLocalHTTP: true)
    let image = try await transport.downloadImage(path: "/api/resumes/42/assets/a.png", limit: 100, access: "fixture-access")
    #expect(try PaperAssets.dataURL(image, limit: 100) == PaperAssets.placeholder)
    await #expect(throws: APIError.invalidResponse) { try await transport.downloadImage(path: "/api/resumes/42/assets/large.png", limit: 100, access: "fixture-access") }
    await #expect(throws: APIError.invalidResponse) { try await transport.downloadImage(path: "/api/resumes/42/assets/stream.png", limit: 16, access: "fixture-access") }
    await #expect(throws: APIError.server(status: 302, code: "IMAGE_READ_FAILED")) { try await transport.downloadImage(path: "/api/resumes/42/assets/redirect.png", limit: 100, access: "fixture-access") }
    await #expect(throws: APIError.invalidResponse) { try await transport.downloadImage(path: "/api/resumes/42/assets/html.png", limit: 100, access: "fixture-access") }
    #expect(fixture.requests.count == 5)
    #expect(fixture.requests.allSatisfy { $0.contains("Bearer fixture-access") && !$0.lowercased().contains("\r\ncookie:") })
}

@Test func careerHTTPEncodesQueryAndPreservesCookieRedirectIsolation() async throws {
    let fixture = try HTTPFixture()
    let cookie = try #require(HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "linkresume-test-\(UUID())", .value: "fixture-cookie"]))
    HTTPCookieStorage.shared.setCookie(cookie)
    defer { HTTPCookieStorage.shared.deleteCookie(cookie) }
    let transport = try DesktopTransport(origin: fixture.origin, allowLocalHTTP: true)
    struct Result: Decodable, Sendable { let ok: Bool }
    #expect(try await transport.career(path: "/api/job-applications", method: "GET", query: ["cursor": "a&b=岗位"], body: nil, access: "fixture-access")["ok"] == .bool(true))
    #expect(try await transport.career(path: "/api/job-applications/1/stages", method: "POST", query: [:], body: .object(["base_lock_version": .number(2)]), access: "fixture-access")["ok"] == .bool(true))
    await #expect(throws: APIError.server(status: 302, code: "HTTP_302")) {
        try await transport.career(path: "/api/job-applications/1", method: "GET", query: [:], body: nil, access: "fixture-access")
    }
    #expect(fixture.requests.count == 3)
    #expect(fixture.requests.allSatisfy { !$0.lowercased().contains("\r\ncookie:") })
    #expect(fixture.requests[0].contains("Bearer fixture-access"))
    #expect(fixture.requests[1].contains("POST /api/job-applications/1/stages"))
    #expect(fixture.requests[0].contains("cursor=a%26b"))
    #expect(HTTPCookieStorage.shared.cookies?.contains { $0.name == "transport-fixture" } != true)
}


@Test func mockInterviewRealHTTPReusesHeaderStripsPrivateMetadataAndRejectsRedirect() async throws {
    let fixture = try HTTPFixture(interview: true)
    let transport = try DesktopTransport(origin: fixture.origin, allowLocalHTTP: true)
    let path = "/api/mock-interviews/01234567-89ab-4cde-8fab-0123456789ab/answers"
    let key = UUID().uuidString.lowercased()
    let body: JSONValue = .object(["__idempotency_key":.string(key), "question_id":.string("1"), "answer":.string("fictional answer")])
    #expect(try await transport.career(path:path, method:"POST", query:[:], body:body, access:"fixture-access")["events"]?.items.count == 2)
    #expect(try await transport.career(path:path, method:"POST", query:[:], body:body, access:"fixture-access")["events"]?.items.count == 1)
    await #expect(throws: APIError.server(status:302, code:"HTTP_302")) { try await transport.career(path:path, method:"POST", query:[:], body:body, access:"fixture-access") }
    #expect(fixture.requests.count == 3)
    #expect(fixture.requests.allSatisfy { $0.contains(key) && !$0.contains("__idempotency_key") && !$0.lowercased().contains("\r\ncookie:") })
}

@Test func libraryRealHTTPMultipartRetryRedirectAndBoundedPrivateDownload() async throws {
    let fixture = try HTTPFixture(library:true)
    let directory = try DatasetUpload.privateDirectory(); defer { try? FileManager.default.removeItem(at:directory) }
    let source = directory.appendingPathComponent("fictional.md"); try Data("# fictional bytes".utf8).write(to:source)
    let upload = try DatasetUpload.snapshot(source,folder:"7",limit:1024); defer { upload.discard() }
    let transport = try DesktopTransport(origin:fixture.origin,allowLocalHTTP:true)
    let result = try await transport.uploadDataset(upload,access:"fixture-access"); #expect(result.text("id") == "1")
    do { _ = try await transport.uploadDataset(upload,access:"fixture-access"); Issue.record("redirect accepted") } catch { }
    let target = directory.appendingPathComponent("download")
    try await transport.downloadDataset(id:"1",to:target,limit:100,access:"fixture-access")
    #expect(try String(contentsOf:target,encoding:.utf8) == "fictional-source")
    do { try await transport.downloadDataset(id:"1",to:target,limit:2,access:"fixture-access"); Issue.record("oversize accepted") } catch { }
    #expect(fixture.requests.count == 4)
    for request in fixture.requests { #expect(!request.lowercased().contains("\r\ncookie:")); #expect(request.contains("Bearer fixture-access")) }
    for request in fixture.requests.prefix(2) { #expect(request.contains(upload.id)); #expect(request.contains("# fictional bytes")); #expect(request.contains("folder_id")); #expect(request.contains("fictional.md")) }
}
