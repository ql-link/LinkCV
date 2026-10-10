import Foundation

/// 与 `GET /api/auth/me` 的 user 对齐（apps/web/src/api/client.ts `User`）。
public struct User: Codable, Equatable, Sendable {
    public let id: String
    public let email: String?
    public let nickname: String
    public let isAdmin: Bool

    enum CodingKeys: String, CodingKey {
        case id, email, nickname
        case isAdmin = "is_admin"
    }
}

/// 简历模板。`data` / `style` / `layout_plan` 是后端契约（contracts/resume/*.schema.json）里的深层结构，
/// 原生层只负责「搬运」给纸面渲染器，不在 Swift 里解析，所以保留为原始 JSON。
public struct ResumeTemplate: Decodable, Identifiable, Sendable {
    public let id: String
    public let key: String
    public let name: String
    public let description: String?
    public let styleCategories: [String]
    public let useCases: [String]
    public let data: JSONValue
    public let style: JSONValue
    public let layoutPlan: JSONValue?
    /// 真实模板接口返回的使用次数；随包示例没有此字段。
    public let useCount: Int?

    enum CodingKeys: String, CodingKey {
        case id, key, name, description, data, style
        case styleCategories = "style_categories"
        case useCases = "use_cases"
        case layoutPlan = "layout_plan"
        case useCount = "use_count"
    }

    /// 组装纸面渲染请求（与 Web 端 client.ts 的 presentationForTemplate 同一规则）。
    public func renderRequest() -> ResumeRenderRequest {
        let templateKey = style["template_key"]?.stringValue ?? key
        let presentation: JSONValue = .object([
            "schema_version": .string("resume-presentation.v1"),
            "portable": .object(["smart_one_page": .bool(false)]),
            "template_scoped": .object([templateKey: .object([:])]),
            "template_snapshot": style,
        ])
        return ResumeRenderRequest(title: name, data: data, style: presentation, layoutPlan: layoutPlan)
    }
}

/// 纸面渲染协议 v1，字段与 apps/web/src/features/preview/print/resumePrintDocument.ts 的
/// `ResumeRenderRequestV1` 一一对应。
public struct ResumeRenderRequest: Encodable, Sendable {
    public let protocolVersion = 1
    public let title: String
    public let data: JSONValue
    public let style: JSONValue
    public let layoutPlan: JSONValue?
    public let assets: [String: String]

    public init(title: String, data: JSONValue, style: JSONValue, layoutPlan: JSONValue?, assets: [String: String] = [:]) {
        self.title = title; self.data = data; self.style = style; self.layoutPlan = layoutPlan; self.assets = assets
    }

    enum CodingKeys: String, CodingKey {
        case title, data, style, assets
        case protocolVersion = "protocol_version"
        case layoutPlan = "layout_plan"
    }
}

/// `GET /api/resumes` 的列表项（apps/web/src/api/client.ts `ResumeSummary`）。
/// `preview` 已是后端编译好的 presentation 与 layout_plan，原生层原样转交纸面。
public struct ResumeSummary: Decodable, Identifiable, Equatable, Sendable {
    public struct Preview: Decodable, Equatable, Sendable {
        public let data: JSONValue
        public let style: JSONValue
        public let layoutPlan: JSONValue?

        enum CodingKeys: String, CodingKey {
            case data, style
            case layoutPlan = "layout_plan"
        }
    }

    public let id: String
    public let title: String
    public let sourceType: String
    public let lockVersion: Int
    public let createdAt: String
    public let updatedAt: String
    public let preview: Preview?

    public init(id: String, title: String, sourceType: String, lockVersion: Int, createdAt: String, updatedAt: String, preview: Preview?) {
        self.id = id; self.title = title; self.sourceType = sourceType; self.lockVersion = lockVersion
        self.createdAt = createdAt; self.updatedAt = updatedAt; self.preview = preview
    }

    enum CodingKeys: String, CodingKey {
        case id, title, preview
        case sourceType = "source_type"
        case lockVersion = "lock_version"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }

    /// 没有预览快照（旧数据或编译失败）时返回 nil，界面显示「预览不可用」。
    public func renderRequest() -> ResumeRenderRequest? {
        guard let preview else { return nil }
        return ResumeRenderRequest(title: title, data: preview.data, style: preview.style, layoutPlan: preview.layoutPlan)
    }

    /// 与 Web `formatUpdatedAt` 同一口径：今天显示时刻，昨天显示「昨天」，今年显示月-日，更早显示年-月-日。
    /// 后端返回不带时区的 UTC 时间，按 UTC 解析后换算到本地时区。
    public func updatedLabel(now: Date = Date(), calendar: Calendar = .current) -> String {
        guard let date = ResumeSummary.parseTimestamp(updatedAt) else { return "—" }
        let pad = { (value: Int) in String(format: "%02d", value) }
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let startOfToday = calendar.startOfDay(for: now)
        if date >= startOfToday { return "今天 \(pad(parts.hour ?? 0)):\(pad(parts.minute ?? 0))" }
        if date >= startOfToday.addingTimeInterval(-86_400) { return "昨天" }
        if parts.year != calendar.component(.year, from: now) { return "\(parts.year ?? 0)-\(pad(parts.month ?? 0))-\(pad(parts.day ?? 0))" }
        return "\(pad(parts.month ?? 0))-\(pad(parts.day ?? 0))"
    }

    static func parseTimestamp(_ value: String) -> Date? {
        let hasZone = value.hasSuffix("Z") || value.range(of: #"[+-]\d{2}:\d{2}$"#, options: .regularExpression) != nil
        let text = hasZone ? value : value + "Z"
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }
}
