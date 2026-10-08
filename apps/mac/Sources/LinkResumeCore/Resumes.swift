import Foundation

/// 桌面简历白名单（与后端 `get_current_resume_user` 对齐）：从模板新建、导入、编辑正文与版式、切换模板、
/// 上传与删除简历图片、重命名、复制、删除与分享。语义分类工具仍只在 Web 提供。
public enum ResumeRequest {
    public static func allowed(path: String, method: String) -> Bool {
        guard path.hasPrefix("/api/"), !path.contains("//"), !path.hasSuffix("/"), !path.contains("?"), !path.contains("#"), !path.contains("..") else { return false }
        if path == "/api/resumes" { return method == "GET" || method == "POST" }
        if path == "/api/resume-overview" { return method == "GET" }
        if path.hasPrefix("/api/resume-imports/") {
            let id = path.dropFirst("/api/resume-imports/".count)
            return !id.isEmpty && id.count <= 20 && id.allSatisfy { $0.isASCII && $0.isNumber } && ["GET", "DELETE"].contains(method)
        }
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count >= 3, parts[0] == "api", parts[1] == "resumes", !parts[2].isEmpty, parts[2].count <= 20,
              parts[2].allSatisfy({ $0.isASCII && $0.isNumber }) else { return false }
        if parts.count == 3 { return ["GET", "PUT", "DELETE"].contains(method) }
        if parts.count == 5, parts[3] == "assets" { return method == "DELETE" && !parts[4].isEmpty && parts[4].count <= 255 }
        guard parts.count == 4 else { return false }
        if parts[3] == "copy" || parts[3] == "apply-template" || parts[3] == "assets" { return method == "POST" }
        if parts[3] == "share" { return ["GET", "POST", "PATCH", "DELETE"].contains(method) }
        return false
    }

    /// Web `RETIRED_RESUME_TEMPLATE_KEYS`：已退出产品目录的模板不出现在可选列表。
    public static let retiredTemplateKeys: Set<String> = ["blank-cn"]

    /// 与 Web `MAX_RESUMES_PER_USER` 一致，仅用于提前禁用按钮；最终以后端 `RESUME_LIMIT_REACHED` 为准。
    public static let maximumPerUser = 10

    public static func errorMessage(_ error: Error, fallback: String) -> String {
        if case APIError.unauthorized = error { return "登录已失效，请重新登录。" }
        guard case APIError.server(_, let code) = error else { return fallback }
        return [
            "INVALID_RESUME_TITLE": "名称无效，请输入 1–255 个字符且不含换行。",
            "RESUME_TITLE_CONFLICT": "已有同名简历，请换一个名称。",
            "RESUME_LIMIT_REACHED": "已达简历数量上限，删除不用的简历后再试。",
            "TEMPLATE_INACTIVE": "这套模板已下线，请刷新模板列表后重选。",
            "TEMPLATE_REQUIRED": "请先选择模板。",
            "RESUME_EDIT_CONFLICT": "简历已在其他设备更新，请刷新列表后重试。",
            "RESUME_COPY_REQUEST_CONFLICT": "这次复制请求已用于其他操作，请重新复制。",
            "RESUME_NOT_FOUND": "这份简历已不存在，请刷新列表。",
            "SHARE_LINK_UNAVAILABLE": "分享链接已不存在，请重新创建。",
            "IMAGE_TOO_LARGE": "图片不能超过 10 MB。",
            "INVALID_IMAGE": "只支持 PNG 或 JPEG 图片。",
            "ASSET_UPLOAD_FAILED": "图片上传失败，请稍后重试。",
            "DESKTOP_ROUTE_FORBIDDEN": "当前服务尚未开放桌面端此操作，请更新服务端后重试。",
        ][code] ?? fallback
    }
}

/// `GET/POST/PATCH /api/resumes/{id}/share` 的 share 对象。
public struct ResumeShare: Equatable, Sendable {
    public let token: String
    public let isPublic: Bool
    public let expiresAt: Date?
    public let allowDownload: Bool
    public let createdAt: Date?

    public init?(_ value: JSONValue?) {
        guard let value, case .object = value, let token = value["share_token"]?.stringValue, !token.isEmpty else { return nil }
        self.token = token
        isPublic = value["share_visibility"]?.stringValue == "public"
        expiresAt = value["share_expires_at"]?.stringValue.flatMap(ResumeSummary.parseTimestamp)
        if case .bool(let allow) = value["share_allow_download"] { allowDownload = allow } else { allowDownload = true }
        createdAt = value["share_created_at"]?.stringValue.flatMap(ResumeSummary.parseTimestamp)
    }

    public func isExpired(now: Date = Date()) -> Bool { expiresAt.map { $0 <= now } ?? false }

    /// Web `shareUrl`：站点 origin 与 API origin 相同，链接为 `{origin}/share/{token}`。
    public func url(origin: URL) -> URL { origin.appending(path: "share").appending(path: token) }

    /// Web 重新生成规则：未过期保留原到期时间；已过期按原有效时长顺延，推算不出时默认 7 天。
    public func regeneratedExpiry(now: Date = Date()) -> Date? {
        guard let expiresAt, expiresAt <= now else { return expiresAt }
        if let createdAt, createdAt < expiresAt { return now.addingTimeInterval(expiresAt.timeIntervalSince(createdAt)) }
        return now.addingTimeInterval(7 * 86_400)
    }

    public static func encode(_ date: Date?) -> JSONValue {
        guard let date else { return .null }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return .string(formatter.string(from: date))
    }
}

/// 一次简历文件导入（Markdown / DOCX / PDF，最多 10 MiB）。读取后整份放在内存，不落盘。
public struct ResumeImportUpload: Sendable {
    public let fileName: String
    public let contentType: String
    public let content: Data
    public let templateID: String?
    public let idempotencyKey: String

    public static let maximumBytes = 10 * 1024 * 1024
    public static let types = ["md": "text/markdown", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "pdf": "application/pdf"]

    /// 读取用户选择的文件并做与后端一致的前置校验；不通过时抛出对应错误码。
    public init(file: URL, templateID: String?, idempotencyKey: String = UUID().uuidString.lowercased()) throws {
        let ext = file.pathExtension.lowercased()
        guard let type = Self.types[ext] else { throw APIError.server(status: 415, code: "UNSUPPORTED_IMPORT_FORMAT") }
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: Self.maximumBytes + 1) ?? Data()
        guard !data.isEmpty else { throw APIError.server(status: 400, code: "EMPTY_IMPORT_FILE") }
        guard data.count <= Self.maximumBytes else { throw APIError.server(status: 413, code: "IMPORT_FILE_TOO_LARGE") }
        fileName = file.lastPathComponent; contentType = type; content = data
        self.templateID = templateID; self.idempotencyKey = idempotencyKey
    }

    public static func errorMessage(_ error: Error) -> String {
        if case APIError.unauthorized = error { return "登录已失效，请重新登录。" }
        guard case APIError.server(_, let code) = error else { return "上传中断，结果尚未确认。请刷新列表查看导入任务。" }
        return [
            "UNSUPPORTED_IMPORT_FORMAT": "只支持 Markdown、DOCX 和 PDF 文件。",
            "EMPTY_IMPORT_FILE": "文件是空的，请换一个文件。",
            "IMPORT_FILE_TOO_LARGE": "文件超过 10 MB，请压缩后再导入。",
            "IMPORT_CONTENT_INVALID": "文件内容无法读取，请检查文件后重试。",
            "INVALID_IMPORT_FILENAME": "文件名无效，请重命名后再导入。",
            "STRUCTURING_INPUT_TOO_LARGE": "文件内容过长，请精简后再导入。",
            "TEMPLATE_INACTIVE": "默认模板暂不可用，请稍后再试。",
            "RESUME_LIMIT_REACHED": "已达简历数量上限，删除不用的简历后再导入。",
            "RESUME_LAYOUT_UNSUPPORTED": "文件版式暂不支持自动导入，请换成更简单的版式。",
        ][code] ?? "导入失败（\(code)），请稍后重试。"
    }
}
