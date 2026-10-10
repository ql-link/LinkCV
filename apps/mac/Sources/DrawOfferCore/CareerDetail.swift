import Foundation

/// Native port of Web `applicationDetailModel.ts` (04.C01 求职进度页).
/// The page has one primary "next step" action whose copy depends on stage × in-stage state.
/// Scheduled sessions complete by time: once the end time passes the stage waits for a result.
public enum CareerTone: String, Sendable { case blue, green, orange, gray, red, dark }

public struct CareerChip: Hashable, Sendable {
    public let label: String
    public let tone: CareerTone
    public init(_ label: String, _ tone: CareerTone) { self.label = label; self.tone = tone }
}

public struct CareerDetailStep: Identifiable, Sendable {
    public enum State: String, Sendable { case done, current, next, failed, offer, todo }
    public let id: String
    public let label: String
    public let meta: String
    public let state: State
}

public enum CareerDetailTile: Sendable {
    case date(head: String, day: String, foot: String)
    case status(title: String, sub: String, tone: CareerTone)
}

public enum CareerDetailAction: String, Sendable {
    case recordApplied = "record-applied", advance, schedule, recordReview = "record-review", answerPlan = "answer-plan"
    case reschedule, cancelSession = "cancel-session", recordOffer = "record-offer", acceptOffer = "accept-offer"
    case editOffer = "edit-offer", declineOffer = "decline-offer", viewReview = "view-review"
}

public struct CareerDetailButton: Sendable {
    public let action: CareerDetailAction
    public let label: String
    public var danger = false
    public var dark = true
}

public struct CareerDetailNext: Sendable {
    public let lead: String
    public let tile: CareerDetailTile
    public let chips: [CareerChip]
    public let title: String
    public let detail: String
    public let hint: String?
    public let primary: CareerDetailButton?
    public let secondary: [CareerDetailButton]
    /// The accent strip follows the status chip; the stage-name chip comes first when present.
    public var accent: CareerTone {
        let chip = chips.count > 1 ? chips[1] : chips.first
        guard let chip, chip.tone != .dark else { return .gray }
        return chip.tone
    }
}

public struct CareerHistoryItem: Identifiable, Sendable {
    public let id: String
    public let date: String
    public let title: String
    public let chip: CareerChip
    public let detail: String
    public let dot: CareerTone?
    public let highlight: CareerTone?
    public let sessionID: String?
}

public struct CareerInfoRow: Identifiable, Sendable {
    public var id: String { label }
    public let label: String
    public let value: String
    public var tone: CareerTone? = nil
    public init(label: String, value: String, tone: CareerTone? = nil) { self.label = label; self.value = value; self.tone = tone }
}

public struct CareerOfferCard: Sendable {
    public let title: String
    public let action: String
    public let rows: [CareerInfoRow]
}

public struct CareerDetailModel: Sendable {
    public let ended: Bool
    public let pending: Bool
    public let verbalOffer: Bool
    public let headerMeta: String
    public let currentLabel: String
    public let steps: [CareerDetailStep]
    public let next: CareerDetailNext
    public let history: [CareerHistoryItem]
    public let offerCard: CareerOfferCard?
    public let deliveryRows: [CareerInfoRow]
    /// The session the stage-level actions (record, reschedule, cancel) apply to.
    public let currentSession: JSONValue?
    /// The newest elapsed session, used for "查看复盘" and linked recordings.
    public let latestRecorded: JSONValue?
}

public enum CareerFormat {
    static func two(_ value: Int) -> String { value < 10 ? "0\(value)" : "\(value)" }
    public static func monthDay(_ raw: String, calendar: Calendar = .current) -> String {
        guard let date = CareerApplication.date(raw) else { return "—" }
        let parts = calendar.dateComponents([.month, .day], from: date)
        return two(parts.month ?? 0) + "." + two(parts.day ?? 0)
    }
    public static func clock(_ raw: String, calendar: Calendar = .current) -> String {
        guard let date = CareerApplication.date(raw) else { return "—" }
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return two(parts.hour ?? 0) + ":" + two(parts.minute ?? 0)
    }
    public static func range(_ start: String, _ end: String, calendar: Calendar = .current) -> String {
        guard let s = CareerApplication.date(start), let e = CareerApplication.date(end) else { return "—" }
        return calendar.isDate(s, inSameDayAs: e)
            ? "\(monthDay(start, calendar: calendar)) \(clock(start, calendar: calendar))–\(clock(end, calendar: calendar))"
            : "\(monthDay(start, calendar: calendar)) \(clock(start, calendar: calendar)) – \(monthDay(end, calendar: calendar)) \(clock(end, calendar: calendar))"
    }
    /// Offer dates are calendar dates (`YYYY-MM-DD`); never shift them through UTC.
    public static func offerDate(_ raw: String, calendar: Calendar = .current) -> Date? {
        let parts = raw.split(separator: "-").compactMap { Int($0) }
        guard raw.count == 10, parts.count == 3, parts[0] >= 1000 else { return nil }
        var components = DateComponents(); components.year = parts[0]; components.month = parts[1]; components.day = parts[2]
        guard let date = calendar.date(from: components) else { return nil }
        let check = calendar.dateComponents([.year, .month, .day], from: date)
        return check.year == parts[0] && check.month == parts[1] && check.day == parts[2] ? date : nil
    }
    public static func offerDay(_ raw: String, calendar: Calendar = .current) -> String? {
        guard let date = offerDate(raw, calendar: calendar) else { return nil }
        let parts = calendar.dateComponents([.month, .day], from: date)
        return two(parts.month ?? 0) + "." + two(parts.day ?? 0)
    }
    public static func offerLong(_ raw: String, calendar: Calendar = .current) -> String? {
        guard let date = offerDate(raw, calendar: calendar) else { return nil }
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return "\(parts.year ?? 0)年\(parts.month ?? 0)月\(parts.day ?? 0)日"
    }
    public static func days(from start: Date, to end: Date, calendar: Calendar = .current) -> Int {
        calendar.dateComponents([.day], from: calendar.startOfDay(for: start), to: calendar.startOfDay(for: end)).day ?? 0
    }
}

extension JSONValue {
    /// Text for display: strings as is, numbers without a trailing `.0`.
    public func display(_ field: String) -> String {
        switch self[field] {
        case .string(let value): return value
        case .number(let value): return value == value.rounded() && abs(value) < 1e15 ? String(Int64(value)) : String(value)
        case .bool(let value): return value ? "true" : "false"
        default: return ""
        }
    }
    public var bool: Bool { if case .bool(let value) = self { return value }; return false }
}

public enum CareerSessions {
    /// Time decides completion: an elapsed scheduled session counts as completed.
    public static func effectiveStatus(_ session: JSONValue, now: Date = Date()) -> String {
        let status = session.text("status")
        if status == "scheduled", let end = CareerApplication.date(session.text("end_at")), end <= now { return "completed" }
        return status
    }
    public static func withEffectiveStatus(_ session: JSONValue, now: Date) -> JSONValue {
        guard case .object(var fields) = session else { return session }
        fields["status"] = .string(effectiveStatus(session, now: now))
        return .object(fields)
    }
    public static func modeLabel(_ session: JSONValue) -> String {
        ["video": "视频面试", "onsite": "现场", "phone": "电话"][session.text("mode")] ?? "其他方式"
    }
    /// Stage-detail wording: the meeting provider and onsite location are part of the mode.
    public static func modeText(_ session: JSONValue) -> String {
        switch session.text("mode") {
        case "video": return session.text("meeting_url").contains("feishu") ? "飞书视频" : "视频面试"
        case "onsite": return session.text("location").isEmpty ? "现场" : "现场 · " + session.text("location")
        case "phone": return "电话"
        default: return "其他方式"
        }
    }
    static func interviewer(_ session: JSONValue, withRole: Bool) -> String? {
        let name = session.text("interviewer_name")
        guard !name.isEmpty else { return nil }
        if withRole { return "面试官 " + name }
        let title = session.text("interviewer_title")
        return title.isEmpty ? name : "\(name)（\(title)）"
    }
    public static func line(_ session: JSONValue, withRole: Bool = false, calendar: Calendar = .current) -> String {
        if session.text("schedule_kind") == "open_window" {
            let planStart = session.text("answer_plan_start_at"), planEnd = session.text("answer_plan_end_at")
            let plan = !planStart.isEmpty && !planEnd.isEmpty ? " · 我的作答计划 " + CareerFormat.range(planStart, planEnd, calendar: calendar) : ""
            return "开放窗口 " + CareerFormat.range(session.text("start_at"), session.text("end_at"), calendar: calendar) + plan
        }
        return [CareerFormat.range(session.text("start_at"), session.text("end_at"), calendar: calendar), modeLabel(session), interviewer(session, withRole: withRole)]
            .compactMap { $0 }.joined(separator: " · ")
    }
    public static func questionCount(_ markdown: String) -> Int {
        markdown.components(separatedBy: "\n").filter { CareerTranscript.questionText($0) != nil }.count
    }
    /// Mirrors `applicationStageMatchesSession` for the application's current stage.
    public static func matchesCurrentStage(_ application: JSONValue, _ session: JSONValue) -> Bool {
        let stageID = application["current_stage"]?.text("id") ?? ""
        let sessionStage = session.text("application_stage_id")
        if !stageID.isEmpty && !sessionStage.isEmpty { return stageID == sessionStage }
        let type = application.text("current_stage_type")
        let label = application.text("current_stage_label").trimmingCharacters(in: .whitespaces)
        if type == "screening" && session.text("stage_type") == "other" { return label == session.text("stage_label").trimmingCharacters(in: .whitespaces) }
        guard type == session.text("stage_type") else { return false }
        if type == "interview" { return application["current_round_no"]?.integer == session["round_no"]?.integer }
        return label == session.text("stage_label").trimmingCharacters(in: .whitespaces)
    }
}

extension CareerDetailModel {
    private static func stageKind(_ type: String) -> String {
        ["written_test": "笔试", "assessment": "测评", "ai_interview": "AI 面试", "hr": "HR 面"][type] ?? "面试"
    }
    private static func salary(_ app: JSONValue) -> String? {
        let amount = app.display("offer_salary")
        guard !amount.isEmpty else { return nil }
        return amount + (["year": " / 年", "month": " / 月"][app.text("offer_salary_period")] ?? "")
    }
    private static func source(_ app: JSONValue) -> String? {
        let channel = app.text("applied_channel").trimmingCharacters(in: .whitespacesAndNewlines)
        if !channel.isEmpty { return channel }
        let snapshot = app["job_snapshot"] ?? .null
        let value = snapshot.text("source_platform").isEmpty ? snapshot.text("source_channel") : snapshot.text("source_platform")
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
    private static func nonEmpty(_ value: String) -> String? { value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : value.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// Product-facing projection of the application's state machine (`projectApplicationProgress`).
    public static func column(_ app: JSONValue) -> String {
        let active = app.text("lifecycle_status") != "terminated" && app.text("status") == "active" && app.text("archived_at").isEmpty
        if app.text("archived_at").isEmpty && app.text("status") == "closed" && app.text("offer_status") == "accepted" { return "offer" }
        if !active { return "ended" }
        let current = app["current_stage"]?.text("stage_type") ?? ""
        let hasCurrent = !(app["current_stage"]?.text("id") ?? "").isEmpty
        let phase = app.text("phase").isEmpty
            ? (!app.text("applied_at").isEmpty || hasCurrent || app.text("current_stage_type") != "screening" ? "applied" : "pending")
            : app.text("phase")
        if phase == "pending" { return "pending" }
        var stable = current
        if stable.isEmpty {
            stable = app.text("current_stage_type")
            if stable == "hr" { stable = "interview" }
            if stable == "screening" {
                let label = app.text("current_stage_label").lowercased()
                if label.contains("笔试") { stable = "written_test" } else if label.contains("测评") || label.contains("assessment") { stable = "assessment" }
            }
        }
        if ["offer", "oc"].contains(stable) { return "offer" }
        return ["screening", "assessment", "written_test"].contains(stable) ? stable : "interview"
    }

    public init(application app: JSONValue, sessions all: [JSONValue], now: Date = Date(), calendar: Calendar = .current) {
        func md(_ raw: String) -> String { CareerFormat.monthDay(raw, calendar: calendar) }
        func days(_ raw: String) -> Int { CareerApplication.date(raw).map { max(0, CareerFormat.days(from: $0, to: now, calendar: calendar)) } ?? 0 }
        let columnKey = Self.column(app)
        let appID = app.text("id")
        let sessions = all.filter { $0.text("application_id") == appID }
            .map { CareerSessions.withEffectiveStatus($0, now: now) }
            .sorted { (CareerApplication.date($0.text("start_at")) ?? .distantPast) > (CareerApplication.date($1.text("start_at")) ?? .distantPast) }
        let recorded = (app["stages"]?.items ?? []).sorted { ($0["sequence_no"]?.integer ?? 0) < ($1["sequence_no"]?.integer ?? 0) }
        let pending = columnKey == "pending"
        var stages = recorded
        if stages.isEmpty && !pending {
            // Records created before stage history existed only carry the flat current stage fields.
            let ended = columnKey == "ended"
            let type = app.text("current_stage_type") == "offer" ? "offer" : ["assessment", "written_test"].contains(columnKey) ? columnKey : app.text("current_stage_type") == "screening" ? "screening" : "interview"
            stages = [.object([
                "id": .string("legacy-" + appID), "stage_type": .string(type),
                "stage_label": .string(app.text("current_stage_label").trimmingCharacters(in: .whitespaces).isEmpty ? CareerStage.label(columnKey) : app.text("current_stage_label")),
                "stage_status": .string(ended ? "completed" : "active"), "stage_result": .string(app.text("status") == "rejected" ? "rejected" : "pending"),
                "current_marker": ended ? .null : .number(1), "entered_at": .string(app.text("applied_at").isEmpty ? app.text("updated_at") : app.text("applied_at")),
                "completed_at": ended ? .string(app.text("updated_at")) : .null,
            ])]
        }
        let currentFromApp = app["current_stage"].flatMap { $0.text("id").isEmpty ? nil : $0 }
        let current = currentFromApp ?? stages.first { $0["current_marker"]?.integer == 1 }
        let currentID = current?.text("id") ?? ""
        let currentSession = sessions.first { $0.text("status") != "cancelled" && CareerSessions.matchesCurrentStage(app, $0) }
        let ended = columnKey == "ended"
        let offer = !ended && app.text("current_stage_type") == "offer"
        let offerStatus = app.text("offer_status")
        let offerReceived = offer && offerStatus == "received"
        let hasOc = stages.contains { $0.text("stage_type") == "oc" }
        let verbalOffer = offer && offerStatus == "none" && (current?.text("stage_type") == "oc" || !hasOc)
        func isLegacyOc(_ stage: JSONValue) -> Bool { stage.text("stage_type") == "offer" && offerStatus == "none" && !hasOc && stage.text("id") == currentID }
        let rejected = app.text("status") == "rejected" || app.text("termination_reason") == "company_rejected"
        let accepted = offerStatus == "accepted"
        let resumeTitle = Self.nonEmpty(app.text("resume_title_snapshot"))
        let source = Self.source(app)
        let scheduledSession = currentSession?.text("status") == "scheduled" ? currentSession : nil
        let elapsedSession = currentSession?.text("status") == "completed" ? currentSession : nil
        let stageState = app.text("stage_state") == "scheduled" && scheduledSession == nil && elapsedSession != nil ? "awaiting_result" : app.text("stage_state")
        func sessionFor(_ stage: JSONValue) -> JSONValue? {
            sessions.first { $0.text("status") != "cancelled" && (!$0.text("application_stage_id").isEmpty
                ? $0.text("application_stage_id") == stage.text("id")
                : $0.text("stage_label").trimmingCharacters(in: .whitespaces) == stage.text("stage_label").trimmingCharacters(in: .whitespaces)) }
        }
        func stageLabel(_ stage: JSONValue) -> String {
            let type = stage.text("stage_type")
            if type == "oc" || isLegacyOc(stage) { return stage.text("id") == currentID ? "OC · 口头意向" : "OC" }
            if type == "offer" { return "Offer" }
            if type == "screening" { return "筛选中" }
            return stage.text("stage_label")
        }
        let lastID = stages.last?.text("id")

        // Stepper
        var steps: [CareerDetailStep] = []
        if pending {
            steps.append(.init(id: "pending", label: "待投递", meta: md(app.text("created_at")) + " 导入", state: .current))
            for (key, label, meta) in [("screening", "筛选中", ""), ("test", "笔试 / 测评", ""), ("interview", "面试", "可多轮"), ("offer", "Offer", "")] {
                steps.append(.init(id: key, label: label, meta: meta, state: .todo))
            }
        } else {
            steps.append(.init(id: "applied", label: "已投递", meta: md(app.text("applied_at").isEmpty ? app.text("created_at") : app.text("applied_at")), state: .done))
            for stage in stages {
                let id = stage.text("id"), type = stage.text("stage_type")
                let isCurrent = !ended && id == currentID
                let session = sessionFor(stage)
                if type == "oc" {
                    steps.append(.init(id: id, label: stageLabel(stage), meta: md(app.text("oc_communicated_at").isEmpty ? stage.text("entered_at") : app.text("oc_communicated_at")), state: isCurrent ? .current : .done))
                    continue
                }
                if type == "offer" {
                    let received = offerStatus != "none"
                    let receivedDay = CareerFormat.offerDay(app.text("offer_received_on"), calendar: calendar) ?? md(stage.text("entered_at"))
                    steps.append(.init(id: id, label: stageLabel(stage), meta: received ? receivedDay + " · 已收到" : md(stage.text("entered_at")), state: received ? .offer : isCurrent ? .current : .done))
                    continue
                }
                let completedOrEntered = stage.text("completed_at").isEmpty ? stage.text("entered_at") : stage.text("completed_at")
                if stage.text("stage_result") == "rejected" || (ended && id == lastID && rejected) {
                    steps.append(.init(id: id, label: stageLabel(stage), meta: md(completedOrEntered) + " · 未通过", state: .failed))
                    continue
                }
                if isCurrent {
                    let meta: String
                    if stageState == "awaiting_result", let session, session.text("status") == "completed" {
                        meta = md(session.text("start_at")) + (["interview", "hr"].contains(type) ? " · 已面完" : " · 已考完")
                    } else if let session, session.text("schedule_kind") == "open_window" {
                        meta = md(session.text("start_at")) + "–" + md(session.text("end_at"))
                    } else if let session { meta = md(session.text("start_at")) }
                    else { meta = md(stage.text("entered_at")) + " 起" }
                    steps.append(.init(id: id, label: stageLabel(stage), meta: meta, state: .current))
                    continue
                }
                let passed = stage.text("stage_result") == "passed" && stages.count < 5
                let when = !stage.text("completed_at").isEmpty ? stage.text("completed_at") : session?.text("start_at") ?? stage.text("entered_at")
                steps.append(.init(id: id, label: type == "screening" ? "筛选" : stageLabel(stage), meta: passed ? md(when) + " · 已通过" : md(when), state: .done))
            }
            if !ended && !offer {
                steps.append(.init(id: "next", label: "下一阶段", meta: current?.text("stage_type") == "screening" ? "由结果决定" : "", state: .next))
            }
        }

        // Next action
        let label = current?.text("stage_label") ?? CareerStage.label(columnKey)
        let kind = current.map { Self.stageKind($0.text("stage_type")) } ?? "面试"
        let next: CareerDetailNext
        if pending {
            next = .init(lead: "下一步", tile: .status(title: "待投递", sub: "\(days(app.text("created_at"))) 天", tone: .gray), chips: [.init("待投递", .gray)],
                         title: "投递后，记录这次求职从哪一步开始", detail: "可直接进入筛选中，也可以跳到笔试、面试或 Offer", hint: nil,
                         primary: .init(action: .recordApplied, label: "记录投递"), secondary: [])
        } else if ended {
            let lastLabel = stages.last.map(stageLabel) ?? CareerStage.label(columnKey)
            let reviewed = sessions.filter { !$0.text("review_summary").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count
            let status: (sub: String, tone: CareerTone, title: String, chip: String) = rejected
                ? ("未通过", .red, "流程已结束：\(lastLabel)未通过", "结束阶段：\(lastLabel)")
                : accepted ? ("已接受", .green, "流程已结束：已接受 Offer", "已接受 Offer")
                : offerStatus == "declined" ? ("已婉拒", .gray, "流程已结束：已婉拒 Offer", "已婉拒 Offer")
                : ("已放弃", .gray, "流程已结束：主动放弃", "结束阶段：\(lastLabel)")
            let detail = [app.text("terminated_at").isEmpty ? nil : md(app.text("terminated_at")) + " " + (rejected ? "收到拒信" : "结束"),
                          "共经历 \(stages.count) 个阶段", reviewed > 0 ? "\(reviewed) 场面试有复盘" : nil].compactMap { $0 }.joined(separator: " · ")
            next = .init(lead: "当前", tile: .status(title: "已结束", sub: status.sub, tone: status.tone), chips: [.init("已结束", .gray), .init(status.chip, status.tone)],
                         title: status.title, detail: detail, hint: nil, primary: .init(action: .viewReview, label: "查看复盘", dark: false), secondary: [])
        } else if offerReceived {
            var deadlineChip = CareerChip("待你决定", .orange)
            if let due = CareerFormat.offerDate(app.text("offer_reply_due_on"), calendar: calendar) {
                let left = CareerFormat.days(from: now, to: due, calendar: calendar)
                deadlineChip = .init(left == 0 ? "今天截止" : left > 0 ? "还有 \(left) 天回复" : "回复截止已过 \(-left) 天", left < 0 ? .red : .orange)
            }
            let detail = [Self.nonEmpty(app.text("offer_base_location")), Self.salary(app), Self.nonEmpty(app.text("offer_benefits_description")),
                          CareerFormat.offerDay(app.text("offer_reply_due_on"), calendar: calendar).map { "回复截止 " + $0 }].compactMap { $0 }.joined(separator: " · ")
            next = .init(lead: "下一步", tile: .status(title: "Offer", sub: "已收到", tone: .green), chips: [.init("Offer", .dark), .init("已收到", .green), deadlineChip],
                         title: "已收到正式 Offer，待你决定", detail: detail.isEmpty ? "Offer 详情待补充" : detail, hint: nil,
                         primary: .init(action: .acceptOffer, label: "接受 Offer"),
                         secondary: [.init(action: .editOffer, label: "修改 Offer 信息"), .init(action: .declineOffer, label: "婉拒", danger: true)])
        } else if offer && !verbalOffer {
            next = .init(lead: "下一步", tile: .status(title: "Offer", sub: "待补充", tone: .green), chips: [.init("Offer", .dark), .init("信息待补充", .orange)],
                         title: "补充正式 Offer 信息", detail: "记录收到日期、回复截止和薪酬，方便按时回复", hint: nil,
                         primary: .init(action: .editOffer, label: "记录正式 Offer"), secondary: [])
        } else if offer {
            let detail = [current.map { md(app.text("oc_communicated_at").isEmpty ? $0.text("entered_at") : app.text("oc_communicated_at")) + " 收到口头意向" },
                          Self.nonEmpty(app.text("oc_salary_text")).map { "口头薪酬 " + $0 }, Self.nonEmpty(app.text("oc_start_text")).map { "预计到岗 " + $0 },
                          current?.text("stage_type") == "oc" ? nil : Self.nonEmpty(app.text("notes"))].compactMap { $0 }.joined(separator: " · ")
            next = .init(lead: "下一步", tile: .status(title: "OC", sub: "口头意向", tone: .blue), chips: [.init("Offer 阶段", .dark), .init("口头意向", .blue), .init("正式 Offer 未到", .orange)],
                         title: "已收到口头意向，等待正式 Offer", detail: detail, hint: nil, primary: .init(action: .recordOffer, label: "记录正式 Offer"), secondary: [])
        } else if current?.text("stage_type") == "screening" || (current == nil && app.text("current_stage_type") == "screening") {
            let start = current?.text("entered_at") ?? (app.text("applied_at").isEmpty ? app.text("created_at") : app.text("applied_at"))
            let detail = [source.map { "\(md(app.text("applied_at"))) 通过\($0)投递" } ?? "\(md(app.text("applied_at"))) 投递", resumeTitle].compactMap { $0 }.joined(separator: " · ")
            next = .init(lead: "下一步", tile: .status(title: "筛选中", sub: "第 \(days(start) + 1) 天", tone: .blue), chips: [.init("筛选中", .blue), .init("等待结果", .orange)],
                         title: "等待简历筛选结果", detail: detail, hint: nil, primary: .init(action: .advance, label: "进入下一阶段"), secondary: [])
        } else if stageState == "awaiting_schedule" {
            next = .init(lead: "下一步", tile: .status(title: "待安排", sub: "", tone: .orange), chips: [.init(label, .blue), .init("等待安排", .orange)],
                         title: "安排\(label)时间", detail: "已收到\(label)通知，还没填时间", hint: nil, primary: .init(action: .schedule, label: "安排\(label)时间"), secondary: [])
        } else if let session = scheduledSession {
            let openWindow = session.text("schedule_kind") == "open_window"
            let anchorRaw = openWindow ? session.text("end_at") : session.text("start_at")
            let anchor = CareerApplication.date(anchorRaw) ?? now
            let parts = calendar.dateComponents([.month, .day, .weekday], from: anchor)
            let weekday = Array("日一二三四五六")[((parts.weekday ?? 1) - 1) % 7]
            let left = CareerFormat.days(from: now, to: anchor, calendar: calendar)
            var chips: [CareerChip] = [.init(label, .blue), .init("已安排", .blue), openWindow ? .init("截止前完成", .gray) : left >= 1 ? .init("还有 \(left) 天", .orange) : .init("今天", .orange)]
            let total = session["prep_total"]?.integer ?? 0
            if total > 0 { chips.append(.init("准备清单 \(session["prep_done"]?.integer ?? 0)/\(total)", .gray)) }
            let end = session.text("end_at")
            next = .init(lead: "下一步", tile: .date(head: openWindow ? "\(parts.month ?? 0)月 · 截止" : "\(parts.month ?? 0)月 · 周\(weekday)", day: "\(parts.day ?? 0)", foot: CareerFormat.clock(anchorRaw, calendar: calendar)),
                         chips: chips, title: openWindow ? "\(md(end)) \(CareerFormat.clock(end, calendar: calendar)) 前完成\(label)" : label,
                         detail: CareerSessions.line(session, withRole: true, calendar: calendar),
                         hint: openWindow ? "截止时间过后自动进入「等待结果」，无需手动标记完成" : "\(kind)结束（\(CareerFormat.clock(end, calendar: calendar))）后自动进入「等待结果」，无需手动标记完成",
                         primary: openWindow ? .init(action: .answerPlan, label: "作答计划") : .init(action: .recordReview, label: "记录与复盘"),
                         secondary: [.init(action: .reschedule, label: "修改安排"), .init(action: .cancelSession, label: "取消本场")])
        } else {
            let waited = elapsedSession.map { days($0.text("end_at")) } ?? 0
            let asked = elapsedSession.map { CareerSessions.questionCount($0.text("questions_markdown")) } ?? 0
            let detail = elapsedSession.map { session in
                [CareerFormat.range(session.text("start_at"), session.text("end_at"), calendar: calendar), CareerSessions.modeLabel(session), asked > 0 ? "已记录 \(asked) 个问题" : nil].compactMap { $0 }.joined(separator: " · ")
            } ?? "有新进展时在这里添加下一阶段"
            next = .init(lead: "下一步", tile: .status(title: "等结果", sub: waited > 0 ? "已 \(waited) 天" : "今天结束", tone: .orange), chips: [.init(label, .blue), .init("等待结果", .orange)],
                         title: "\(label)已结束，等待\(kind)结果", detail: detail, hint: nil, primary: .init(action: .advance, label: "通过，添加下一轮"), secondary: [])
        }

        // Stage history (newest first)
        var history: [CareerHistoryItem] = stages.reversed().map { stage in
            let id = stage.text("id"), type = stage.text("stage_type")
            let session = sessionFor(stage)
            let isCurrent = !ended && id == currentID
            let isFailed = stage.text("stage_result") == "rejected" || (ended && rejected && id == lastID)
            var chip = CareerChip("已通过", .green)
            var dot: CareerTone? = .green
            if isFailed { chip = .init("未通过", .red); dot = .red }
            else if type == "oc" { chip = isCurrent ? .init("待正式 Offer", .blue) : .init("已转正式", .green); dot = isCurrent ? .blue : .green }
            else if type == "offer" {
                chip = offerStatus == "none" ? .init("待正式 Offer", .blue) : offerStatus == "accepted" ? .init("已接受", .green) : offerStatus == "declined" ? .init("已婉拒", .gray) : .init("已收到", .green)
                dot = isCurrent && offerStatus == "none" ? .blue : .green
            } else if isCurrent {
                chip = type == "screening" || stageState == "awaiting_result" ? .init("等待结果", type == "screening" ? .blue : .orange)
                    : stageState == "awaiting_schedule" ? .init("等待安排", .orange) : .init("已安排", .blue)
                dot = chip.tone == .orange ? .orange : .blue
            } else if stage.text("stage_result") == "skipped" { chip = .init("已跳过", .gray); dot = nil }
            let detail: String
            if let session {
                let status = session.text("status")
                if session.text("schedule_kind") == "open_window" && status == "completed" { detail = "截止前完成 · " + CareerFormat.range(session.text("start_at"), session.text("end_at"), calendar: calendar) }
                else if status == "completed" && !["interview", "hr"].contains(type) { detail = CareerFormat.range(session.text("start_at"), session.text("end_at"), calendar: calendar) + " 完成" }
                else if status == "completed" { detail = CareerSessions.line(session, calendar: calendar) + " · " + CareerReview.statusText(session) }
                else { detail = CareerSessions.line(session, calendar: calendar) }
            } else if type == "oc" {
                detail = [Self.nonEmpty(app.text("oc_salary_text")).map { "口头薪酬 " + $0 }, Self.nonEmpty(app.text("oc_contact"))].compactMap { $0 }.joined(separator: " · ").nonEmpty("已收到口头意向")
            } else if type == "screening" {
                detail = isCurrent ? "招聘方暂未回复。筛选阶段不需要安排时间。" : "已通过简历筛选"
            } else if type == "offer" {
                detail = offerStatus == "none"
                    ? (hasOc ? "正式 Offer 信息待补充" : Self.nonEmpty(app.text("notes")) ?? "已收到口头意向，等待正式 Offer")
                    : [Self.nonEmpty(app.text("offer_base_location")), Self.salary(app)].compactMap { $0 }.joined(separator: " · ").nonEmpty("已收到正式 Offer")
            } else if isCurrent && stageState == "awaiting_schedule" { detail = "\(Self.stageKind(type))链接与时间待招聘方确认。" }
            else { detail = "暂无安排记录" }
            let when = type == "oc" && !app.text("oc_communicated_at").isEmpty ? app.text("oc_communicated_at")
                : isCurrent ? (session?.text("start_at") ?? stage.text("entered_at"))
                : !stage.text("completed_at").isEmpty ? stage.text("completed_at") : session?.text("start_at") ?? stage.text("entered_at")
            let title = type == "screening" ? "简历筛选" : type == "oc" || isLegacyOc(stage) ? "OC · 口头意向" : type == "offer" ? "正式 Offer" : stage.text("stage_label")
            return CareerHistoryItem(id: id, date: md(when), title: title, chip: chip, detail: detail, dot: dot,
                                     highlight: isCurrent ? .blue : isFailed ? .red : nil, sessionID: session.map { $0.text("id") })
        }
        if !app.text("applied_at").isEmpty {
            history.append(.init(id: "applied", date: md(app.text("applied_at")), title: "提交投递", chip: .init("已投递", .gray),
                                 detail: [source, resumeTitle].compactMap { $0 }.joined(separator: " · ").nonEmpty("已记录投递"), dot: nil, highlight: nil, sessionID: nil))
        }

        // Side cards
        var offerCard: CareerOfferCard?
        if offerReceived || (ended && offerStatus != "none") {
            var rows: [CareerInfoRow] = [.init(label: "工作地点", value: Self.nonEmpty(app.text("offer_base_location")) ?? "—"),
                                         .init(label: "薪资", value: Self.salary(app) ?? "—"),
                                         .init(label: "福利", value: Self.nonEmpty(app.text("offer_benefits_description")) ?? "—")]
            for (title, value) in [("收到日期", CareerFormat.offerLong(app.text("offer_received_on"), calendar: calendar)), ("回复截止", CareerFormat.offerLong(app.text("offer_reply_due_on"), calendar: calendar)),
                                   ("预计入职", CareerFormat.offerLong(app.text("offer_start_on"), calendar: calendar)), ("试用期", Self.nonEmpty(app.text("offer_probation")))] {
                if let value { rows.append(.init(label: title, value: value)) }
            }
            rows.append(.init(label: "状态", value: offerStatus == "accepted" ? "已接受" : offerStatus == "declined" ? "已婉拒" : "已收到 · 待决定", tone: offerStatus == "declined" ? .gray : .green))
            offerCard = .init(title: "Offer 信息", action: "编辑", rows: rows)
        } else if verbalOffer {
            var rows: [CareerInfoRow] = [.init(label: "沟通时间", value: current.map { md(app.text("oc_communicated_at").isEmpty ? $0.text("entered_at") : app.text("oc_communicated_at")) } ?? "—")]
            if let value = Self.nonEmpty(app.text("oc_contact")) { rows.append(.init(label: "沟通方式", value: value)) }
            if let value = Self.nonEmpty(app.text("oc_salary_text")) { rows.append(.init(label: "口头薪酬", value: value)) }
            if let value = Self.nonEmpty(app.text("oc_start_text")) { rows.append(.init(label: "预计到岗", value: value)) }
            rows.append(.init(label: "Offer 状态", value: "未收到书面", tone: .orange))
            offerCard = .init(title: "口头意向", action: "记录 Offer", rows: rows)
        }
        let deliveryRows: [CareerInfoRow] = [.init(label: "投递日期", value: app.text("applied_at").isEmpty ? "未投递" : md(app.text("applied_at"))),
                                             .init(label: "投递渠道", value: source ?? "—"), .init(label: "投递简历", value: resumeTitle ?? "未关联")]
        self.ended = ended
        self.pending = pending
        self.verbalOffer = verbalOffer
        self.headerMeta = ended ? "已结束" : pending ? "导入 \(days(app.text("created_at"))) 天" : "已投递 \(days(app.text("applied_at").isEmpty ? app.text("created_at") : app.text("applied_at"))) 天"
        self.currentLabel = current?.text("stage_label").nonEmpty(CareerStage.label(columnKey)) ?? CareerStage.label(columnKey)
        self.steps = steps
        self.next = next
        self.history = history
        self.offerCard = offerCard
        self.deliveryRows = deliveryRows
        self.currentSession = currentSession
        self.latestRecorded = sessions.first { $0.text("status") == "completed" }
    }
}

extension String {
    func nonEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}
