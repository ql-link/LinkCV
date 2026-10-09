import Foundation

public enum DatasetRequest {
    public static func id(_ value: String) -> Bool { !value.hasPrefix("0") && UInt64(value).map { $0 > 0 } == true && value.allSatisfy { $0 >= "0" && $0 <= "9" } }
    public static func allowed(path: String, method: String) -> Bool {
        if ["/api/datasets", "/api/datasets/folders"].contains(path) { return ["GET", "POST"].contains(method) }
        if path == "/api/datasets/move-batch" { return method == "POST" }
        let p = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard p.count >= 4, p[0].isEmpty, p[1] == "api" else { return false }
        if p[2] == "interview-sessions", p.count == 6, id(p[3]), p[4] == "assets" { return p[5] == "attach" ? method == "POST" : id(p[5]) && method == "DELETE" }
        guard p[2] == "datasets" else { return false }
        if p.count == 5, p[3] == "folders", id(p[4]) { return ["PATCH", "DELETE"].contains(method) }
        guard id(p[3]) else { return false }
        if p.count == 4 { return ["GET", "PATCH", "DELETE"].contains(method) }
        guard p.count == 5 else { return false }
        return ["content":"GET", "source":"GET", "retry":"POST", "folder":"PATCH", "file":"PUT"][p[4]] == method
    }
}
public struct DatasetRecord: Identifiable, Sendable {
    public let raw: JSONValue
    public init(_ raw: JSONValue) { self.raw = raw }
    public var id: String { raw.text("id") }
    public var name: String { raw.text("file_name") }
    public var folder: String { raw.text("folder_id") }
    public var format: String { raw.text("file_format").uppercased() }
    public var media: Bool { ["audio", "video"].contains(raw.text("asset_kind")) }
    public var ready: Bool { raw.text("upload_status") == "succeeded" && (media || raw.text("parse_status") == "succeeded") }
    public var busy: Bool { raw.text("upload_status") == "uploading" || ["queued", "processing"].contains(raw.text("parse_status")) }
    public var retryable: Bool { !media && raw.text("upload_status") == "succeeded" && raw.text("parse_status") == "failed" }
    public var status: String { if ready { return media ? "可下载" : "可用" }; if raw.text("upload_status") == "failed" { return "上传失败" }; return ["queued":"等待解析", "processing":"正在解析", "failed":"解析失败"][raw.text("parse_status")] ?? "正在上传" }
    public var size: String { ByteCountFormatter.string(fromByteCount: Int64(raw["file_size"]?.numberValue ?? 0), countStyle: .file) }
}
/// Immutable, private snapshot. Retrying preserves bytes, target folder and identity.
public struct DatasetUpload: Sendable, Identifiable {
    public let id: String
    public let file: URL
    public let directory: URL
    public let folder: String
    public var name: String
    public var replacing: String?
    public var revision: String?
    public let limit: Int64
    /// Upload straight to an interview session (`POST /api/interview-sessions/{id}/assets`) instead of a folder.
    public var session: String? = nil
    public static func snapshot(_ source: URL, session: String, limit: Int64) throws -> DatasetUpload {
        guard DatasetRequest.id(session) else { throw APIError.invalidResponse }
        var upload = try snapshot(source, folder: "1", limit: limit)
        upload.session = session
        return upload
    }
    public static func snapshot(_ source: URL, folder: String, limit: Int64) throws -> DatasetUpload {
        guard DatasetRequest.id(folder), limit > 0, limit <= 512 * 1024 * 1024,
              try source.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else { throw APIError.invalidResponse }
        let size = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= limit else { throw APIError.server(status:400, code:"DATASET_FILE_TOO_LARGE") }
        let directory = try privateDirectory()
        do {
            let file = directory.appendingPathComponent("snapshot")
            try FileManager.default.copyItem(at:source, to:file)
            try FileManager.default.setAttributes([.posixPermissions:0o600], ofItemAtPath:file.path)
            guard (try file.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0) == size else { throw APIError.invalidResponse }
            return DatasetUpload(id:UUID().uuidString.lowercased(),file:file,directory:directory,folder:folder,name:source.lastPathComponent,replacing:nil,revision:nil,limit:limit)
        } catch { try? FileManager.default.removeItem(at:directory); throw error }
    }
    public func rekey() -> DatasetUpload { DatasetUpload(id:UUID().uuidString.lowercased(),file:file,directory:directory,folder:folder,name:name,replacing:replacing,revision:revision,limit:limit,session:session) }
    public func discard() { try? FileManager.default.removeItem(at:directory) }
    public static func privateDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("LinkResumeLibrary-" + UUID().uuidString)
        try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:false,attributes:[.posixPermissions:0o700])
        return directory
    }
}
public struct DatasetFile: Sendable {
    public let url: URL
    public let directory: URL
    public func discard() { try? FileManager.default.removeItem(at:directory) }
}
