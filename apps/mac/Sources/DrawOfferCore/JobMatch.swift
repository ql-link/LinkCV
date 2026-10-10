import Foundation

/// 岗位 × 简历匹配结果（`GET /api/job-descriptions/{id}/match` 的 match，Web `JobMatch`）。
public struct JobMatch: Equatable, Sendable {
    public let status: String
    public let stale: Bool
    public let score: Int?
    public let headline: String?
    public let hits: [String]
    public let gaps: [String]
    public let covered: [String]
    public let missing: [String]
    public let errorCode: String?

    public init?(_ value: JSONValue?) {
        guard let value, case .object = value, let status = value["status"]?.stringValue else { return nil }
        self.status = status
        if case .bool(let flag) = value["stale"] { stale = flag } else { stale = false }
        score = value["score"]?.numberValue.map { Int($0) }
        headline = value["headline"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
        let strings = { (item: JSONValue?) in (item?.items ?? []).compactMap(\.stringValue) }
        hits = strings(value["hits"]); gaps = strings(value["gaps"])
        covered = strings(value["highlights"]?["covered"]); missing = strings(value["highlights"]?["missing"])
        errorCode = value["error_code"]?.stringValue
    }

    public var pending: Bool { status == "pending" }
    public var ready: Bool { status == "ready" }

    /// Web `matchErrorMessage`。
    public static func errorMessage(_ code: String?) -> String {
        switch code {
        case "JOB_MATCH_NO_DESCRIPTION": "请先补充岗位描述。"
        case "LLM_MODEL_NOT_CONFIGURED": "AI 匹配分析暂未开放。"
        case "JOB_NOT_FOUND", "RESUME_NOT_FOUND": "岗位或简历已不存在，请刷新页面。"
        case "JOB_MATCH_INTERRUPTED": "上次分析被中断，请重新分析。"
        default: "分析没有完成，请稍后重新分析。"
        }
    }

    /// 前端轮询节奏与 Web 一致：每 3 秒一次，最多 20 次。
    public static let pollInterval: Duration = .seconds(3)
    public static let pollLimit = 20
}

/// 首页推荐岗位（`/api/job-matches/recommendations`）。
public struct JobMatchRecommendations: Equatable, Sendable {
    public struct Item: Equatable, Sendable, Identifiable {
        public let id: String
        public let title: String
        public let company: String
        public let score: Int
        public let applicationStatus: String?
    }
    public let state: String
    public let resumeTitle: String?
    public let items: [Item]
    public let pendingCount: Int
    public let canCompute: Bool

    public init(_ value: JSONValue) {
        state = value.text("state")
        resumeTitle = value["resume"]?["title"]?.stringValue
        items = (value["items"]?.items ?? []).map {
            Item(id: $0.text("job_id"), title: $0.text("job_title"), company: $0.text("company_name"),
                 score: $0["score"]?.integer ?? 0, applicationStatus: $0["application_status"]?.stringValue)
        }
        pendingCount = value["pending_count"]?.integer ?? 0
        if case .bool(let flag) = value["can_compute"] { canCompute = flag } else { canCompute = false }
    }
}

/// 岗位详情的完整可编辑字段（Web `JobDescriptionFields`）。PUT 需要提交完整字段集合与 base_lock_version。
public enum JobDescriptionFields {
    public static let optionalText = [
        "logo_url", "employment_type", "education_requirement", "experience_requirement", "work_schedule", "work_city",
        "work_address", "work_mode", "salary_text", "salary_min", "salary_max", "salary_currency", "salary_period",
        "company_legal_name", "company_industry", "company_size", "company_financing_stage", "company_description",
        "recruiter_name", "recruiter_title", "notes",
    ]
    public static let employment = [("internship", "实习"), ("campus", "校招"), ("full_time", "正式")]
    public static let workMode = [("onsite", "现场"), ("hybrid", "混合"), ("remote", "远程")]
    public static let salaryPeriod = [("hour", "小时"), ("day", "天"), ("month", "月"), ("year", "年")]

    /// 由岗位记录与修改合成 PUT 请求体：可选文本去空白后为空即 null，技能按逗号拆分。
    public static func payload(record: JSONValue, changes: [String: String]) -> JSONValue {
        func value(_ key: String) -> String {
            if let changed = changes[key] { return changed }
            if key == "skills" { return (record["skills"]?.items ?? []).compactMap(\.stringValue).joined(separator: ", ") }
            if key == "salary_months_per_year", let number = record[key]?.numberValue { return String(Int(number)) }
            return record.text(key)
        }
        var fields: [String: JSONValue] = [
            "job_title": .string(value("job_title").trimmingCharacters(in: .whitespacesAndNewlines)),
            "company_name": .string(value("company_name").trimmingCharacters(in: .whitespacesAndNewlines)),
            "description": .string(value("description")),
            "skills": .array(value("skills").split(whereSeparator: { $0 == "," || $0 == "，" || $0 == "、" })
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }.map(JSONValue.string)),
            "base_lock_version": .number(Double(record["lock_version"]?.integer ?? 1)),
        ]
        for key in optionalText {
            let text = key == "notes" || key == "company_description" ? value(key) : value(key).trimmingCharacters(in: .whitespacesAndNewlines)
            fields[key] = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .null : .string(text)
        }
        if let currency = fields["salary_currency"]?.stringValue { fields["salary_currency"] = .string(currency.uppercased()) }
        fields["salary_months_per_year"] = Int(value("salary_months_per_year").trimmingCharacters(in: .whitespaces)).map { .number(Double($0)) } ?? .null
        return .object(fields)
    }

    public static func errorMessage(_ error: Error, fallback: String) -> String {
        if case APIError.unauthorized = error { return "登录状态已失效，请重新登录。" }
        guard case APIError.server(_, let code) = error else { return fallback }
        return ["JD_NOT_FOUND": "岗位不存在，或当前账号没有访问权限。", "JD_EDIT_CONFLICT": "岗位内容已经变化，请重新打开后再保存。",
                "INVALID_JOB_DESCRIPTION": "请检查必填字段、薪资组合和字段长度。"][code] ?? fallback
    }
}
