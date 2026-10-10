import Foundation

/// 首页卡片规则（Web `features/assistant/homeDashboard.ts`，Figma「01.1 首页 · 状态变体」）：
/// 三个卡片位各自按顺序取第一个满足条件的候选；没有简历的账号固定三张引导卡。规则只读数据，不经过 AI。
/// 位置 2 的完整度由 `ResumeCompleteness` 按 Web 同一规则从最近编辑简历的预览正文计算。
public struct HomeDashboard: Sendable {
    public enum Variant: String, Sendable { case new, offer, today, deadline, idle }

    public enum Card: Sendable {
        case firstResume, target, plugin
        case offer(company: String, applicationID: String, replyDueOn: String?)
        case today(session: JSONValue, others: Int)
        case deadline(session: JSONValue, daysLeft: Int)
        case week(sessions: [JSONValue])
        case compare(offers: [JSONValue])
        case resumeTodo(ResumeSummary, score: Int, missing: String)
        case resumeRecent(ResumeSummary, score: Int?)
        case jobs
        case pipeline(applications: [JSONValue], hint: String)
    }

    public let variant: Variant
    public let cards: [Card]
    public let todayCount: Int
    public let offerCompany: String?
    public let deadline: (company: String, daysLeft: Int)?

    static let deadlineDays = 3
    /// Web `RESUME_TODO_THRESHOLD`。
    static let resumeTodoThreshold = 90
    static let day: TimeInterval = 86_400

    public static func build(now: Date, resumes: [ResumeSummary], sessions: [JSONValue], applications: [JSONValue], calendar: Calendar = .current) -> HomeDashboard {
        guard let recent = latestResume(resumes) else {
            return HomeDashboard(variant: .new, cards: [.firstResume, .target, .plugin], todayCount: 0, offerCompany: nil, deadline: nil)
        }
        let todayStart = calendar.startOfDay(for: now)
        let tomorrowStart = todayStart.addingTimeInterval(day)
        let weekStart = startOfWeek(now, calendar: calendar)
        let weekEnd = weekStart.addingTimeInterval(7 * day)
        let scheduled = sessions.filter { $0.text("status") == "scheduled" }
            .sorted { (date($0.text("start_at")) ?? .distantFuture) < (date($1.text("start_at")) ?? .distantFuture) }
        let today = scheduled.filter { guard let start = date($0.text("start_at")) else { return false }; return start >= todayStart && start < tomorrowStart }
        let deadlineSession = scheduled.first { session in
            guard isWrittenTest(session), let end = deadlineOf(session) else { return false }
            return end >= now && end < todayStart.addingTimeInterval(Double(deadlineDays + 1) * day)
        }
        let active = applications.filter(isActive)
        let offers = active.filter { $0.text("offer_status") == "received" }
            .sorted { (offerDate($0.text("offer_reply_due_on")) ?? .distantFuture) < (offerDate($1.text("offer_reply_due_on")) ?? .distantFuture) }

        let first: Card, variant: Variant
        var deadline: (String, Int)?
        if let offer = offers.first {
            first = .offer(company: offer.text("company_name_snapshot"), applicationID: offer.text("id"), replyDueOn: offer["offer_reply_due_on"]?.stringValue)
            variant = .offer
        } else if let session = today.first {
            first = .today(session: session, others: today.count - 1); variant = .today
        } else if let session = deadlineSession, let end = deadlineOf(session) {
            let days = max(0, Int((calendar.startOfDay(for: end).timeIntervalSince(todayStart) / day).rounded()))
            first = .deadline(session: session, daysLeft: days); variant = .deadline
            deadline = (session.text("company_name"), days)
        } else {
            first = .week(sessions: scheduled.filter { guard let start = date($0.text("start_at")) else { return false }; return start >= weekStart && start < weekEnd })
            variant = .idle
        }
        let completeness = recent.preview.flatMap { ResumeCompleteness.evaluate($0.data) }
        let second: Card
        if offers.count >= 2 { second = .compare(offers: Array(offers.prefix(2))) }
        else if let completeness, completeness.score < resumeTodoThreshold, let missing = completeness.missing { second = .resumeTodo(recent, score: completeness.score, missing: missing) }
        else { second = .resumeRecent(recent, score: completeness?.score) }
        let third: Card
        if case .week = first { third = .jobs } else if active.isEmpty { third = .jobs } else { third = .pipeline(applications: active, hint: pipelineHint(active, now: now)) }
        return HomeDashboard(variant: variant, cards: [first, second, third], todayCount: today.count,
                             offerCompany: offers.first?.text("company_name_snapshot"), deadline: deadline)
    }

    /// Web `homeCopy`：没有 AI 问候接口，按位置 1 的主题给固定文案。
    public var copy: (title: String, subtitle: String, chips: [String]) {
        switch variant {
        case .new: ("先准备第一份简历吧。", "也可以直接在下面告诉我你的经历，我来起草。", ["帮我写第一版简历", "简历该写几页", "我适合什么岗位"])
        case .offer: ("\(offerCompany ?? "")的 Offer 还没回复。", "对比一下手上的机会，再决定怎么回复。", ["比较手上的 Offer", "帮我写回复邮件", "谈薪建议"])
        case .today: ("今天想推进什么？", "今天有 \(todayCount) 场面试或笔试。", ["帮我准备今天的面试", "模拟一轮面试", "按 JD 改简历"])
        case .deadline:
            ("今天想推进什么？", deadline.map { $0.daysLeft == 0 ? "\($0.company)的笔试今天截止。" : "\($0.company)的笔试 \($0.daysLeft) 天后截止。" } ?? "",
             ["帮我准备笔试", "按 JD 改简历", "复盘上周面试"])
        case .idle: ("今天没有安排。", "适合补一段项目经历，或者看看新岗位。", ["帮我找合适的岗位", "润色项目经历", "复盘上周面试"])
        }
    }

    /// 岗位看板插图的四列：待投递 / 笔试 / 面试 / Offer。
    public static func pipelineColumns(_ applications: [JSONValue]) -> (pending: Int, test: Int, interview: Int, offer: Int) {
        var counts = (pending: 0, test: 0, interview: 0, offer: 0)
        for application in applications {
            let stage = application["current_stage"]?.text("stage_type") ?? ""
            if application.text("offer_status") != "none" && !application.text("offer_status").isEmpty || application.text("current_stage_type") == "offer" { counts.offer += 1 }
            else if application.text("phase") == "pending" { counts.pending += 1 }
            else if stage == "written_test" || stage == "assessment" { counts.test += 1 }
            else { counts.interview += 1 }
        }
        return counts
    }

    public static func latestResume(_ resumes: [ResumeSummary]) -> ResumeSummary? {
        resumes.max { (date($0.updatedAt) ?? .distantPast) < (date($1.updatedAt) ?? .distantPast) }
    }

    public static func startOfWeek(_ date: Date, calendar: Calendar = .current) -> Date {
        let start = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: start) // 1 = Sunday
        let offset = (weekday + 5) % 7 // Monday = 0
        return calendar.date(byAdding: .day, value: -offset, to: start) ?? start
    }

    public static func date(_ value: String) -> Date? { value.isEmpty ? nil : ResumeSummary.parseTimestamp(value) }

    static func isActive(_ application: JSONValue) -> Bool {
        application.text("status") == "active" && application.text("lifecycle_status") != "terminated" && application.text("archived_at").isEmpty
    }

    static func isWrittenTest(_ session: JSONValue) -> Bool {
        let label = session.text("stage_label")
        return ["笔试", "测评", "测试"].contains { label.contains($0) } || session.text("schedule_kind") == "open_window"
    }

    static func deadlineOf(_ session: JSONValue) -> Date? {
        date(session.text("answer_plan_end_at")) ?? date(session.text("end_at"))
    }

    /// Offer 日期是不带时间的 YYYY-MM-DD，按本地日期解析。
    static func offerDate(_ value: String) -> Date? {
        let parts = value.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    static func pipelineHint(_ active: [JSONValue], now: Date) -> String {
        if let offer = active.first(where: { $0.text("offer_status") == "received" }) { return "\(offer.text("company_name_snapshot")) Offer 待回复" }
        if let waiting = active.first(where: { $0.text("stage_state") == "awaiting_result" }) {
            return "\(waiting.text("company_name_snapshot"))\(waiting.text("current_stage_label"))结果待出"
        }
        let weekAgo = now.addingTimeInterval(-7 * day)
        let fresh = active.filter { (date($0.text("applied_at")) ?? .distantPast) >= weekAgo }.count
        return fresh > 0 ? "本周新增 \(fresh) 个投递" : "按阶段查看每个岗位"
    }
}
