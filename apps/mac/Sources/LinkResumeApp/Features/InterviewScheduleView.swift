import AppKit
import LinkResumeCore
import SwiftUI

private struct ScheduleAction: Identifiable {
    let id = UUID()
    var kind: String
    var interview: ScheduledInterview?
    var start: Date
    var end: Date
}

/// 05.1 / 05.2 面试日程. Mirrors Web `ScheduleView`: SCHEDULE head with a date jump, 月/周 calendar,
/// the 接下来 list and the 05.2b schedule detail dialog.
struct InterviewScheduleView: View {
    @Environment(SessionStore.self) private var session
    let requireAccount: () -> Void
    @State private var anchor = Date()
    @State private var mode = "month"
    @State private var interviews: [ScheduledInterview] = []
    @State private var applications: [CareerApplication] = []
    @State private var action: ScheduleAction?
    @State private var pending: ScheduleAction?
    @State private var detail: ScheduledInterview?
    @State private var selectedID: String?
    @State private var record: CareerApplication?
    @State private var recordAction: JobAction?
    @State private var refresh = UUID()
    @State private var loading = false
    @State private var failure: String?
    @State private var datePicker = false
    @State private var overflow: Date?
    @State private var showAllWindows = false
    private let calendar = Calendar.current
    private static let hourHeight: CGFloat = 56
    private static let gutter: CGFloat = 52
    private var account: String { if case .signedIn(let user) = session.phase { return user.id }; return "" }
    private var week: Date { ScheduleCalendar.weekStart(anchor) }
    private var month: Date { calendar.dateInterval(of: .month, for: anchor)!.start }
    private var visible: [ScheduledInterview] { interviews.filter { $0.raw.text("status") != "cancelled" } }
    private func plus(_ date: Date, _ days: Int) -> Date { calendar.date(byAdding: .day, value: days, to: date)! }
    private func format(_ date: Date, _ pattern: String) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN"); f.dateFormat = pattern; return f.string(from: date) }
    private func at(_ day: Date, minute: Int) -> Date { calendar.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: day)! }
    private var periodStart: Date { mode == "month" ? month : week }
    private var periodEnd: Date { mode == "month" ? calendar.date(byAdding: .month, value: 1, to: month)! : plus(week, 7) }
    /// `scheduleHeadTitle`: 2026 年 9 月 / 9 月 21 日 – 27 日.
    private var heading: String {
        if mode == "month" { return "\(calendar.component(.year, from: month)) 年 \(calendar.component(.month, from: month)) 月" }
        let end = plus(week, 6)
        let (m1, d1, m2, d2) = (calendar.component(.month, from: week), calendar.component(.day, from: week), calendar.component(.month, from: end), calendar.component(.day, from: end))
        return m1 == m2 ? "\(m1) 月 \(d1) 日 – \(d2) 日" : "\(m1) 月 \(d1) 日 – \(m2) 月 \(d2) 日"
    }
    private var subtitle: String {
        guard !account.isEmpty else { return "游客模式 · 登录后管理面试安排" }
        let count = visible.filter { $0.overlaps(periodStart, periodEnd) }.count
        let today = visible.filter { !$0.openWindow && calendar.isDateInToday($0.start) }.count
        return "\(mode == "month" ? "本月" : "本周") \(count) 个日程" + (today > 0 ? " · 今天 \(today) 场面试" : "")
    }

    var body: some View {
        Group {
            if let record {
                CareerApplicationDetailView(application: record, api: session.api, back: { self.record = nil; refresh = UUID() }, perform: { kind, app in
                    recordAction = JobAction(kind: kind, application: app,
                        stage: kind == "apply" ? "screening" : kind == "schedule-current" ? app.stage : CareerStage.nextStages(app).first(where: { $0 == "interview" }) ?? CareerStage.nextStages(app).first ?? "screening",
                        label: kind == "stage" ? JobsBoardView.roundLabel((app.raw["current_round_no"]?.integer ?? 0) + 1) : app.stageLabel,
                        round: kind == "schedule-current" ? app.raw["current_round_no"]?.integer : nil)
                })
            } else {
                page
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task(id: account + refresh.uuidString) { await load() }
        .onChange(of: account) { _, id in
            interviews = []; applications = []; action = nil; overflow = nil; detail = nil; record = nil; selectedID = nil
            if id.isEmpty { pending = nil }
            else if let value = pending { action = value; pending = nil }
        }
        .sheet(item: $action) { value in
            if value.kind == "create" {
                CareerForm(action: JobAction(kind: "schedule", application: nil, start: value.start, end: value.end), applications: applications, api: session.api,
                           completed: { action = nil; refresh = UUID() }, close: { action = nil }).frame(width: 880, height: 780)
            } else {
                ScheduleSessionForm(action: value, interviews: interviews, api: session.api, completed: { action = nil; refresh = UUID() }, close: { action = nil }).frame(width: 560, height: 560)
            }
        }
        .sheet(item: $detail) { item in
            ScheduleDetailDialog(interview: item, api: session.api, close: { detail = nil }, changed: { detail = nil; refresh = UUID() }, openRecord: {
                detail = nil
                record = applications.first { $0.id == item.applicationID }
            }).frame(width: 520)
        }
        .sheet(item: $recordAction) { item in
            CareerForm(action: item, applications: applications, api: session.api, completed: { recordAction = nil; refresh = UUID() }, close: { recordAction = nil })
                .frame(width: item.compact ? 480 : 880, height: item.compact ? nil : 780)
        }
    }

    private var page: some View {
        VStack(alignment: .leading, spacing: 0) {
            head.padding(.bottom, 30)
            if let failure {
                HStack(spacing: 10) {
                    Text(failure).font(V3.sans(12.5)).foregroundStyle(V3.red)
                    Button("重试") { refresh = UUID() }.buttonStyle(CareerActionStyle(kind: .link))
                }.padding(.bottom, 12)
            }
            Group { if mode == "month" { monthView } else { weekView } }
                .frame(height: 480).overlay(alignment: .topTrailing) { if loading { ProgressView().controlSize(.small).padding(6) } }
            upcoming.padding(.top, 24)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 32).padding(.top, 52).padding(.bottom, 20)
        .background { Button("") { create(start: at(calendar.startOfDay(for: anchor), minute: 9 * 60)) }.keyboardShortcut("n", modifiers: .command).opacity(0) }
    }

    // MARK: Head

    private var head: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(alignment: .leading, spacing: 0) {
                Text(["SCHEDULE", "\(calendar.component(.year, from: periodStart)) 年", mode == "month" ? "月视图" : "周视图"].joined(separator: " · "))
                    .font(V3.sans(12, weight: .medium)).foregroundStyle(V3.fnt).frame(height: 18)
                Button { datePicker.toggle() } label: {
                    HStack(spacing: 8) { Text(heading).font(V3.serif(28)).foregroundStyle(V3.txt); Image(systemName: "chevron.down").font(.system(size: 12, weight: .medium)).foregroundStyle(V3.fnt) }
                        .frame(height: 36).contentShape(Rectangle())
                }
                .buttonStyle(.plain).padding(.top, 8).accessibilityLabel("\(heading)，选择其他日期")
                .popover(isPresented: $datePicker, arrowEdge: .bottom) {
                    DatePicker(mode == "month" ? "选择月份" : "选择周", selection: Binding(get: { anchor }, set: { anchor = $0; datePicker = false }), displayedComponents: .date)
                        .datePickerStyle(.graphical).labelsHidden().padding(16).frame(width: 300)
                }
                Text(subtitle).font(V3.sans(14)).foregroundStyle(V3.sub).padding(.top, 6)
            }
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                V3Segmented(options: [("month", "月"), ("week", "周")], selection: $mode).accessibilityLabel("日程视图")
                HStack(spacing: 4) {
                    navButton(systemImage: "chevron.left", label: "上一周期") { shift(-1) }
                    Button("今天") { anchor = Date(); overflow = nil }.buttonStyle(ScheduleNavStyle())
                    navButton(systemImage: "chevron.right", label: "下一周期") { shift(1) }
                }
            }.padding(.top, 32)
        }
    }
    private func navButton(systemImage: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: systemImage).font(.system(size: 11, weight: .semibold)) }
            .buttonStyle(ScheduleNavStyle(square: true)).accessibilityLabel(label)
    }
    private func shift(_ amount: Int) {
        anchor = calendar.date(byAdding: mode == "month" ? .month : .day, value: mode == "month" ? amount : 7 * amount, to: anchor)!
        overflow = nil
    }
    private func create(start: Date, end: Date? = nil) {
        let value = ScheduleAction(kind: "create", start: start, end: end ?? start.addingTimeInterval(1800))
        if account.isEmpty { pending = value; requireAccount() } else { action = value }
    }
    private func open(_ item: ScheduledInterview) {
        selectedID = item.id
        detail = interviews.first { $0.id == item.id } ?? item
    }
    private func move(_ item: ScheduledInterview, kind: String, start: Date, end: Date) {
        action = ScheduleAction(kind: kind, interview: item, start: start, end: end)
    }
    /// Web `INTERVIEW_CALENDAR_COLORS`; a third interview round without a colour shows purple,
    /// and the month view spreads grey events over the palette.
    static func color(_ item: ScheduledInterview, month: Bool = false) -> Color {
        var key = item.raw.text("calendar_color")
        if item.raw.text("stage_type") == "interview" && item.raw["round_no"]?.integer == 3 && key == "gray" { key = "purple" }
        if month && (key == "gray" || key.isEmpty) {
            let fallback = ["red", "orange", "green", "blue", "purple"]
            key = fallback[item.id.unicodeScalars.reduce(0) { $0 + Int($1.value) } % fallback.count]
        }
        return Color(hex: ["red": 0xD64545, "orange": 0xD9822B, "yellow": 0xC4A236, "green": 0x3D8B67, "blue": 0x3F6FD8, "purple": 0x8B6BC8, "gray": 0x96968F][key] ?? 0x3F6FD8)
    }
    /// `meetingLabel`.
    static func meetingLabel(_ raw: JSONValue) -> String {
        if raw.text("mode") == "onsite" { return [raw.text("location"), "现场"].filter { !$0.isEmpty }.joined(separator: " · ") }
        let url = raw.text("meeting_url")
        let platform = url.contains("feishu.cn") || url.contains("larksuite.com") ? "飞书会议" : url.contains("meeting.tencent.com") ? "腾讯会议" : url.contains("nowcoder.com") ? "牛客网" : nil
        let mode = raw.text("mode") == "video" ? "视频" : raw.text("mode") == "phone" ? "电话" : "其他方式"
        return [mode, platform].compactMap { $0 }.joined(separator: " · ")
    }

    // MARK: Month

    private func items(_ day: Date) -> [ScheduledInterview] {
        let start = calendar.startOfDay(for: day)
        return visible.filter { !$0.openWindow && $0.overlaps(start, plus(start, 1)) }.sorted { $0.start < $1.start }
    }
    private var monthView: some View {
        let days = ScheduleCalendar.monthDays(anchor)
        let rows = max(1, days.count / 7)
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(["周一", "周二", "周三", "周四", "周五", "周六", "周日"], id: \.self) { name in
                    Text(name).font(V3.sans(10.5)).foregroundStyle(V3.fnt).padding(.horizontal, 8).padding(.top, 2).frame(maxWidth: .infinity, alignment: .leading).frame(height: 24)
                }
            }.overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
            GeometryReader { viewport in
                let height = max(84, viewport.size.height / CGFloat(rows))
                ScrollView(.vertical) {
                    VStack(spacing: 0) {
                        ForEach(0..<rows, id: \.self) { row in
                            HStack(spacing: 0) {
                                ForEach(0..<7, id: \.self) { column in monthCell(days[row * 7 + column], height: height) }
                            }.overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
                        }
                    }
                }.scrollDisabled(height * CGFloat(rows) <= viewport.size.height + 1)
            }
        }
    }
    private func monthCell(_ day: Date, height: CGFloat) -> some View {
        let events = items(day)
        let today = calendar.isDateInToday(day)
        let inside = calendar.isDate(day, equalTo: month, toGranularity: .month)
        let capacity = max(1, Int((height - 34) / 24))
        let shown = events.count > capacity ? Array(events.prefix(capacity - 1)) : events
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Button { anchor = day; mode = "week" } label: {
                    Text("\(calendar.component(.day, from: day))").font(V3.number(10.5, weight: today ? .semibold : .medium))
                        .foregroundStyle(today ? .white : inside ? V3.txt : V3.fnt2)
                        .frame(width: 22, height: 22).background(today ? V3.blue : .clear, in: Circle()).contentShape(Circle())
                }.buttonStyle(.plain).accessibilityLabel(format(day, "M月d日") + "，查看这一周")
                Spacer(minLength: 0)
                if events.count > shown.count {
                    Button("另有 \(events.count - shown.count) 项") { overflow = day }
                        .buttonStyle(.plain).font(V3.sans(10)).foregroundStyle(V3.fnt).padding(.horizontal, 6).frame(height: 20)
                        .popover(isPresented: Binding(get: { overflow == day }, set: { if !$0 { overflow = nil } })) { overflowList(day, events) }
                }
            }.frame(height: 30, alignment: .bottom)
            ForEach(shown) { item in monthEvent(item) }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4).padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .topLeading).frame(height: height, alignment: .topLeading)
        .background(today ? V3.blue.opacity(0.05) : .clear)
        .overlay(alignment: .leading) { Rectangle().fill(V3.line).frame(width: 1) }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { create(start: at(day, minute: 9 * 60)) }
        .dropDestination(for: String.self) { ids, _ in
            guard let item = interviews.first(where: { $0.id == ids.first }), item.editable, !item.openWindow else { return false }
            let parts = calendar.dateComponents([.hour, .minute], from: item.start)
            let from = at(day, minute: (parts.hour ?? 9) * 60 + (parts.minute ?? 0))
            move(item, kind: "reschedule", start: from, end: from.addingTimeInterval(item.end.timeIntervalSince(item.start))); return true
        }
    }
    private func monthEvent(_ item: ScheduledInterview) -> some View {
        HStack(spacing: 5) {
            Circle().fill(Self.color(item, month: true)).frame(width: 5, height: 5)
            Text(item.company).font(V3.sans(11, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1)
            Text(item.label).font(V3.sans(11)).foregroundStyle(V3.sub).lineLimit(1)
            Spacer(minLength: 2)
            Text(format(item.start, "HH:mm")).font(V3.number(10, weight: .regular)).foregroundStyle(V3.fnt)
        }
        .padding(.horizontal, 6).frame(height: 20)
        .background(V3.field, in: RoundedRectangle(cornerRadius: 5))
        .overlay(RoundedRectangle(cornerRadius: 5).stroke(selectedID == item.id ? V3.txt : .clear, lineWidth: 1.5))
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { open(item) }
        .onTapGesture { selectedID = item.id }
        .draggable(item.editable ? item.id : "")
        .help(item.company + " " + item.title + " " + item.label)
    }
    private func overflowList(_ day: Date, _ events: [ScheduledInterview]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(format(day, "M月d日 · EEE")).font(V3.sans(12, weight: .medium)).foregroundStyle(V3.fnt).padding(.horizontal, 8).padding(.top, 6).padding(.bottom, 8)
            ForEach(events) { item in
                Button { overflow = nil; open(item) } label: {
                    HStack(alignment: .top, spacing: 10) {
                        RoundedRectangle(cornerRadius: 2).fill(Self.color(item, month: true)).frame(width: 3, height: 30)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.company).font(V3.sans(12, weight: .semibold)).foregroundStyle(V3.txt)
                            Text(format(item.start, "HH:mm") + "–" + format(item.end, "HH:mm") + " · " + item.label).font(V3.sans(11)).foregroundStyle(V3.fnt)
                        }
                        Spacer(minLength: 0)
                    }.padding(.horizontal, 8).padding(.vertical, 8).contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }.padding(8).frame(width: 256)
    }

    // MARK: Week

    private var weekView: some View {
        let windows = visible.filter { $0.openWindow && $0.overlaps(week, plus(week, 7)) }.sorted { $0.end < $1.end }
        let shownWindows = showAllWindows ? windows : Array(windows.prefix(3))
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                Color.clear.frame(width: Self.gutter)
                ForEach(0..<7, id: \.self) { index in
                    let day = plus(week, index)
                    let today = calendar.isDateInToday(day)
                    VStack(spacing: 2) {
                        Text(format(day, "EEE")).font(V3.sans(10.5)).foregroundStyle(V3.fnt)
                        Text("\(calendar.component(.day, from: day))").font(V3.number(15, weight: .semibold))
                            .foregroundStyle(today ? .white : V3.txt).frame(width: 26, height: 26).background(today ? V3.blue : .clear, in: Circle())
                    }.frame(maxWidth: .infinity).frame(height: 56)
                }
            }.overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
            if !windows.isEmpty {
                HStack(alignment: .top, spacing: 0) {
                    Text("全天").font(V3.sans(10)).foregroundStyle(V3.fnt).frame(width: Self.gutter, alignment: .leading).padding(.top, 6)
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(shownWindows) { item in windowBar(item) }
                        if windows.count > 3 {
                            Button(showAllWindows ? "收起更多项目" : "还有 \(windows.count - 3) 项待完成 · 展开查看") { showAllWindows.toggle() }
                                .buttonStyle(.plain).font(V3.sans(10, weight: .semibold)).foregroundStyle(V3.sub)
                                .frame(maxWidth: .infinity).frame(height: 20).background(Color(hex: 0xEEF1F5), in: RoundedRectangle(cornerRadius: 5))
                        }
                    }.padding(.vertical, 4)
                }.frame(minHeight: 34).overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
            }
            timeGrid
        }
    }
    private func windowBar(_ item: ScheduledInterview) -> some View {
        GeometryReader { geometry in
            let width = geometry.size.width / 7
            let first = max(0, calendar.dateComponents([.day], from: week, to: calendar.startOfDay(for: item.start)).day ?? 0)
            let endDay = calendar.startOfDay(for: item.end.addingTimeInterval(-1))
            let last = min(6, calendar.dateComponents([.day], from: week, to: endDay).day ?? 6)
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 1).fill(Self.color(item)).frame(width: 2, height: 12)
                Text(item.company + " " + item.label + "开放").font(V3.sans(10, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.leading, 4).frame(width: max(width, CGFloat(last - first + 1) * width) - 4, height: 22)
            .background(Self.color(item).opacity(0.10), in: RoundedRectangle(cornerRadius: 5))
            .offset(x: CGFloat(first) * width + 2)
            .contentShape(Rectangle())
            .onTapGesture { open(item) }
        }.frame(height: 22)
    }
    private var timeGrid: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical) {
                GeometryReader { viewport in
                    let width = (viewport.size.width - Self.gutter) / 7
                    ZStack(alignment: .topLeading) {
                        VStack(spacing: 0) {
                            ForEach(0..<24, id: \.self) { hour in
                                HStack(alignment: .top, spacing: 0) {
                                    Text(String(format: "%02d:00", hour)).font(V3.number(10, weight: .medium)).foregroundStyle(V3.fnt).frame(width: Self.gutter, alignment: .leading).padding(.top, 3)
                                    Rectangle().fill(V3.line).frame(height: 1)
                                }.frame(height: Self.hourHeight, alignment: .top).id("hour\(hour)")
                            }
                        }
                        HStack(spacing: 0) {
                            Color.clear.frame(width: Self.gutter)
                            ForEach(0..<7, id: \.self) { index in dayColumn(plus(week, index), width: width) }
                        }
                        ForEach(0..<7, id: \.self) { index in dayEvents(plus(week, index), index: index, width: width) }
                        if let index = (0..<7).first(where: { calendar.isDateInToday(plus(week, $0)) }) {
                            let now = Date()
                            let minute = CGFloat(calendar.component(.hour, from: now) * 60 + calendar.component(.minute, from: now))
                            Rectangle().fill(V3.red).frame(width: width, height: 1.5)
                                .offset(x: Self.gutter + CGFloat(index) * width, y: minute / 60 * Self.hourHeight)
                        }
                    }
                }.frame(height: Self.hourHeight * 24)
            }
            .task(id: week) {
                let earliest = visible.filter { !$0.openWindow && $0.start >= week && $0.start < plus(week, 7) }.map { calendar.component(.hour, from: $0.start) }.min() ?? 8
                proxy.scrollTo("hour\(min(8, earliest))", anchor: .top)
            }
        }
    }
    private func dayColumn(_ day: Date, width: CGFloat) -> some View {
        Rectangle().fill(Color.clear).frame(width: width, height: Self.hourHeight * 24)
            .overlay(alignment: .leading) { Rectangle().fill(V3.line).frame(width: 1) }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 8).onEnded { selection in
                let from = at(day, minute: snap(min(selection.startLocation.y, selection.location.y), upper: 1425))
                let until = at(day, minute: max(15, snap(max(selection.startLocation.y, selection.location.y), upper: 1439)))
                if until > from { create(start: from, end: until) }
            })
            .onTapGesture(count: 2) { point in let from = at(day, minute: snap(point.y, upper: 1425)); create(start: from, end: from.addingTimeInterval(1800)) }
            .dropDestination(for: String.self) { ids, point in
                guard let original = interviews.first(where: { $0.id == ids.first }), let item = original.timed, item.editable else { return false }
                let from = at(day, minute: snap(point.y, upper: 1425))
                move(original, kind: item.openWindow ? "answer-plan" : "reschedule", start: from, end: from.addingTimeInterval(item.end.timeIntervalSince(item.start))); return true
            }
    }
    private func snap(_ y: CGFloat, upper: Int) -> Int { min(upper, max(0, Int((y / Self.hourHeight * 60 / 15).rounded()) * 15)) }
    private func dayEvents(_ day: Date, index: Int, width: CGFloat) -> some View {
        let events = visible.compactMap(\.timed).filter { $0.overlaps(day, plus(day, 1)) }
        let lanes = ScheduleCalendar.lanes(events)
        return ForEach(events) { item in
            let lane = lanes[item.id] ?? (0, 1)
            let start = max(day, item.start), end = min(plus(day, 1), item.end)
            let minute = CGFloat(calendar.component(.hour, from: start) * 60 + calendar.component(.minute, from: start))
            let height = max(22, end.timeIntervalSince(start) / 3600 * Self.hourHeight) - 4
            let color = Self.color(item)
            let selected = selectedID == item.id
            VStack(alignment: .leading, spacing: 1) {
                if item.editable { resizeHandle(item, top: true) }
                HStack(spacing: 4) {
                    Image(systemName: "clock").font(.system(size: 8, weight: .semibold)).foregroundStyle(color)
                    Text(format(item.start, "HH:mm") + "–" + format(item.end, "HH:mm")).font(V3.number(10, weight: .regular)).foregroundStyle(color)
                }.frame(height: 12)
                Text(item.company + " · " + item.label).font(V3.sans(11.5, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1).frame(height: 16)
                if height > 44 { Text(item.openWindow ? "我的作答计划" : Self.meetingLabel(item.raw)).font(V3.sans(10)).foregroundStyle(V3.sub).lineLimit(1).frame(height: 12) }
                Spacer(minLength: 0)
                if item.editable { resizeHandle(item, top: false) }
            }
            .padding(.leading, 12).padding(.trailing, 6).padding(.vertical, 1)
            .frame(width: width / CGFloat(lane.count) - 4, height: height, alignment: .topLeading)
            .background(selected ? color.opacity(0.16) : color.opacity(0.10), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(selected ? color.opacity(0.45) : .clear))
            .clipped()
            .contentShape(Rectangle())
            .onTapGesture(count: 2) { open(item) }
            .onTapGesture { selectedID = item.id }
            .draggable(item.editable ? item.id : "")
            .offset(x: Self.gutter + CGFloat(index) * width + CGFloat(lane.index) * width / CGFloat(lane.count) + 2, y: minute / 60 * Self.hourHeight + 2)
        }
    }
    private func resizeHandle(_ item: ScheduledInterview, top: Bool) -> some View {
        Capsule().fill(Self.color(item).opacity(0.6)).frame(width: 18, height: 2).frame(maxWidth: .infinity).frame(height: 5).contentShape(Rectangle())
            .gesture(DragGesture().onEnded { drag in
                let minutes = Int((drag.translation.height / Self.hourHeight * 60 / 15).rounded()) * 15
                let from = top ? item.start.addingTimeInterval(Double(minutes) * 60) : item.start
                let until = top ? item.end : item.end.addingTimeInterval(Double(minutes) * 60)
                if until.timeIntervalSince(from) >= 900 { move(interviews.first { $0.id == item.id } ?? item, kind: item.openWindow ? "answer-plan" : "reschedule", start: from, end: until) }
            })
            .help(top ? "拖动调整开始时间" : "拖动调整结束时间")
    }

    // MARK: Upcoming

    private var upcoming: some View {
        let now = Date()
        let next = visible.filter { $0.raw.text("status") == "scheduled" && $0.end > now }
            .sorted { ($0.openWindow ? $0.end : $0.start) < ($1.openWindow ? $1.end : $1.start) }.prefix(3)
        return VStack(alignment: .leading, spacing: 10) {
            Text("接下来").font(V3.sans(11)).foregroundStyle(V3.fnt)
            if next.isEmpty {
                VStack(spacing: 6) {
                    Text(account.isEmpty ? "登录后查看你的面试安排" : "接下来没有安排的面试或笔试").font(V3.sans(13)).foregroundStyle(V3.sub)
                    Text("收到面试通知后，可以在日历空白处双击添加，或按 ⌘N 新建面试").font(V3.sans(11.5)).foregroundStyle(V3.fnt)
                }
                .frame(maxWidth: .infinity).frame(height: 154)
                .overlay(alignment: .top) { Rectangle().fill(V3.line).frame(height: 1) }
                .overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(next.enumerated()), id: \.element.id) { offset, item in
                        if offset > 0 { Rectangle().fill(V3.line).frame(height: 1) }
                        upcomingRow(item, now: now)
                    }
                    Rectangle().fill(V3.line).frame(height: 1)
                    Spacer(minLength: 0)
                }.frame(height: 154, alignment: .top)
            }
        }
    }
    private func upcomingRow(_ item: ScheduledInterview, now: Date) -> some View {
        let start = item.openWindow ? item.end : item.start
        let today = calendar.isDate(start, inSameDayAs: now)
        let time = (today ? "今天" : format(start, "MM-dd")) + " " + format(start, "HH:mm")
        let prepTotal = item.raw["prep_total"]?.integer ?? 0
        let state = item.openWindow ? (item.start <= now ? "待完成" : "未开始")
            : today ? (prepTotal > 0 ? "准备清单 \(item.raw["prep_done"]?.integer ?? 0)/\(prepTotal)" : "未生成准备清单") : "待确认"
        return Button { open(item) } label: {
            HStack(spacing: 0) {
                Circle().fill(item.openWindow ? V3.red : V3.blue).frame(width: 6, height: 6).frame(width: 16, alignment: .leading)
                Text(time).font(V3.number(12, weight: .medium)).foregroundStyle(V3.sub).frame(width: 114, alignment: .leading)
                Text(item.company + " · " + item.title + " " + item.label).font(V3.sans(13.5, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1).frame(maxWidth: 270, alignment: .leading)
                Text(Self.meetingLabel(item.raw)).font(V3.sans(11.5)).foregroundStyle(V3.fnt).lineLimit(1).padding(.leading, 16).frame(maxWidth: .infinity, alignment: .leading)
                Text(state).font(V3.sans(11.5)).foregroundStyle(V3.fnt)
            }.frame(height: 50).contentShape(Rectangle())
        }.buttonStyle(CareerRowStyle()).accessibilityLabel("\(item.label)｜\(item.company)，\(time)")
    }

    private func load() async {
        guard !account.isEmpty else { loading = false; failure = nil; return }
        loading = true; failure = nil
        do {
            var items: [JSONValue] = []; var cursor = ""; var seen = Set<String>()
            repeat {
                var query = ["limit": "500"]; if !cursor.isEmpty { query["cursor"] = cursor }
                let page = try await session.api.careerRequest(path: "/api/interview-sessions", method: "GET", query: query, body: nil)
                try Task.checkCancellation(); items += page["items"]?.items ?? []; cursor = page.text("next_cursor")
                if !cursor.isEmpty && !seen.insert(cursor).inserted { throw APIError.invalidResponse }
            } while !cursor.isEmpty
            var jobs: [CareerApplication] = []; cursor = ""; seen = []
            repeat {
                var query = ["scope": "all", "limit": "200"]; if !cursor.isEmpty { query["cursor"] = cursor }
                let page = try await session.api.careerRequest(path: "/api/job-applications", method: "GET", query: query, body: nil)
                try Task.checkCancellation(); jobs += (page["items"]?.items ?? []).map { CareerApplication($0) }; cursor = page.text("next_cursor")
                if !cursor.isEmpty && !seen.insert(cursor).inserted { throw APIError.invalidResponse }
            } while !cursor.isEmpty
            interviews = items.map(ScheduledInterview.init); applications = jobs
        } catch { if !Task.isCancelled { failure = "排期加载失败，请检查连接或重新登录后重试。" } }
        if !Task.isCancelled { loading = false }
    }
}

/// `.interview-calendar-nav-arrows` buttons: 30pt bordered squares and the 今天 pill.
private struct ScheduleNavStyle: ButtonStyle {
    var square = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(V3.sans(12.5)).foregroundStyle(V3.txt)
            .padding(.horizontal, square ? 0 : 10).frame(minWidth: 30).frame(width: square ? 30 : nil, height: 30)
            .background(configuration.isPressed ? V3.field : .white, in: RoundedRectangle(cornerRadius: 7))
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(V3.cl))
            .contentShape(Rectangle())
    }
}

/// 05.2b–05.2i schedule detail: serif title with a status pill, an art stage, the info card and,
/// for an open window, the personal answer plan.
private struct ScheduleDetailDialog: View {
    let interview: ScheduledInterview
    let api: any APIClient
    let close: () -> Void
    let changed: () -> Void
    let openRecord: () -> Void
    @Environment(\.openURL) private var openURL
    @State private var item: ScheduledInterview?
    @State private var planSet = false
    @State private var planStart = Date()
    @State private var planMinutes = 120
    @State private var busy = false
    @State private var error: String?
    private var current: ScheduledInterview { item ?? interview }
    private var isWindow: Bool { current.openWindow }
    private var stage: String { current.label }
    private var isExam: Bool { stage.contains("笔试") }
    private var isTest: Bool { stage.contains("测评") }
    private var isAI: Bool { stage.lowercased().contains("ai") }
    private var cancelled: Bool { current.raw.text("status") == "cancelled" }
    private var completed: Bool { current.raw.text("status") == "completed" }
    private var active: Bool { !cancelled && !completed && current.start <= Date() && current.end > Date() }
    private var canEdit: Bool { current.editable }
    private var status: (String, Color, Color) {
        if completed { return ("已完成", V3.green, V3.greenSoft) }
        if cancelled { return ("已取消", V3.fnt, V3.field) }
        if isWindow { return ("待完成", V3.orange, V3.orangeSoft) }
        if active { return ("进行中", V3.blue, V3.blueSoft) }
        return (isExam || isAI ? "待参加" : "待面试", V3.blue, V3.blueSoft)
    }
    private func format(_ date: Date, _ pattern: String) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN"); f.dateFormat = pattern; return f.string(from: date) }
    private var relative: String {
        let until = current.start.timeIntervalSinceNow
        if !isWindow && !cancelled && !completed && until > 0 {
            return until < 86400 ? " · 还有 \(Int(until / 3600)) 小时 \(Int(until.truncatingRemainder(dividingBy: 3600) / 60)) 分" : " · \(Int((until / 86400).rounded(.up))) 天后"
        }
        return isWindow && !cancelled && !completed ? " · 截止前任选时间完成" : ""
    }
    private var meetingURL: URL? { URL(string: current.raw.text("meeting_url")).flatMap { ["http", "https"].contains($0.scheme?.lowercased() ?? "") ? $0 : nil } }
    private var kindWord: String { isExam ? "笔试" : isTest ? "测评" : "面试" }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    Text(current.company + " · " + stage).font(V3.serif(20)).foregroundStyle(V3.txt).lineLimit(1)
                    Text(status.0).font(V3.sans(11, weight: .medium)).foregroundStyle(status.1).padding(.horizontal, 8).frame(height: 22).background(status.2, in: Capsule())
                    Spacer(minLength: 0)
                    Button(action: close) { Image(systemName: "xmark").font(.system(size: 12, weight: .medium)).foregroundStyle(V3.fnt) }.buttonStyle(.plain).accessibilityLabel("关闭")
                }.frame(height: 29)
                Text(current.title + relative).font(V3.sans(12.5)).foregroundStyle(V3.sub).padding(.top, 5)
                if busy && item == nil { Text("正在加载完整面试详情…").font(V3.sans(11.5)).foregroundStyle(V3.fnt).padding(.top, 8) }
                V3DotStage(height: 160) { art }.padding(.top, 18)
                rows.padding(.top, 20)
                if isWindow { planCard.padding(.top, 12) }
                if !isWindow && completed { note("复盘写在求职记录里，这一场不能再拖动改期。", tone: V3.green) }
                if !isWindow && current.raw.text("mode") == "onsite" && !completed && !cancelled { note("现场面试没有会议链接，地点和时间都在求职记录里改。", tone: V3.fnt) }
                if let error { Text(error).font(V3.sans(12)).foregroundStyle(V3.red).padding(.top, 10) }
            }.padding(.horizontal, 32).padding(.top, 28).padding(.bottom, 28)
            HStack(spacing: 10) {
                if primary != nil || (isWindow && canEdit) {
                    Button { openRecord() } label: { HStack(spacing: 4) { Text("查看求职记录"); Image(systemName: "arrow.right").font(.system(size: 10)) } }.buttonStyle(CareerActionStyle(kind: .link))
                }
                Spacer()
                if isWindow && canEdit && !current.raw.text("answer_plan_start_at").isEmpty {
                    Button("清除计划") { Task { await savePlan(clear: true) } }.buttonStyle(V3ButtonStyle(kind: .ghost, height: 36)).disabled(busy)
                }
                Button("关闭", action: close).buttonStyle(V3ButtonStyle(kind: .ghost, height: 36))
                if let primary {
                    Button(primary.0) { primary.1() }.buttonStyle(V3ButtonStyle(kind: .dark, height: 36)).disabled(busy)
                } else {
                    Button("查看求职记录") { openRecord() }.buttonStyle(V3ButtonStyle(kind: .dark, height: 36))
                }
            }.padding(.horizontal, 32).frame(height: 76).overlay(alignment: .top) { Rectangle().fill(V3.line).frame(height: 1) }
        }
        .task {
            if let start = CareerApplication.date(interview.raw.text("answer_plan_start_at")) {
                planSet = true; planStart = start
                if let end = CareerApplication.date(interview.raw.text("answer_plan_end_at")) { planMinutes = max(1, Int(end.timeIntervalSince(start) / 60)) }
            } else { planStart = max(interview.start, Date()) }
            busy = true
            do {
                let data = try await api.careerRequest(path: "/api/interview-sessions/\(interview.id)", method: "GET", query: [:], body: nil)
                try Task.checkCancellation()
                item = ScheduledInterview(data["session"] ?? .null)
            } catch { /* The list copy stays visible. */ }
            busy = false
        }
    }
    private var primary: (String, () -> Void)? {
        guard !cancelled && !completed else { return nil }
        if isWindow && canEdit { return ("保存作答计划", startPlanSave) }
        if let meetingURL { return (isExam ? "进入笔试" : isAI ? "进入 AI 面试" : "进入会议", { openURL(meetingURL) }) }
        return nil
    }
    private var rows: some View {
        let interviewer = [current.raw.text("interviewer_name"), current.raw.text("interviewer_title")].filter { !$0.isEmpty }
        let person = interviewer.count == 2 ? "\(interviewer[0])（\(interviewer[1])）" : interviewer.first ?? "暂未填写"
        var list: [(String, String, String, Bool, Bool)] = [
            isWindow ? ("calendar", "官方时段", format(current.start, "MM-dd HH:mm") + " – " + format(current.end, "MM-dd HH:mm"), true, false)
                : ("clock", cancelled ? "原定时间" : "时间", format(current.start, "M月d日（EEE） HH:mm") + " – " + format(current.end, "HH:mm"), !cancelled, false),
            ("user", isExam || isTest ? "联系人" : "面试官", person, false, person == "暂未填写"),
            ("brief", "形式", ["video": "视频面试", "onsite": "现场面试", "phone": "电话面试"][current.raw.text("mode")] ?? "其他方式", false, false),
        ]
        if !current.raw.text("location").isEmpty { list.append(("flag", "地点", current.raw.text("location"), false, false)) }
        if !current.raw.text("meeting_url").isEmpty { list.append(("link", (kindWord == "面试" ? "会议" : kindWord) + "链接", current.raw.text("meeting_url"), false, false)) }
        if cancelled && !current.raw.text("cancellation_reason").isEmpty { list.append(("text", "取消原因", current.raw.text("cancellation_reason"), false, false)) }
        return VStack(spacing: 0) {
            ForEach(Array(list.enumerated()), id: \.offset) { index, row in
                if index > 0 { Rectangle().fill(V3.line).frame(height: 1) }
                HStack(spacing: 10) {
                    CareerIcon(name: row.0, size: 14, template: true).foregroundStyle(V3.fnt)
                    Text(row.1).font(V3.sans(12)).foregroundStyle(V3.fnt)
                    Spacer(minLength: 12)
                    if row.0 == "link", let url = URL(string: row.2) {
                        Link(destination: url) { HStack(spacing: 4) { Text(row.2).lineLimit(1).truncationMode(.middle); CareerIcon(name: "link", size: 12, template: true) } }
                            .font(V3.number(12.5, weight: .regular)).foregroundStyle(Color(hex: 0x2E53AA))
                    } else {
                        Text(row.2).font(V3.sans(12.5, weight: row.3 ? .medium : .regular)).foregroundStyle(row.4 ? V3.fnt : V3.txt).lineLimit(1).textSelection(.enabled)
                    }
                }.padding(.horizontal, 16).frame(minHeight: 46)
            }
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(V3.cl))
    }
    private var planCard: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("我的作答计划").font(V3.sans(13, weight: .medium)).foregroundStyle(V3.txt)
                Text("仅作为个人时间安排，不会改变官方截止时间。").font(V3.sans(11)).foregroundStyle(V3.fnt)
            }
            Spacer(minLength: 8)
            if canEdit {
                DatePicker("计划作答时间", selection: Binding(get: { planStart }, set: { planStart = $0; planSet = true; error = nil }), in: current.start...max(current.start, current.end))
                    .labelsHidden().datePickerStyle(.field).frame(width: 150)
                Picker("作答时长", selection: $planMinutes) { ForEach(Array(Set([30, 45, 60, 90, 120, 180, planMinutes])).sorted(), id: \.self) { Text("\($0) 分钟").tag($0) } }
                    .labelsHidden().frame(width: 96)
            } else {
                Text(planSet ? format(planStart, "MM-dd HH:mm") + " · \(planMinutes) 分钟" : "未安排").font(V3.number(12, weight: .regular)).foregroundStyle(V3.sub)
            }
        }
        .padding(.horizontal, 16).frame(minHeight: 64)
        .background(.white, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(V3.cl))
    }
    private func note(_ text: String, tone: Color) -> some View {
        HStack(spacing: 8) { Circle().fill(tone).frame(width: 6, height: 6); Text(text).font(V3.sans(11.5)).foregroundStyle(V3.sub) }.padding(.top, 16)
    }
    /// `ScheduleArt`: a date card and a slot card for the stage kind.
    private var art: some View {
        HStack(spacing: 18) {
            VStack(spacing: 0) {
                Text("\(Calendar.current.component(.month, from: current.start)) 月").font(V3.sans(10)).foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 23).background(V3.txt)
                Text(format(current.start, "dd")).font(V3.number(30)).foregroundStyle(V3.txt).frame(height: 44)
                Text(isWindow ? format(current.end, "HH:mm") + " 截止" : format(current.start, "EEE HH:mm")).font(V3.sans(10)).foregroundStyle(V3.sub)
                Spacer(minLength: 0)
            }
            .frame(width: 82, height: 100).background(.white).clipShape(RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(V3.cl)).shadow(color: .black.opacity(0.07), radius: 8, y: 6)
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 7) {
                    CareerIcon(name: cancelled ? "flag" : completed ? "check" : isWindow ? "edit" : isAI ? "spark" : isExam ? "edit" : current.raw.text("mode") == "onsite" ? "flag" : "user", size: 14, template: true)
                        .foregroundStyle(status.1)
                    Text(cancelled ? "已取消" : completed ? "已完成" : isWindow ? (isTest ? "在线测评" : "作答窗口") : isAI ? "AI 面试" : isExam ? "笔试" : current.raw.text("mode") == "onsite" ? "现场面试" : "视频面试")
                        .font(V3.sans(11, weight: .medium)).foregroundStyle(V3.txt)
                }
                Text(isWindow ? format(current.start, "MM-dd") + " 开放 · " + format(current.end, "MM-dd") + " 截止" : format(current.start, "HH:mm") + " – " + format(current.end, "HH:mm"))
                    .font(V3.sans(10)).foregroundStyle(V3.fnt)
                if isWindow {
                    let total = max(1, current.end.timeIntervalSince(current.start))
                    let ratio = min(1, max(0, Date().timeIntervalSince(current.start) / total))
                    ZStack(alignment: .leading) {
                        Capsule().fill(V3.field).frame(width: 120, height: 4)
                        Capsule().fill(V3.orange).frame(width: 120 * ratio, height: 4)
                    }
                    Text(current.end > Date() ? "还剩 \(max(1, Int((current.end.timeIntervalSinceNow / 86400).rounded(.up)))) 天" : "已截止").font(V3.sans(10)).foregroundStyle(V3.sub)
                }
            }
            .padding(14).frame(minWidth: 140, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(V3.cl))
        }.accessibilityHidden(true)
    }
    private func startPlanSave() { Task { await savePlan(clear: false) } }
    private func savePlan(clear: Bool) async {
        guard canEdit, !busy else { return }
        let end = planStart.addingTimeInterval(Double(planMinutes) * 60)
        if !clear && (planStart < current.start || end > current.end) { error = "作答计划必须完整落在官方开放时间内。"; return }
        busy = true; error = nil
        do {
            let f = ISO8601DateFormatter()
            let body: JSONValue = .object(["base_lock_version": current.raw["lock_version"] ?? .number(1),
                                           "answer_plan_start_at": clear ? .null : .string(f.string(from: planStart)),
                                           "answer_plan_end_at": clear ? .null : .string(f.string(from: end))])
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(current.id)/answer-plan", method: "PUT", query: [:], body: body)
            changed()
        } catch {
            if case APIError.server(let status, let code) = error { self.error = status == 409 ? "记录已更新，请关闭后刷新再试（\(code)）。" : "保存失败（\(code)）。" }
            else { self.error = "连接失败，作答计划尚未确认保存。" }
        }
        busy = false
    }
}

private struct ScheduleSessionForm: View {
    let action: ScheduleAction
    let interviews: [ScheduledInterview]
    let api: any APIClient
    let completed: () -> Void
    let close: () -> Void
    @State private var item: ScheduledInterview?
    @State private var kind = "detail"
    @State private var start = Date()
    @State private var end = Date()
    @State private var reason = ""
    @State private var mode = "video"
    @State private var meeting = ""
    @State private var location = ""
    @State private var interviewer = ""
    @State private var interviewerTitle = ""
    @State private var note = ""
    @State private var questions = ""
    @State private var review = ""
    @State private var improvement = ""
    @State private var removePlan = false
    @State private var allowConflict = false
    @State private var busy = false
    @State private var failure: String?
    @State private var frozen: JSONValue?
    private var heading: String { ["detail": "面试安排", "reschedule": "确认改期", "answer-plan": "个人作答计划", "complete": "完成面试", "cancel": "取消安排", "edit": "编辑安排"][kind] ?? "面试安排" }
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(heading).font(V3.serif(20)).foregroundStyle(V3.txt)
                Spacer()
                Button(action: close) { Image(systemName: "xmark").font(.system(size: 12, weight: .medium)).foregroundStyle(V3.fnt) }.buttonStyle(.plain).accessibilityLabel("关闭").disabled(busy)
            }.padding(.horizontal, 28).padding(.top, 26).padding(.bottom, 16)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let item {
                        Text(item.company + " · " + item.title).font(.headline)
                        Text(item.label + " · " + item.status(at: Date())).font(.system(size: 13)).foregroundStyle(.secondary)
                        Text(item.openWindow ? "开放作答窗口" : "固定面试场次").font(.system(size: 12)).foregroundStyle(.secondary)
                        if kind == "detail" {
                            Text(display(item.start) + " — " + display(item.end))
                            Text(["video": "视频面试", "onsite": "现场面试", "phone": "电话面试", "other": "其他方式"][item.raw.text("mode")] ?? "其他方式")
                            if !item.raw.text("meeting_url").isEmpty { Text("会议 / 作答链接：" + item.raw.text("meeting_url")).textSelection(.enabled) }
                            if !item.raw.text("location").isEmpty { Text("地点：" + item.raw.text("location")) }
                            if !item.raw.text("interviewer_name").isEmpty { Text("面试官：" + item.raw.text("interviewer_name") + " " + item.raw.text("interviewer_title")) }
                            if !item.raw.text("preparation_note").isEmpty { Text("准备备注：" + item.raw.text("preparation_note")).textSelection(.enabled) }
                            if let plan = item.timed, item.openWindow { Text("个人作答计划：" + display(plan.start) + " — " + display(plan.end)) }
                            ForEach(["questions_markdown", "review_summary", "improvement_markdown"], id: \.self) { key in
                                if !item.raw.text(key).isEmpty { Text(item.raw.text(key)).textSelection(.enabled) }
                            }
                            if item.editable {
                                HStack {
                                    Button("编辑信息") { begin("edit") }
                                    if !item.openWindow { Button("改期") { begin("reschedule") } }
                                    if item.openWindow { Button("作答计划") { begin("answer-plan") } }
                                    Button("完成") { begin("complete") }
                                    Button("取消安排") { begin("cancel") }
                                }
                            }
                        } else if ["reschedule", "answer-plan"].contains(kind) {
                            if kind == "answer-plan" { Toggle("清除个人作答计划", isOn: $removePlan).disabled(frozen != nil) }
                            if !removePlan {
                                DatePicker("开始时间", selection: $start).disabled(frozen != nil)
                                DatePicker("结束时间", selection: $end).disabled(frozen != nil)
                            }
                            if kind == "reschedule" {
                                let conflicts = ScheduleCalendar.conflicts(interviews, excluding: item.id, start: start, end: end)
                                if !conflicts.isEmpty { Text("与 \(conflicts.count) 场安排重叠，请确认时间。").foregroundStyle(.orange); ForEach(conflicts) { Text($0.caption).font(.system(size: 12)) } }
                                Toggle("确认仍保存有时间冲突的安排", isOn: $allowConflict).disabled(frozen != nil)
                            }
                        } else if kind == "edit" {
                            Picker("面试方式", selection: $mode) { Text("视频").tag("video"); Text("现场").tag("onsite"); Text("电话").tag("phone"); Text("其他").tag("other") }
                            field("会议或作答链接", $meeting); field("地点", $location)
                            field("面试官姓名", $interviewer); field("面试官职位", $interviewerTitle)
                            field("准备备注", $note)
                        } else if kind == "complete" {
                            Text("确认标记完成；可同时记录面试问题和复盘。")
                            field("面试问题（可选）", $questions); field("复盘总结（可选）", $review); field("改进计划（可选）", $improvement)
                        } else if kind == "cancel" { Text("确认取消这场安排，历史记录仍会保留。"); field("取消原因（可选）", $reason) }
                    }
                    if let failure { Text(failure).foregroundStyle(.red).font(.system(size: 13)).textSelection(.enabled) }
                }.padding(24)
            }
            HStack(spacing: 10) {
                if kind != "detail" && action.kind == "detail" { Button("返回详情") { kind = "detail"; frozen = nil }.buttonStyle(CareerActionStyle(kind: .text)).disabled(busy) }
                Spacer()
                Button("取消", action: close).buttonStyle(V3ButtonStyle(kind: .ghost, height: 36)).disabled(busy)
                if kind != "detail" { Button(busy ? "保存中…" : "确认保存") { Task { await save() } }.buttonStyle(V3ButtonStyle(kind: .dark, height: 36)).disabled(busy || item == nil) }
            }.padding(.horizontal, 28).frame(height: 76).overlay(alignment: .top) { Rectangle().fill(V3.line).frame(height: 1) }
        }.interactiveDismissDisabled(busy).task {
            item = nil; kind = action.kind; start = action.start; end = action.end; busy = true
            do {
                let data = try await api.careerRequest(path: "/api/interview-sessions/\(action.interview!.id)", method: "GET", query: [:], body: nil)
                try Task.checkCancellation()
                item = ScheduledInterview(data["session"] ?? .null)
                fill()
            } catch { failure = explain(error) }
            busy = false
        }
    }
    private func display(_ date: Date) -> String { let f = DateFormatter(); f.dateFormat = "M月d日 HH:mm"; return f.string(from: date) }
    private func field(_ label: String, _ value: Binding<String>) -> some View { VStack(alignment: .leading, spacing: 6) { Text(label).font(.system(size: 12)); TextField(label, text: value, axis: .vertical).lineLimit(2...6).textFieldStyle(.roundedBorder) }.disabled(frozen != nil) }
    private func fill() {
        guard let item else { return }
        mode = item.raw.text("mode"); meeting = item.raw.text("meeting_url"); location = item.raw.text("location")
        interviewer = item.raw.text("interviewer_name"); interviewerTitle = item.raw.text("interviewer_title"); note = item.raw.text("preparation_note")
        questions = item.raw.text("questions_markdown"); review = item.raw.text("review_summary"); improvement = item.raw.text("improvement_markdown")
    }
    private func begin(_ command: String) {
        guard let item else { return }; kind = command; failure = nil; frozen = nil; removePlan = false
        start = CareerApplication.date(item.raw.text(command == "answer-plan" ? "answer_plan_start_at" : "start_at")) ?? item.start
        end = CareerApplication.date(item.raw.text(command == "answer-plan" ? "answer_plan_end_at" : "end_at")) ?? item.end
        fill()
    }
    private func save() async {
        guard let item, item.editable, !busy else { return }
        if ["reschedule", "answer-plan"].contains(kind) && !removePlan && end <= start { failure = "结束时间须晚于开始时间。"; return }
        if kind == "answer-plan" && !removePlan && (start < item.start || end > item.end) { failure = "个人作答计划必须位于开放窗口内。"; return }
        busy = true; failure = nil
        do {
            if frozen == nil {
                var body: [String: JSONValue] = ["base_lock_version": item.raw["lock_version"] ?? .number(1)]
                let f = ISO8601DateFormatter()
                switch kind {
                case "reschedule":
                    body["start_at"] = .string(f.string(from: start)); body["end_at"] = .string(f.string(from: end)); body["timezone"] = .string(TimeZone.current.identifier); body["allow_conflict"] = .bool(allowConflict)
                case "answer-plan":
                    body["answer_plan_start_at"] = removePlan ? .null : .string(f.string(from: start)); body["answer_plan_end_at"] = removePlan ? .null : .string(f.string(from: end))
                case "complete":
                    body["questions_markdown"] = .string(questions); body["review_summary"] = .string(review); body["improvement_markdown"] = .string(improvement)
                case "cancel": body["reason"] = reason.isEmpty ? .null : .string(reason)
                case "edit":
                    body["mode"] = .string(mode); body["meeting_url"] = meeting.isEmpty ? .null : .string(meeting); body["location"] = location.isEmpty ? .null : .string(location)
                    body["interviewer_name"] = interviewer.isEmpty ? .null : .string(interviewer); body["interviewer_title"] = interviewerTitle.isEmpty ? .null : .string(interviewerTitle); body["preparation_note"] = note.isEmpty ? .null : .string(note)
                default: throw APIError.invalidResponse
                }
                frozen = .object(body)
            }
            let path = "/api/interview-sessions/\(item.id)" + (kind == "edit" ? "" : "/\(kind)")
            _ = try await api.careerRequest(path: path, method: ["edit", "answer-plan"].contains(kind) ? "PUT" : "POST", query: [:], body: frozen)
            completed()
        } catch {
            if case APIError.server(let status, let code) = error, [400, 422, 409].contains(status), code != "INTERVIEW_EDIT_CONFLICT" { frozen = nil }
            failure = explain(error)
        }
        busy = false
    }
    private func explain(_ error: Error) -> String {
        if case APIError.unauthorized = error { return "登录已失效，请重新登录。"}
        if case APIError.server(let status, let code) = error {
            if status == 409 { return "时间或版本冲突（\(code)）。请确认时间；若记录已变化，请关闭并刷新。" }
            return "保存失败（\(code)），输入已保留。"
        }
        return "连接失败，结果尚未确认。重试会保留原版本，不会覆盖其他修改。"
    }
}
