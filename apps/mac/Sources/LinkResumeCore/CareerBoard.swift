import Foundation

/// Board and list copy for one application. Ports Web `applicationProgress.ts`
/// and the card helpers in `ApplicationsBoard.tsx`, so both clients show the same labels.
public struct CareerBoardProjection: Sendable {
    public let column: String
    public let stageLabel: String
    public let statusLabel: String
    public let supportingLabel: String?
    public let isWaiting: Bool
}

public enum CareerBoard {
    static let scheduled: Set<String> = ["assessment", "written_test", "interview"]

    /// `normalizeApplicationStageLabel`.
    public static func stageLabel(_ raw: JSONValue) -> String {
        if let current = raw["current_stage"], current != .null { return current.text("stage_label") }
        let label = raw.text("current_stage_label").trimmingCharacters(in: .whitespaces)
        let type = raw.text("current_stage_type")
        if type == "offer" { return "Offer" }
        if type != "screening" { return label.isEmpty ? "当前阶段" : label }
        if label == "测评中" { return "测评" }
        if label == "笔试中" { return "笔试" }
        if label.contains("笔试") || label.contains("测评") || label.lowercased().contains("assessment") { return label.isEmpty ? "当前阶段" : label }
        return label == "待投递" ? "待投递" : "筛选中"
    }

    static func stableType(_ raw: JSONValue) -> String {
        if let current = raw["current_stage"], current != .null, !current.text("stage_type").isEmpty { return current.text("stage_type") }
        let type = raw.text("current_stage_type")
        if type == "hr" { return "interview" }
        guard type == "screening" else { return type }
        let label = raw.text("current_stage_label").lowercased()
        if label.contains("笔试") { return "written_test" }
        if label.contains("测评") || label.contains("assessment") { return "assessment" }
        return "screening"
    }

    static func active(_ raw: JSONValue) -> Bool {
        raw.text("lifecycle_status") != "terminated" && raw.text("status") == "active" && raw.text("archived_at").isEmpty
    }

    static func terminalLabel(_ raw: JSONValue) -> String? {
        if !raw.text("archived_at").isEmpty { return "已归档" }
        if raw.text("lifecycle_status") == "terminated" {
            switch raw.text("termination_reason") {
            case "company_rejected": return "未通过"
            case "user_withdrew", "offer_declined": return "已主动结束"
            default: return "已终止"
            }
        }
        switch raw.text("status") {
        case "rejected": return "未通过"
        case "withdrawn": return "已主动结束"
        case "closed": return raw.text("offer_status") == "declined" ? "已主动结束" : "已结束"
        default: return nil
        }
    }

    /// `projectApplicationProgress`.
    public static func projection(_ raw: JSONValue) -> CareerBoardProjection {
        let label = stageLabel(raw)
        let stable = stableType(raw)
        let isActive = active(raw)
        let hasStage = raw["current_stage"].map { $0 != .null } ?? false
        let phase = raw.text("phase").isEmpty
            ? (!raw.text("applied_at").isEmpty || hasStage || raw.text("current_stage_type") != "screening" ? "applied" : "pending")
            : raw.text("phase")
        if raw.text("archived_at").isEmpty && raw.text("status") == "closed" && raw.text("offer_status") == "accepted" {
            return CareerBoardProjection(column: "offer", stageLabel: label, statusLabel: "已收到 Offer", supportingLabel: nil, isWaiting: false)
        }
        if let terminal = terminalLabel(raw) {
            return CareerBoardProjection(column: "ended", stageLabel: label, statusLabel: terminal, supportingLabel: nil, isWaiting: false)
        }
        if isActive && phase == "pending" {
            return CareerBoardProjection(column: "pending", stageLabel: "待投递", statusLabel: "待投递", supportingLabel: "等待确认投递", isWaiting: false)
        }
        if isActive && (stable == "offer" || stable == "oc") {
            let status = stable == "oc" ? "口头意向" : raw.text("offer_status") == "none" ? "Offer 状态待确认" : raw.text("offer_status") == "declined" ? "已主动结束" : "已收到 Offer"
            return CareerBoardProjection(column: "offer", stageLabel: label, statusLabel: status, supportingLabel: nil, isWaiting: false)
        }
        let column = ["screening", "assessment", "written_test"].contains(stable) ? stable : "interview"
        let state = raw.text("stage_state")
        let status = state == "awaiting_schedule" ? "等待安排" : state == "awaiting_result" ? "等待结果" : "进行中"
        let waiting = isActive && state == "awaiting_result" && ["interview", "hr", "ai_interview"].contains(stable)
        return CareerBoardProjection(column: column, stageLabel: label, statusLabel: status, supportingLabel: nil, isWaiting: waiting)
    }

    /// `applicationScheduleStatusLabel`: countdown copy for a scheduled stage.
    public static func scheduleLabel(_ raw: JSONValue, completed: Bool, now: Date = Date()) -> String? {
        guard scheduled.contains(projection(raw).column) else { return nil }
        if completed { return "已完成" }
        guard let start = CareerApplication.date(raw.text("next_session_start_at")),
              let end = CareerApplication.date(raw.text("next_session_end_at")), end > start else { return nil }
        if now >= end { return "等待结果" }
        if now >= start { return "正在进行" }
        let until = start.timeIntervalSince(now)
        if until <= 24 * 3600 { return "\(max(1, Int((until / 3600).rounded(.up)))) 小时后" }
        return "\(Int((until / 86400).rounded(.up))) 天后"
    }

    /// `applicationCardStatusLabel`.
    public static func cardStatus(_ raw: JSONValue, completed: Bool, now: Date = Date()) -> String {
        let value = projection(raw)
        if value.column == "ended" { return "结束阶段：" + value.stageLabel }
        return scheduleLabel(raw, completed: completed, now: now) ?? value.supportingLabel ?? value.statusLabel
    }

    /// `applicationProgressLabel`: the list view's progress cell.
    public static func progressLabel(_ raw: JSONValue, completed: Bool, now: Date = Date()) -> String {
        let value = projection(raw)
        if value.column == "offer" || raw.text("current_stage_type") == "offer" { return value.statusLabel }
        if let supporting = value.supportingLabel { return value.stageLabel + " · " + supporting }
        if value.column != "ended", let schedule = scheduleLabel(raw, completed: completed, now: now) { return value.stageLabel + " · " + schedule }
        return value.stageLabel + " · " + value.statusLabel
    }

    /// `applicationProgressToneClass`, folded onto the shared tones: blue scheduled/active, orange waiting,
    /// green offer/success, red rejected, gray muted.
    public static func tone(_ raw: JSONValue, completed: Bool, now: Date = Date()) -> CareerTone {
        let value = projection(raw)
        if raw.text("status") == "closed" && raw.text("offer_status") == "accepted" { return .green }
        if value.column == "ended" { return raw.text("status") == "rejected" ? .red : .gray }
        if value.column == "offer" { return .green }
        if completed && scheduled.contains(value.column) { return .green }
        if let schedule = scheduleLabel(raw, completed: completed, now: now) { return schedule == "等待结果" ? .orange : .blue }
        if raw.text("stage_state") == "negotiating" { return .green }
        return value.isWaiting ? .orange : .blue
    }

    /// `applicationCardTimeLabel`: hover text under the card status.
    public static func cardTime(_ raw: JSONValue, calendar: Calendar = .current) -> String {
        let value = projection(raw)
        func stamp(_ field: String) -> String? { CareerApplication.date(raw.text(field)).map { dateTime($0, calendar: calendar) } }
        switch value.column {
        case "pending": return stamp("created_at").map { "创建于 " + $0 } ?? "创建时间待确认"
        case "assessment", "written_test": return stamp("next_session_end_at").map { "截止 " + $0 } ?? "尚未安排时间"
        case "interview":
            guard let start = CareerApplication.date(raw.text("next_session_start_at")),
                  let end = CareerApplication.date(raw.text("next_session_end_at")), end > start else { return "尚未安排时间" }
            let tail = calendar.isDate(start, inSameDayAs: end)
                ? CareerFormat.two(calendar.component(.hour, from: end)) + ":" + CareerFormat.two(calendar.component(.minute, from: end))
                : dateTime(end, calendar: calendar)
            return dateTime(start, calendar: calendar) + "–" + tail
        case "offer":
            let current = raw["current_stage"] ?? .null
            guard current.text("stage_type") == "offer", let entered = CareerApplication.date(current.text("entered_at")) else { return "Offer 时间待确认" }
            return dateTime(entered, calendar: calendar) + " 获得 Offer"
        case "ended": return stamp("terminated_at").map { "结束于 " + $0 } ?? "结束时间待确认"
        default: return stamp("applied_at").map { "投递于 " + $0 } ?? "投递时间待确认"
        }
    }

    /// `formatApplicationSessionRange`: the list view's 最近安排 cell.
    public static func sessionRange(_ session: JSONValue, calendar: Calendar = .current) -> String {
        guard let start = CareerApplication.date(session.text("start_at")), let end = CareerApplication.date(session.text("end_at")) else { return "—" }
        let tail = calendar.isDate(start, inSameDayAs: end)
            ? CareerFormat.two(calendar.component(.hour, from: end)) + ":" + CareerFormat.two(calendar.component(.minute, from: end))
            : dateTime(end, calendar: calendar)
        return dateTime(start, calendar: calendar) + "–" + tail
    }

    /// `todayScheduleLabel`: the black “今天 HH:mm” pill for a stage that starts later today.
    public static func today(_ raw: JSONValue, now: Date = Date(), calendar: Calendar = .current) -> String? {
        guard scheduled.contains(projection(raw).column),
              let start = CareerApplication.date(raw.text("next_session_start_at")), start > now,
              calendar.isDate(start, inSameDayAs: now) else { return nil }
        return "今天 " + CareerFormat.two(calendar.component(.hour, from: start)) + ":" + CareerFormat.two(calendar.component(.minute, from: start))
    }

    /// `formatApplicationUpdatedAt`: 今天 / 昨天 / M月d日.
    public static func relativeDay(_ text: String, now: Date = Date(), calendar: Calendar = .current) -> String? {
        guard let date = CareerApplication.date(text) else { return nil }
        let time = CareerFormat.two(calendar.component(.hour, from: date)) + ":" + CareerFormat.two(calendar.component(.minute, from: date))
        if calendar.isDate(date, inSameDayAs: now) { return "今天 " + time }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) { return "昨天 " + time }
        return "\(calendar.component(.month, from: date))月\(calendar.component(.day, from: date))日"
    }

    static func dateTime(_ date: Date, calendar: Calendar) -> String {
        "\(calendar.component(.month, from: date))月\(calendar.component(.day, from: date))日 "
            + CareerFormat.two(calendar.component(.hour, from: date)) + ":" + CareerFormat.two(calendar.component(.minute, from: date))
    }

    /// The prefill used by the card menu's 推进流程 (`applicationAdvanceAction`): the next step in the flow.
    public static func advanceStage(_ app: CareerApplication) -> (stage: String, label: String)? {
        guard app.movable else { return nil }
        switch projection(app.raw).column {
        case "pending": return nil
        case "screening": return ("assessment", "测评")
        case "assessment": return ("written_test", "笔试")
        case "written_test": return ("interview", "一面")
        default: return ("interview", "")
        }
    }
}
