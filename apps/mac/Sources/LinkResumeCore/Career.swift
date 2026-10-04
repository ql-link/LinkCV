import Foundation

public enum CareerRequest {
    public static func allowed(path: String, method: String) -> Bool {
        if DatasetRequest.allowed(path: path, method: method) { return true }
        if MockInterviewRequest.allowed(path: path, method: method) { return true }
        guard path.hasPrefix("/api/"), !path.contains("//"), !path.hasSuffix("/"), !path.contains("?"), !path.contains("#"), !path.contains("..") else { return false }
        let reads = ["/api/resumes", "/api/job-applications", "/api/interview-overview", "/api/interview-sessions", "/api/job-descriptions"]
        if method == "GET", reads.contains(path) { return true }
        if method == "POST", ["/api/job-descriptions", "/api/job-descriptions/parse-draft", "/api/job-applications"].contains(path) { return true }
        let parts = path.split(separator: "/").map(String.init)
        guard parts.count >= 3, parts[0] == "api", parts[2].allSatisfy({ $0 >= "0" && $0 <= "9" }), !parts[2].isEmpty else { return false }
        if parts.count == 3 {
            if ["job-applications", "job-descriptions"].contains(parts[1]) { return ["GET", "PUT", "DELETE"].contains(method) }
            return parts[1] == "interview-sessions" && ["GET", "PUT", "DELETE"].contains(method)
        }
        if parts.count == 4, parts[1] == "job-descriptions", parts[3] == "logo" { return method == "GET" }
        if parts.count == 4, parts[1] == "interview-sessions", parts[3] == "answer-plan" { return method == "PUT" }
        if parts[1] == "interview-sessions", let stage = stageDetail(parts, method: method) { return stage }
        if parts.count == 4, parts[1] == "interview-assets", parts[3] == "content" { return method == "GET" }
        guard parts.count == 4, method == "POST" else { return false }
        if parts[1] == "job-applications" { return ["stages", "terminate", "offer", "close", "archive", "restore", "interview-sessions"].contains(parts[3]) }
        return parts[1] == "interview-sessions" && ["complete", "cancel", "reschedule"].contains(parts[3])
    }

    /// Stage detail (04.C03): recordings, transcription, review notes, written import and AI review.
    /// `nil` leaves the decision to the general career rules.
    private static func stageDetail(_ parts: [String], method: String) -> Bool? {
        let numeric = { (value: String) in !value.isEmpty && value.allSatisfy { $0 >= "0" && $0 <= "9" } }
        if parts.count == 4 {
            switch parts[3] {
            case "assets": return ["GET", "POST"].contains(method)
            case "review-notes": return method == "PUT"
            case "written-questions:extract", "review:generate": return method == "POST"
            default: return nil
            }
        }
        if parts.count == 5, parts[3] == "review-notes" { return numeric(parts[4]) && method == "DELETE" }
        if parts.count == 5, parts[3] == "transcriptions" {
            let segment = parts[4].split(separator: ":", omittingEmptySubsequences: false).map(String.init)
            return segment.count == 2 && numeric(segment[0]) && ["retry", "apply"].contains(segment[1]) && method == "POST"
        }
        return nil
    }
}

extension JSONValue {
    public var items: [JSONValue] { if case .array(let items) = self { return items }; return [] }
    public var integer: Int { if case .number(let value) = self { return Int(value) }; return 0 }
    public func text(_ field: String) -> String { self[field]?.stringValue ?? "" }
}

public struct CareerApplication: Identifiable, Sendable {
    public let raw: JSONValue
    public let completedSchedule: Date?
    public init(_ raw: JSONValue, completedSchedule: Date? = nil) { self.raw = raw; self.completedSchedule = completedSchedule }
    public func includingSessions(_ sessions: [JSONValue]) -> CareerApplication {
        let stageID = raw["current_stage"]?.text("id") ?? ""
        guard !stageID.isEmpty else { return self }
        let latest = sessions.filter { $0.text("application_id") == id && $0.text("application_stage_id") == stageID && $0.text("status") != "cancelled" }
            .max { (Self.date($0.text("start_at")) ?? .distantPast) < (Self.date($1.text("start_at")) ?? .distantPast) }
        return CareerApplication(raw, completedSchedule: latest?.text("status") == "completed" ? Self.date(latest?.text("start_at") ?? "") : nil)
    }
    public var id: String { raw.text("id") }
    public var company: String { raw.text("company_name_snapshot") }
    public var title: String { raw.text("job_title_snapshot") }
    public var lockVersion: Int { raw["lock_version"]?.integer ?? 0 }
    public var ended: Bool { raw.text("lifecycle_status") == "terminated" || !["", "active"].contains(raw.text("status")) || !raw.text("archived_at").isEmpty }
    public var logoRequest: (path: String, revision: String)? {
        guard let url = URLComponents(string: raw.text("company_logo_url")), url.scheme == nil, url.host == nil, url.fragment == nil,
              CareerRequest.allowed(path: url.path, method: "GET"), url.path.hasSuffix("/logo"),
              url.queryItems?.count == 1, let query = url.queryItems?.first, query.name == "v", let revision = query.value,
              revision.count == 64, revision.allSatisfy({ ("0"..."9").contains(String($0)) || ("a"..."f").contains(String($0)) }) else { return nil }
        return (url.path, revision)
    }
    public var category: String { raw["job_snapshot"]?.text("employment_type") ?? "" }
    public var categoryLabel: String { ["internship": "实习", "campus": "校招", "full_time": "正式"][category] ?? "未分类" }
    public var stage: String {
        if ended { return "ended" }
        if raw.text("phase") == "pending" || (raw.text("phase").isEmpty && raw.text("applied_at").isEmpty && (raw["current_stage"] == nil || raw["current_stage"] == .null) && raw.text("current_stage_type") == "screening") { return "pending" }
        let value = (raw["current_stage"]?.text("stage_type") ?? "").nonempty(raw.text("current_stage_type"))
        if value == "hr" { return "interview" }
        if value == "oc" { return "offer" }
        if value == "screening" {
            if raw.text("current_stage_label").contains("笔试") { return "written_test" }
            if raw.text("current_stage_label").contains("测评") { return "assessment" }
        }
        return CareerStage.keys.contains(value) ? value : "screening"
    }
    public var stageLabel: String { if stage == "offer" && raw.text("offer_status") == "none" { return "OC" }; return ["interview", "ai_interview"].contains(stage) ? (raw["current_stage"]?.text("stage_label") ?? "").nonempty(raw.text("current_stage_label")).nonempty(CareerStage.label(stage)) : CareerStage.label(stage) }
    /// Board column. An accepted Offer stays in the Offer column like Web, although the flow has ended.
    public var column: String {
        if raw.text("archived_at").isEmpty && raw.text("status") == "closed" && raw.text("offer_status") == "accepted" { return "offer" }
        return ["interview", "ai_interview"].contains(stage) ? "interview:\(stageLabel)" : stage
    }
    public var statusLabel: String {
        if raw.text("offer_status") == "accepted" { return "已接受 Offer" }; if raw.text("offer_status") == "declined" { return "已婉拒 Offer" }
        if stage == "pending" { return "等待确认投递" }
        if ended { return "结束阶段：" + raw.text("current_stage_label").nonempty(CareerStage.label(raw.text("current_stage_type"))) }
        if raw.text("stage_state") == "completed" || completedSchedule != nil { return "已完成" }
        if stage == "offer" { return raw.text("offer_status") == "none" ? "OC 口头意向" : "已收到 Offer" }
        if raw.text("stage_state") == "awaiting_schedule" { return "等待安排" }
        if raw.text("stage_state") == "awaiting_result" { return "等待结果" }
        if raw.text("stage_state") == "scheduled" { return "已安排" }
        return stageLabel
    }
    public var movable: Bool { !ended && stage != "offer" }
    public var scheduleDate: Date? { guard ["assessment", "written_test", "ai_interview", "interview"].contains(stage) else { return nil }; return Self.date(raw.text("next_session_start_at")) }
    public static func date(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: text) ?? ISO8601DateFormatter().date(from: text)
    }
}

public enum CareerStage {
    public static let keys = ["pending", "screening", "assessment", "written_test", "ai_interview", "interview", "offer", "ended"]
    public static func nextStages(_ item: CareerApplication?) -> [String] {
        let candidates = keys.filter { !["pending", "ended"].contains($0) }
        guard let item else { return candidates }
        let rank = keys.firstIndex(of: item.stage) ?? 0
        return candidates.filter { $0 == "interview" ? rank <= (keys.firstIndex(of: $0) ?? 0) : rank < (keys.firstIndex(of: $0) ?? 0) }
    }
    public static func canAdvance(_ item: CareerApplication, to column: String, stage: String? = nil) -> Bool {
        let target = stage ?? (column.hasPrefix("interview:") ? "interview" : column)
        guard item.movable, item.column != column, target != "pending" else { return false }
        return target == "ended" || (keys.firstIndex(of: target) ?? -1) >= (keys.firstIndex(of: item.stage) ?? Int.max)
    }
    public static func label(_ key: String) -> String { ["pending": "待投递", "screening": "筛选中", "assessment": "测评", "written_test": "笔试", "ai_interview": "AI 面试", "interview": "面试中", "offer": "Offer", "ended": "已结束"][key] ?? key }
    public static func columns(_ applications: [CareerApplication]) -> [String] {
        let rounds = Dictionary(grouping: applications.filter { ["interview", "ai_interview"].contains($0.stage) }, by: \.column)
        let ordered = rounds.keys.sorted {
            let left = rounds[$0]?.compactMap { $0.raw["current_round_no"]?.integer }.filter { $0 > 0 }.min() ?? Int.max
            let right = rounds[$1]?.compactMap { $0.raw["current_round_no"]?.integer }.filter { $0 > 0 }.min() ?? Int.max
            return left == right ? $0 < $1 : left < right
        }
        return keys.filter { $0 != "ai_interview" }.flatMap { $0 == "interview" ? (ordered.isEmpty ? ["interview:面试中"] : ordered) : [$0] }
    }
    public static func sorted(_ applications: [CareerApplication], earliest: Bool) -> [CareerApplication] {
        applications.sorted { left, right in
            if !earliest {
                if let l = left.scheduleDate, let r = right.scheduleDate, l != r { return l < r }
                if left.scheduleDate != nil && right.scheduleDate == nil { return true }
                if left.scheduleDate == nil && right.scheduleDate != nil { return false }
            }
            if !earliest {
                if let l = left.completedSchedule, let r = right.completedSchedule, l != r { return l > r }
                if left.completedSchedule != nil && right.completedSchedule == nil { return true }
                if left.completedSchedule == nil && right.completedSchedule != nil { return false }
            }
            let l = CareerApplication.date(left.raw.text("created_at")) ?? .distantFuture
            let r = CareerApplication.date(right.raw.text("created_at")) ?? .distantFuture
            return l == r ? left.id.localizedStandardCompare(right.id) == .orderedAscending : l < r
        }
    }
}

private extension String { func nonempty(_ fallback: String) -> String { isEmpty ? fallback : self } }

/// V4's only page-level primary action. Stage history never mutates the flow.
public struct CareerFlow: Sendable {
    public let kind: String
    public let button: String
    public let headline: String
    public let explanation: String
    public init(_ item: CareerApplication) {
        if item.ended {
            kind = "history"; button = "查看阶段记录"
            headline = item.raw.text("offer_status") == "accepted" ? "已接受 Offer" : item.raw.text("offer_status") == "declined" ? "已婉拒 Offer" : "本次求职已结束"
            explanation = "保留每个阶段的记录，回顾这次求职经历。"
        } else if item.stage == "pending" {
            kind = "apply"; button = "记录投递"; headline = "准备好了，就记录一次投递。"
            explanation = "记录投递日期、渠道和使用的简历，开始跟进这个岗位。"
        } else if item.stage == "offer" {
            let received = item.raw.text("offer_status") == "received"
            kind = received ? "accept" : "offer"; button = received ? "接受 Offer" : "记录正式 Offer"
            headline = received ? "正式 Offer 已收到，做出你的选择。" : "口头意向已沟通，等待正式 Offer。"
            explanation = received ? "核对薪酬、工作地点和入职信息，再确认是否接受。" : "收到正式 Offer 后，记录条件并决定接受或婉拒。"
        } else if ["assessment", "written_test", "ai_interview", "interview"].contains(item.stage) && item.raw.text("stage_state") == "awaiting_schedule" {
            kind = "schedule-current"; button = "安排时间"; headline = "先把时间安排好。"
            explanation = "记录时间、方式和链接，排期会同步到面试日程。"
        } else if item.raw.text("stage_state") == "scheduled" && item.completedSchedule == nil {
            kind = "records"; button = "记录与复盘"; headline = "已安排，准备好迎接这次机会。"
            explanation = "查看排期、记录面试情况；结束后标记完成。"
        } else {
            kind = "stage"; button = item.stage == "screening" ? "进入下一阶段" : "通过，添加下一轮"
            headline = "等待结果，有进展再记录。"
            explanation = "收到通过通知后，添加下一阶段；多轮面试会分别保留记录。"
        }
    }
}

/// V4 fields that the shared schema keeps in notes. Preserve all unrelated lines.
public enum CareerNotes {
    public static let fields = ["投递渠道", "口头薪酬", "收到日期", "回复截止", "薪酬说明", "预计入职", "试用期", "Offer 材料"]
    public static func value(_ field: String, in notes: String) -> String {
        notes.components(separatedBy: "\n").first(where: { $0.hasPrefix(field + "：") }).map { String($0.dropFirst(field.count + 1)) } ?? ""
    }
    public static func freeText(_ notes: String) -> String { notes.components(separatedBy: "\n").filter { line in !fields.contains(where: { line.hasPrefix($0 + "：") }) }.joined(separator: "\n") }
    public static func merging(_ values: [String: String], into notes: String) -> String {
        let keys = Set(values.keys.filter { fields.contains($0) })
        var lines = notes.components(separatedBy: "\n").filter { line in !keys.contains(where: { line.hasPrefix($0 + "：") }) }
        for key in fields where keys.contains(key) { if let value = values[key], !value.isEmpty { lines.append(key + "：" + value.replacingOccurrences(of: "\n", with: " ")) } }
        return lines.joined(separator: "\n").trimmingCharacters(in: .newlines)
    }
}

public struct CareerProgressStep: Identifiable, Sendable {
    public let id: String
    public let label: String
    public let date: String
    public let state: String
}
public enum CareerProgress {
    public static func steps(_ item: CareerApplication) -> [CareerProgressStep] {
        let stages = item.raw["stages"]?.items ?? []
        if stages.isEmpty {
            let type = item.ended ? item.raw.text("current_stage_type") : item.stage
            let rank = type == "pending" ? 0 : type == "screening" ? 1 : ["assessment", "written_test"].contains(type) ? 2 : type == "offer" ? 4 : 3
            return ["待投递", "筛选中", "笔试 / 测评", "面试", "Offer"].enumerated().map { index, label in CareerProgressStep(id: String(index), label: label, date: index == 0 ? item.raw.text("created_at") : "", state: index == rank && !item.ended ? "current" : "future") }
        }
        let currentID = item.raw["current_stage"]?.text("id") ?? ""
        var result = [CareerProgressStep(id: "applied", label: "已投递", date: item.raw.text("applied_at"), state: "completed")]
        for stage in stages {
            let isCurrent = stage.text("id") == currentID || currentID.isEmpty && stage == stages.last
            let state = !item.ended && isCurrent ? "current" : "completed"
            let type = stage.text("stage_type")
            let oral = type == "offer" && (stage.text("stage_label") == "OC" || item.raw.text("offer_status") == "none")
            let formal = type == "offer" && ["received", "accepted", "declined"].contains(item.raw.text("offer_status"))
            result.append(CareerProgressStep(id: stage.text("id"), label: oral ? "OC" : stage.text("stage_label"), date: stage.text("entered_at"), state: oral && formal ? "completed" : state))
            if oral && formal { result.append(CareerProgressStep(id: "formal", label: "Offer", date: CareerNotes.value("收到日期", in: item.raw.text("notes")), state: state)) }
        }
        if !item.ended {
            let future: [String] = item.stage == "screening" ? ["笔试 / 测评", "面试", "Offer"] : ["assessment", "written_test"].contains(item.stage) ? ["面试", "Offer"] : ["interview", "ai_interview"].contains(item.stage) ? ["Offer"] : []
            for label in future { result.append(CareerProgressStep(id: "future:" + label, label: label, date: "", state: "future")) }
        }
        return result
    }
}
