import Foundation
public enum MockInterviewRequest {
    public static func allowed(path: String, method: String) -> Bool {
        if path == "/api/mock-interviews" { return ["GET", "POST"].contains(method) }
        if path == "/api/datasets" { return method == "GET" }
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 4 || parts.count == 5, parts[0].isEmpty, parts[1] == "api", parts[2] == "mock-interviews",
              let id = UUID(uuidString: String(parts[3])), id.uuidString.lowercased() == parts[3] else { return false }
        if parts.count == 4 { return ["GET", "DELETE"].contains(method) }
        return method == "POST" && ["answers", "skip", "reply:retry", "finish", "abandon", "retry", "repeat"].contains(parts[4])
    }
    public static func decodeEvents(_ data: Data) throws -> JSONValue {
        guard data.count <= 4 * 1024 * 1024, let source = String(data: data, encoding: .utf8) else { throw APIError.invalidResponse }
        var events: [JSONValue] = []
        for block in source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n\n") {
            var kind = ""; var lines: [String] = []
            for line in block.components(separatedBy: "\n") {
                if line.hasPrefix("event:") { kind = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces) }
                if line.hasPrefix("data:") { lines.append(String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)) }
            }
            if lines.isEmpty { continue }
            let value = try JSONDecoder().decode(JSONValue.self, from: Data(lines.joined(separator: "\n").utf8))
            if kind == "interviewer.failed" { throw APIError.server(status: 502, code: value.text("error")) }
            events.append(.object(["event": .string(kind), "data": value]))
        }
        guard !events.isEmpty else { throw APIError.invalidResponse }
        return .object(["events": .array(events)])
    }
}
public struct MockInterview: Identifiable, Sendable {
    public let raw: JSONValue
    public init(_ raw: JSONValue) { self.raw = raw }
    public var id: String { raw.text("id") }
    public var status: String { raw.text("status") }
    public var active: Bool { ["preparing", "in_progress", "evaluating"].contains(status) }
    public var title: String { let title = raw.text("company_name") + " · " + raw.text("job_title"); return raw.text("company_name").isEmpty ? raw.text("resume_title") + " · 通用面试" : title }
    public var questions: [JSONValue] { raw["questions"]?.items ?? [] }
    public var current: JSONValue? { questions.first { $0.text("id") == raw.text("current_question_id") && $0.text("answer_status") == "pending" } }
    public var label: String { Self.statusLabels[status] ?? status }
    public var type: String { Self.types[raw.text("interview_type")] ?? "综合面" }
    public static let types = ["technical": "技术面", "project_deep_dive": "项目深挖", "comprehensive": "综合面", "hr": "HR 面"]
    public static let dimensions = ["professional_depth": "专业深度", "structure": "表达结构", "job_fit": "岗位匹配", "resume_consistency": "简历一致性", "communication": "沟通表现"]
    public static let statusLabels = ["preparing": "准备中", "preparation_failed": "准备失败", "in_progress": "面试中", "evaluating": "评估中", "evaluation_failed": "评估失败", "completed": "已完成", "abandoned": "已放弃"]
}
