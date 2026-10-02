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

    enum CodingKeys: String, CodingKey {
        case id, key, name, description, data, style
        case styleCategories = "style_categories"
        case useCases = "use_cases"
        case layoutPlan = "layout_plan"
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
