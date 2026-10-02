import LinkResumeCore
import SwiftUI

private struct ScheduleAction: Identifiable {
    let id = UUID()
    var kind: String
    var interview: ScheduledInterview?
    var start: Date
    var end: Date
}

struct InterviewScheduleView: View {
    @Environment(SessionStore.self) private var session
    let requireAccount: () -> Void
    @State private var anchor = Date()
    @State private var mode = "month"
    @State private var query = ""
    @State private var includeCancelled = false
    @State private var interviews: [ScheduledInterview] = []
    @State private var applications: [CareerApplication] = []
    @State private var action: ScheduleAction?
    @State private var pending: ScheduleAction?
    @State private var refresh = UUID()
    @State private var loading = false
    @State private var failure: String?
    @State private var datePicker = false
    @State private var overflow: Date?
    private let calendar = Calendar.current
    private var account: String { if case .signedIn(let user) = session.phase { return user.id }; return "" }
    private var week: Date { ScheduleCalendar.weekStart(anchor) }
    private var month: Date { calendar.dateInterval(of: .month, for: anchor)!.start }
    private var visible: [ScheduledInterview] {
        interviews.filter { (includeCancelled || $0.raw.text("status") != "cancelled") && (query.isEmpty || ($0.company + $0.title + $0.label).localizedCaseInsensitiveContains(query)) }
    }
    private func plus(_ date: Date, _ days: Int) -> Date { calendar.date(byAdding: .day, value: days, to: date)! }
    private func format(_ date: Date, _ pattern: String) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN"); f.dateFormat = pattern; return f.string(from: date) }
    private func at(_ day: Date, minute: Int) -> Date { calendar.date(bySettingHour: minute / 60, minute: minute % 60, second: 0, of: day)! }
    private func items(_ day: Date) -> [ScheduledInterview] { visible.filter { $0.overlaps(calendar.startOfDay(for: day), plus(calendar.startOfDay(for: day), 1)) }.sorted { $0.start < $1.start } }
    private var periodStart: Date { mode == "month" ? month : week }
    private var periodEnd: Date { mode == "month" ? calendar.date(byAdding: .month, value: 1, to: month)! : plus(week, 7) }
    private var heading: String { mode == "month" ? format(month, "yyyy年 M月") : format(week, "M月d日") + " — " + format(plus(week, 6), "M月d日") }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("SCHEDULE · \(format(anchor, "yyyy")) 年 · \(mode == "month" ? "月视图" : mode == "week" ? "周视图" : "列表")").font(.system(size: 11)).foregroundStyle(Tokens.Color.textMuted)
                    Button { datePicker.toggle() } label: { HStack { Text(heading).font(.custom("Songti SC", size: 28).weight(.semibold)); Image(systemName: "chevron.down").font(.system(size: 12)) } }.buttonStyle(.plain)
                        .popover(isPresented: $datePicker) { DatePicker("选择日期", selection: $anchor, displayedComponents: .date).datePickerStyle(.graphical).padding(16).frame(width: 300) }
                    Text(account.isEmpty ? "游客模式 · 登录后管理面试安排" : "\(mode == "month" ? "本月" : "本周") \(visible.filter { $0.raw.text("status") != "cancelled" && $0.overlaps(periodStart, periodEnd) }.count) 个日程")
                        .font(.system(size: 13)).foregroundStyle(Tokens.Color.textMuted)
                }
                Spacer()
                Picker("日程视图", selection: $mode) { Text("月").tag("month"); Text("周").tag("week"); Text("列表").tag("list") }.pickerStyle(.segmented).labelsHidden().frame(width: 145)
                Button { shift(-1) } label: { Image(systemName: "chevron.left") }.buttonStyle(.plain).accessibilityLabel("上一段")
                Button("今天") { anchor = Date() }.buttonStyle(.plain)
                Button { shift(1) } label: { Image(systemName: "chevron.right") }.buttonStyle(.plain).accessibilityLabel("下一段")
            }
            HStack {
                TextField("搜索公司、岗位或面试", text: $query).textFieldStyle(.roundedBorder).frame(maxWidth: 260)
                Menu("筛选") { Toggle("显示已取消安排", isOn: $includeCancelled) }
                Button { refresh = UUID() } label: { Image(systemName: "arrow.clockwise") }.buttonStyle(.plain).accessibilityLabel("刷新排期")
                if loading { ProgressView().controlSize(.small) }
                Spacer()
                Button("新建面试") { create(start: at(calendar.startOfDay(for: anchor), minute: 9 * 60)) }.buttonStyle(WebActionStyle())
            }
            if let failure { HStack { Text(failure).foregroundStyle(.red); Button("重试") { refresh = UUID() } }.font(.system(size: 12)) }
            if mode == "month" { monthView }
            else if mode == "week" { weekView }
            else { scheduleList }
            upcoming
        }.frame(maxWidth: 1200).padding(.horizontal, 32).padding(.top, 52).padding(.bottom, 20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .task(id: account + refresh.uuidString) { await load() }
            .onChange(of: account) { _, id in
                interviews = []; applications = []; action = nil; query = ""; overflow = nil
                if id.isEmpty { pending = nil }
                else if let value = pending { action = value; pending = nil }
            }
            .sheet(item: $action) { value in
                if value.kind == "create" {
                    CareerForm(action: JobAction(kind: "schedule", application: nil, start: value.start, end: value.end), applications: applications, api: session.api,
                               completed: { action = nil; refresh = UUID() }, close: { action = nil }).frame(width: 880, height: 780)
                } else {
                    ScheduleSessionForm(action: value, interviews: interviews, api: session.api, completed: { action = nil; refresh = UUID() }, close: { action = nil }).frame(width: 650, height: 660)
                }
            }
    }
    private func shift(_ amount: Int) {
        anchor = calendar.date(byAdding: mode == "month" ? .month : .day, value: mode == "month" ? amount : 7 * amount, to: anchor)!
        overflow = nil
    }
    private func create(start: Date, end: Date? = nil) {
        let value = ScheduleAction(kind: "create", start: start, end: end ?? start.addingTimeInterval(3600))
        if account.isEmpty { pending = value; requireAccount() } else { action = value }
    }
    private func open(_ item: ScheduledInterview, kind: String = "detail", start: Date? = nil, end: Date? = nil) {
        action = ScheduleAction(kind: kind, interview: item, start: start ?? item.start, end: end ?? item.end)
    }
    private func color(_ item: ScheduledInterview) -> Color {
        Color(hex: ["blue": 0x3976CF, "green": 0x478B66, "purple": 0x8768B7, "red": 0xBC5D58, "orange": 0xC68842, "gray": 0x96968F][item.raw.text("calendar_color")] ?? 0x3976CF)
    }
    private var monthView: some View {
        let days = ScheduleCalendar.monthDays(anchor)
        return VStack(spacing: 0) {
            HStack(spacing: 0) { ForEach(["一", "二", "三", "四", "五", "六", "日"], id: \.self) { Text("周" + $0).font(.system(size: 11)).foregroundStyle(Tokens.Color.textMuted).frame(maxWidth: .infinity).frame(height: 30) } }
            GeometryReader { viewport in
                let height = max(70, viewport.size.height / CGFloat(days.count / 7))
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 0), count: 7), spacing: 0) {
                    ForEach(days, id: \.self) { day in
                        let events = items(day)
                        let capacity = max(1, Int((height - 42) / 28) - 1)
                        VStack(alignment: .leading, spacing: 4) {
                            Button { anchor = day; mode = "week" } label: { Text(format(day, "d")).font(.system(size: 12, weight: calendar.isDateInToday(day) ? .bold : .regular)).foregroundStyle(calendar.isDate(day, equalTo: month, toGranularity: .month) ? Color.primary : Tokens.Color.textMuted) }.buttonStyle(.plain)
                            ForEach(events.prefix(capacity)) { item in
                                Button { open(item) } label: {
                                    HStack(spacing: 4) { Circle().fill(color(item)).frame(width: 5, height: 5); Text(format(item.openWindow ? item.end : item.start, "HH:mm") + " " + item.caption).lineLimit(1) }.font(.system(size: 10)).frame(maxWidth: .infinity, alignment: .leading).frame(height: 24)
                                }.buttonStyle(.plain).draggable(item.editable && !item.openWindow ? item.id : "")
                            }
                            if events.count > capacity {
                                Button("另有 \(events.count - capacity) 项") { overflow = day }.font(.system(size: 10)).buttonStyle(.plain)
                                    .popover(isPresented: Binding(get: { overflow == day }, set: { if !$0 { overflow = nil } })) {
                                        VStack(alignment: .leading, spacing: 12) {
                                            Text(format(day, "M月d日")).font(.headline)
                                            ForEach(events) { item in Button(format(item.start, "HH:mm") + " " + item.caption) { overflow = nil; open(item) }.buttonStyle(.plain) }
                                        }.padding(20).frame(minWidth: 260)
                                    }
                            }
                            Spacer(minLength: 0)
                        }.padding(9).frame(height: height, alignment: .topLeading).frame(maxWidth: .infinity, alignment: .leading)
                            .background(calendar.isDateInToday(day) ? Color(hex: 0xF7F7F5) : .white)
                            .overlay(Rectangle().stroke(Color(hex: 0xE8E8E4), lineWidth: 0.5))
                            .contentShape(Rectangle()).onTapGesture(count: 2) { create(start: at(day, minute: 9 * 60)) }
                            .dropDestination(for: String.self) { ids, _ in
                                guard let item = interviews.first(where: { $0.id == ids.first }), item.editable, !item.openWindow else { return false }
                                let parts = calendar.dateComponents([.hour, .minute], from: item.start)
                                let from = at(day, minute: (parts.hour ?? 9) * 60 + (parts.minute ?? 0))
                                open(item, kind: "reschedule", start: from, end: from.addingTimeInterval(item.end.timeIntervalSince(item.start))); return true
                            }
                    }
                }
            }
        }
    }
    private var weekView: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                Text("").frame(width: 45)
                ForEach(0..<7) { index in let day = plus(week, index); Text(format(day, "EEE d")).font(.system(size: 12)).frame(maxWidth: .infinity).frame(height: 32).foregroundStyle(calendar.isDateInToday(day) ? Color(hex: 0x3976CF) : .primary) }
            }
            let windows = visible.filter { $0.openWindow && $0.overlaps(week, plus(week, 7)) }
            if !windows.isEmpty {
                ScrollView(.horizontal) { HStack { Text("作答窗口").font(.system(size: 11)); ForEach(windows) { item in Button(item.caption + " · 截止 " + format(item.end, "M/d HH:mm")) { open(item) }.buttonStyle(.plain).font(.system(size: 11)) } } }.frame(height: 32)
            }
            GeometryReader { available in
            ScrollViewReader { proxy in
                ScrollView([.vertical, .horizontal]) {
                    GeometryReader { viewport in
                        let width = (viewport.size.width - 45) / 7
                        ZStack(alignment: .topLeading) {
                            VStack(spacing: 0) {
                                ForEach(0..<24) { hour in
                                    HStack { Text(String(format: "%02d:00", hour)).font(.system(size: 10)).foregroundStyle(Tokens.Color.textMuted).frame(width: 40, alignment: .trailing); Rectangle().fill(Color(hex: 0xE8E8E4)).frame(height: 0.5) }.frame(height: 56, alignment: .top).id("hour\(hour)")
                                }
                            }
                            HStack(spacing: 0) {
                                Color.clear.frame(width: 45)
                                ForEach(0..<7) { index in
                                    let day = plus(week, index)
                                    Rectangle().fill(Color.clear).overlay(Rectangle().stroke(Color(hex: 0xE8E8E4), lineWidth: 0.5)).frame(width: width, height: 1344).contentShape(Rectangle())
                                        .gesture(DragGesture(minimumDistance: 8).onEnded { selection in
                                            let from = at(day, minute: min(1425, max(0, Int((min(selection.startLocation.y, selection.location.y) / 56 * 60 / 15).rounded()) * 15)))
                                            let until = at(day, minute: min(1439, max(15, Int((max(selection.startLocation.y, selection.location.y) / 56 * 60 / 15).rounded()) * 15)))
                                            if until > from { create(start: from, end: until) }
                                        })
                                        .onTapGesture(count: 2) { point in create(start: at(day, minute: min(1425, max(0, Int((point.y / 56 * 60 / 15).rounded()) * 15)))) }
                                        .dropDestination(for: String.self) { ids, point in
                                            guard let original = interviews.first(where: { $0.id == ids.first }), let item = original.timed, item.editable else { return false }
                                            let from = at(day, minute: min(1425, max(0, Int((point.y / 56 * 60 / 15).rounded()) * 15)))
                                            open(original, kind: item.openWindow ? "answer-plan" : "reschedule", start: from, end: from.addingTimeInterval(item.end.timeIntervalSince(item.start))); return true
                                        }
                                }
                            }
                            ForEach(0..<7) { index in
                                let day = plus(week, index)
                                let events = visible.compactMap(\.timed).filter { $0.overlaps(day, plus(day, 1)) }
                                let lanes = ScheduleCalendar.lanes(events)
                                ForEach(events) { item in
                                    let lane = lanes[item.id] ?? (0, 1)
                                    let start = max(day, item.start); let end = min(plus(day, 1), item.end)
                                    let minute = CGFloat(calendar.component(.hour, from: start) * 60 + calendar.component(.minute, from: start))
                                    let height = max(26, end.timeIntervalSince(start) / 3600 * 56)
                                    let cellWidth = width / CGFloat(lane.count) - 4
                                    VStack(alignment: .leading, spacing: 3) {
                                        if item.editable { resizeHandle(item, top: true) }
                                        Text(item.caption).font(.system(size: 10, weight: .medium)).lineLimit(2)
                                        Text(format(item.start, "HH:mm") + "–" + format(item.end, "HH:mm")).font(.system(size: 9))
                                        Spacer(minLength: 0)
                                        if item.editable { resizeHandle(item, top: false) }
                                    }.padding(4).frame(width: cellWidth, height: height).background(color(item).opacity(0.13), in: RoundedRectangle(cornerRadius: 5))
                                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(color(item).opacity(0.4)))
                                        .onTapGesture { open(interviews.first { $0.id == item.id } ?? item) }.draggable(item.editable ? item.id : "")
                                        .offset(x: 45 + CGFloat(index) * width + CGFloat(lane.index) * width / CGFloat(lane.count) + 2, y: minute / 60 * 56)
                                }
                            }
                        }
                    }.frame(width: max(700, available.size.width), height: 1344)
                }.task(id: week) { proxy.scrollTo("hour8", anchor: .top) }
            }
            }
        }
    }
    private func resizeHandle(_ item: ScheduledInterview, top: Bool) -> some View {
        Capsule().fill(color(item).opacity(0.5)).frame(height: 4).contentShape(Rectangle())
            .gesture(DragGesture().onEnded { drag in
                let minutes = Int((drag.translation.height / 56 * 60 / 15).rounded()) * 15
                let from = top ? item.start.addingTimeInterval(Double(minutes) * 60) : item.start
                let until = top ? item.end : item.end.addingTimeInterval(Double(minutes) * 60)
                if until.timeIntervalSince(from) >= 900 { open(interviews.first { $0.id == item.id } ?? item, kind: item.openWindow ? "answer-plan" : "reschedule", start: from, end: until) }
            })
    }
    private var scheduleList: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                Text("时间                 公司 / 岗位                 阶段与状态").font(.system(size: 11)).foregroundStyle(Tokens.Color.textMuted)
                ForEach(visible.filter { $0.overlaps(periodStart, periodEnd) }.sorted { $0.start < $1.start }) { item in
                    Button { open(item) } label: { HStack { Text(format(item.start, "M/d HH:mm")).frame(width: 110, alignment: .leading); Text(item.company + " · " + item.title).frame(maxWidth: .infinity, alignment: .leading); Text(item.label + " · " + item.status(at: Date())) }.font(.system(size: 12)).padding(.vertical, 12) }.buttonStyle(.plain)
                    Divider()
                }
            }
        }
    }
    private var upcoming: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("接下来").font(.system(size: 11)).foregroundStyle(Tokens.Color.textMuted)
            let next = ScheduleCalendar.upcoming(visible, now: Date())
            if next.isEmpty { Text(account.isEmpty ? "登录后查看你的安排；也可以先浏览日历。" : "接下来没有安排的面试或笔试").font(.system(size: 12)).foregroundStyle(Tokens.Color.textMuted) }
            ForEach(next) { item in
                Button { open(item) } label: { HStack { Circle().fill(color(item)).frame(width: 6, height: 6); Text(format(item.openWindow ? item.end : item.start, "M/d HH:mm")).frame(width: 105, alignment: .leading); Text(item.company + " · " + item.title + " " + item.label).lineLimit(1); Spacer(); Text(item.status(at: Date())).foregroundStyle(Tokens.Color.textMuted) }.font(.system(size: 12)) }.buttonStyle(.plain)
            }
        }.frame(minHeight: 70, alignment: .top)
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
            HStack { Text(heading).font(.custom("Songti SC", size: 24)); Spacer(); Button("关闭", action: close).disabled(busy) }.padding(24)
            Divider()
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
            Divider()
            HStack {
                if kind != "detail" { Button("返回详情") { kind = "detail"; frozen = nil }.disabled(busy) }
                Spacer()
                if kind != "detail" { Button(busy ? "正在保存…" : "确认保存") { Task { await save() } }.buttonStyle(WebActionStyle()).disabled(busy || item == nil) }
            }.padding(20)
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
