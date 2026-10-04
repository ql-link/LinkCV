import Foundation

public struct ScheduledInterview: Identifiable, Sendable {
    public let raw: JSONValue
    public init(_ raw: JSONValue) { self.raw = raw }
    public var id: String { raw.text("id") }
    public var applicationID: String { raw.text("application_id") }
    public var company: String { raw.text("company_name") }
    public var title: String { raw.text("job_title") }
    public var label: String { raw.text("stage_label") }
    public var start: Date { CareerApplication.date(raw.text("start_at")) ?? .distantPast }
    public var end: Date { CareerApplication.date(raw.text("end_at")) ?? start }
    public var openWindow: Bool { raw.text("schedule_kind") == "open_window" }
    public var editable: Bool { raw.text("status") == "scheduled" }
    public var timed: ScheduledInterview? {
        guard openWindow else { return self }
        guard let from = CareerApplication.date(raw.text("answer_plan_start_at")), let to = CareerApplication.date(raw.text("answer_plan_end_at")), from < to else { return nil }
        guard case .object(var fields) = raw else { return nil }
        fields["start_at"] = raw["answer_plan_start_at"]
        fields["end_at"] = raw["answer_plan_end_at"]
        return ScheduledInterview(.object(fields))
    }
    public var caption: String { company + " · " + label }
    public func status(at now: Date) -> String {
        if raw.text("status") == "cancelled" { return "已取消" }
        if raw.text("status") == "completed" { return "已完成" }
        if end <= now { return openWindow ? "已截止" : "等待结果" }
        if start <= now { return openWindow ? "待完成" : "进行中" }
        return openWindow ? "未开始" : "已安排"
    }
    public func overlaps(_ from: Date, _ to: Date) -> Bool { start < to && end > from }
}

public enum ScheduleCalendar {
    public static func weekStart(_ date: Date, calendar: Calendar = .current) -> Date {
        let day = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: day)
        return calendar.date(byAdding: .day, value: -((weekday + 5) % 7), to: day)!
    }
    public static func monthDays(_ date: Date, calendar: Calendar = .current) -> [Date] {
        let month = calendar.dateInterval(of: .month, for: date)!
        let first = weekStart(month.start, calendar: calendar)
        let last = calendar.date(byAdding: .day, value: -1, to: month.end)!
        let end = calendar.date(byAdding: .day, value: 7, to: weekStart(last, calendar: calendar))!
        var days: [Date] = []; var current = first
        while current < end { days.append(current); current = calendar.date(byAdding: .day, value: 1, to: current)! }
        return days
    }
    public static func conflicts(_ items: [ScheduledInterview], excluding id: String?, start: Date, end: Date) -> [ScheduledInterview] {
        items.filter { $0.id != id && $0.editable && !$0.openWindow && $0.overlaps(start, end) }
    }
    public static func upcoming(_ items: [ScheduledInterview], now: Date) -> [ScheduledInterview] {
        Array(items.filter { $0.editable && $0.end > now }.sorted {
            ($0.openWindow ? $0.end : $0.start) < ($1.openWindow ? $1.end : $1.start)
        }.prefix(3))
    }
    /// Each overlapping connected group gets independent lanes; back-to-back events share a lane.
    public static func lanes(_ items: [ScheduledInterview]) -> [String: (index: Int, count: Int)] {
        let sorted = items.sorted { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }
        var result: [String: (Int, Int)] = [:]; var group: [ScheduledInterview] = []; var boundary = Date.distantPast
        func flush() {
            var ends: [Date] = []; var indices: [String: Int] = [:]
            for item in group {
                let lane = ends.firstIndex { $0 <= item.start } ?? ends.count
                if lane == ends.count { ends.append(item.end) } else { ends[lane] = item.end }
                indices[item.id] = lane
            }
            for item in group { result[item.id] = (indices[item.id]!, ends.count) }
        }
        for item in sorted {
            if item.start >= boundary && !group.isEmpty { flush(); group = [] }
            group.append(item); boundary = max(group.map(\.end).max() ?? item.end, item.end)
        }
        if !group.isEmpty { flush() }
        return result
    }
}
