import AppKit
import LinkResumeCore
import SwiftUI
import UniformTypeIdentifiers

struct JobAction: Identifiable {
    let id = UUID()
    let kind: String
    let application: CareerApplication?
    var stage: String = "interview"
    var label: String = "一面"
    var round: Int? = nil
    var start: Date? = nil
    var end: Date? = nil
    /// Web's 480pt apply dialog: a pending card dropped on 筛选中 only needs the date and channel.
    var compact = false
}

/// 04.1 岗位看板: page head, four stats, board/list toolbar, stage columns and cards.
/// Mirrors Web `InterviewCenterPage` (ApplicationsHeader / ApplicationViewControls) and `ApplicationsBoard.tsx`.
struct JobsBoardView: View {
    @Environment(SessionStore.self) private var session
    let requireAccount: () -> Void
    @State private var applications: [CareerApplication] = []
    @State private var sessions: [JSONValue] = []
    @State private var overview: JSONValue = .null
    @State private var logos: [String: NSImage] = [:]
    @State private var pendingLogos = Set<String>()
    @State private var loading = false
    @State private var failure: String?
    @State private var filterOpen = false
    @State private var stagesOpen = false
    @State private var query = ""
    @State private var mode = "board"
    @State private var earliest = false
    @State private var grouped = false
    @State private var hidden = Set<String>()
    @State private var order: [String] = []
    @State private var selected: CareerApplication?
    @State private var action: JobAction?
    @State private var pendingAction: String?
    @State private var notice: String?
    @State private var hoveredCard: String?
    @State private var refreshing = UUID()
    private let categories: [(String, String)] = [("internship", "实习"), ("campus", "校招"), ("full_time", "正式"), ("", "未分类")]
    private var account: String { if case .signedIn(let user) = session.phase { return user.id }; return "" }
    private var allColumns: [String] {
        let available = CareerStage.columns(applications)
        return order.filter { available.contains($0) } + available.filter { !order.contains($0) }
    }
    private var visible: [CareerApplication] {
        let needle = query.trimmingCharacters(in: .whitespaces)
        return CareerStage.sorted(applications.filter { item in
            needle.isEmpty || [item.company, item.title, CareerBoard.projection(item.raw).stageLabel].contains { $0.localizedCaseInsensitiveContains(needle) }
        }, earliest: earliest)
    }
    private func columnStage(_ column: String) -> String { applications.first { $0.column == column }?.stage ?? (column.hasPrefix("interview:") ? "interview" : column) }
    private func columnTitle(_ column: String) -> String { column.hasPrefix("interview:") ? String(column.dropFirst(10)) : CareerStage.label(column) }
    private func completed(_ item: CareerApplication) -> Bool { item.completedSchedule != nil }

    var body: some View {
        Group {
            if let selected {
                CareerApplicationDetailView(application: selected, api: session.api, back: { self.selected = nil; refreshing = UUID() }, perform: { kind, app in
                    action = JobAction(kind: kind, application: app,
                        stage: kind == "apply" ? "screening" : kind == "schedule-current" ? app.stage : CareerStage.nextStages(app).first(where: { $0 == "interview" }) ?? CareerStage.nextStages(app).first ?? "screening",
                        label: kind == "stage" ? Self.roundLabel((app.raw["current_round_no"]?.integer ?? 0) + 1) : app.stageLabel,
                        round: kind == "schedule-current" ? app.raw["current_round_no"]?.integer : nil)
                }).id(refreshing)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    V3PageHead(eyebrow: ["JOBS", "本周 " + weekLabel], title: "岗位看板", subtitle: subtitle) {
                        Button { open("arranged") } label: { Image(systemName: "calendar").font(.system(size: 12)).foregroundStyle(V3.sub); Text("已有面试安排") }
                            .buttonStyle(V3ButtonStyle(kind: .ghost, width: 124))
                        Button("导入岗位") { open("import") }.buttonStyle(V3ButtonStyle(kind: .dark, width: 100))
                    }
                    statistics.padding(.top, 29)
                    if let notice {
                        HStack(spacing: 10) {
                            Text(notice).font(V3.sans(12.5)).foregroundStyle(V3.txt)
                            Spacer()
                            Button { self.notice = nil } label: { Image(systemName: "xmark").font(.system(size: 10)) }.buttonStyle(.plain).foregroundStyle(V3.fnt).accessibilityLabel("关闭提示")
                        }.padding(.horizontal, 14).frame(height: 36).background(V3.orangeSoft, in: RoundedRectangle(cornerRadius: 8)).padding(.top, 14)
                    }
                    if loading {
                        ProgressView("正在加载求职数据…").font(V3.sans(13)).frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else if let failure {
                        VStack(spacing: 16) {
                            Text(failure).font(V3.sans(13)).foregroundStyle(V3.red)
                            Button("重试") { refreshing = UUID() }.buttonStyle(V3ButtonStyle(kind: .ghost))
                        }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        controls.padding(.top, 20).padding(.bottom, 18)
                        if visible.isEmpty { empty }
                        else if mode == "list" { list }
                        else { boardArea }
                    }
                }
                .padding(.horizontal, 32).padding(.top, 52).padding(.bottom, 20)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task(id: account + refreshing.uuidString) { await load() }
        .sheet(item: $action) { item in
            CareerForm(action: item, applications: applications, api: session.api, completed: { action = nil; refreshing = UUID() }, close: { action = nil })
                .frame(width: item.compact ? 480 : 880, height: item.compact ? nil : 780)
        }
        .onChange(of: account) { _, new in
            applications = []; sessions = []; overview = .null; logos = [:]; pendingLogos = []; query = ""; hidden = []; order = []; action = nil; selected = nil; notice = nil
            if new.isEmpty { pendingAction = nil }
            else if let pendingAction { action = JobAction(kind: pendingAction, application: nil); self.pendingAction = nil }
        }
    }

    // MARK: Head and statistics

    private var weekStart: Date {
        var calendar = Calendar.current; calendar.firstWeekday = 2
        return calendar.dateInterval(of: .weekOfYear, for: Date())?.start ?? Date()
    }
    private var weekLabel: String {
        let formatter = DateFormatter(); formatter.dateFormat = "MM-dd"
        return formatter.string(from: weekStart) + " 至 " + formatter.string(from: Calendar.current.date(byAdding: .day, value: 6, to: weekStart) ?? weekStart)
    }
    private var activeCount: Int { applications.filter { $0.raw.text("status") == "active" && $0.raw.text("archived_at").isEmpty && $0.raw.text("lifecycle_status") != "terminated" }.count }
    private var weeklyInterviews: Int {
        if let value = overview["metrics"]?["weekly_interviews"], value != .null { return value.integer }
        let end = Calendar.current.date(byAdding: .day, value: 7, to: weekStart) ?? weekStart
        return sessions.filter { $0.text("status") != "cancelled" && (CareerApplication.date($0.text("start_at")).map { $0 >= weekStart && $0 < end } ?? false) }.count
    }
    private var offers: Int {
        if let value = overview["metrics"]?["offers_received"], value != .null { return value.integer }
        return applications.filter { $0.raw.text("current_stage_type") == "offer" && $0.raw.text("offer_status") != "declined" }.count
    }
    private var pendingOffers: Int { applications.filter { $0.raw.text("current_stage_type") == "offer" && $0.raw.text("offer_status") == "received" && $0.raw.text("status") == "active" }.count }
    private var subtitle: String {
        guard !account.isEmpty, !loading else { return "登录后查看你的求职进程" }
        return "\(activeCount) 个进行中 · \(weeklyInterviews) 场面试" + (pendingOffers > 0 ? " · \(pendingOffers) 个 Offer 待回复" : "")
    }
    private var statistics: some View {
        let applied = applications.filter { $0.raw.text("phase") != "pending" }
        let reached = applied.filter { $0.raw.text("current_stage_type") != "screening" }.count
        let ready = !account.isEmpty && !loading
        let values: [(String, String, String?)] = [
            ("投递总数", ready ? "\(applied.count)" : "—", nil),
            ("本周面试", ready ? "\(weeklyInterviews)" : "—", nil),
            ("面试转化率", ready && !applied.isEmpty ? "\(Int((Double(reached) / Double(applied.count) * 100).rounded()))%" : "—", nil),
            ("Offer", ready ? "\(offers)" : "—", pendingOffers > 0 ? "待回复" : nil),
        ]
        return HStack(spacing: 0) {
            ForEach(Array(values.enumerated()), id: \.offset) { index, item in
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(item.1).font(V3.number(28)).foregroundStyle(V3.txt)
                        if let extra = item.2 { Text(extra).font(V3.sans(12, weight: .medium)).foregroundStyle(V3.fnt) }
                    }.frame(height: 36)
                    Text(item.0).font(V3.sans(12)).foregroundStyle(V3.fnt)
                }
                .frame(maxWidth: .infinity, alignment: .topLeading).padding(.leading, index == 0 ? 0 : 20)
                .overlay(alignment: .leading) { if index > 0 { Rectangle().fill(V3.line).frame(width: 1) } }
            }
        }
        .frame(height: 59, alignment: .top).padding(.bottom, 13)
        .overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
        .accessibilityElement(children: .contain).accessibilityLabel("岗位看板统计")
    }

    // MARK: Toolbar

    private var controls: some View {
        HStack(spacing: 16) {
            V3Segmented(options: [("board", "看板"), ("list", "列表")], selection: $mode, segmentWidth: 60).accessibilityLabel("显示方式")
            Spacer()
            HStack(spacing: 18) {
                V3SearchField(text: $query, placeholder: "搜索公司、岗位…", width: 180, height: 30)
                Menu {
                    Button { earliest = false } label: { if !earliest { Label("最近排期", systemImage: "checkmark") } else { Text("最近排期") } }
                    Button { earliest = true } label: { if earliest { Label("最先添加", systemImage: "checkmark") } else { Text("最先添加") } }
                    Divider()
                    Button("刷新岗位") { refreshing = UUID() }
                } label: { toolbarLink("排序", icon: "list.bullet") }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                Button { filterOpen.toggle() } label: { toolbarLink(hidden.isEmpty && !grouped ? "筛选" : "筛选 · 已启用", icon: "line.3.horizontal.decrease") }
                    .buttonStyle(.plain).accessibilityLabel("视图设置")
                    .popover(isPresented: $filterOpen, arrowEdge: .bottom) { filterPanel }
            }
        }.frame(height: 30)
    }
    private func toolbarLink(_ title: String, icon: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 12)).foregroundStyle(V3.fnt)
            Text(title).font(V3.sans(14)).foregroundStyle(V3.sub)
        }.frame(height: 28).contentShape(Rectangle())
    }
    private var filterPanel: some View {
        VStack(alignment: .leading, spacing: 0) {
            filterField("分组") {
                Picker("", selection: $grouped) { Text("不分组").tag(false); Text("求职分类").tag(true) }.labelsHidden().controlSize(.small)
            }
            filterField("排序") {
                Picker("", selection: $earliest) { Text("最近排期").tag(false); Text("最先添加").tag(true) }.labelsHidden().controlSize(.small)
            }
            if mode == "board" {
                Rectangle().fill(V3.line).frame(height: 1).padding(.vertical, 4)
                Button { stagesOpen.toggle() } label: {
                    HStack { Text("展示阶段").font(V3.sans(12.5)).foregroundStyle(V3.txt); Spacer(); Image(systemName: stagesOpen ? "chevron.up" : "chevron.down").font(.system(size: 10)).foregroundStyle(V3.fnt) }
                        .padding(.horizontal, 10).frame(height: 34).contentShape(Rectangle())
                }.buttonStyle(.plain)
                if stagesOpen {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(allColumns, id: \.self) { column in
                                Toggle(isOn: Binding(get: { !hidden.contains(column) }, set: { if $0 { hidden.remove(column) } else { hidden.insert(column) } })) {
                                    Text(columnTitle(column)).font(V3.sans(12.5)).foregroundStyle(V3.txt).frame(maxWidth: .infinity, alignment: .leading)
                                }.toggleStyle(.checkbox).padding(.horizontal, 10).frame(height: 34)
                            }
                        }
                    }.frame(maxHeight: 260)
                }
            }
        }.padding(6).frame(width: 240)
    }
    private func filterField<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 8) { Text(title).font(V3.sans(12)).foregroundStyle(V3.sub).frame(width: 44, alignment: .leading); content() }
            .padding(.horizontal, 6).padding(.vertical, 4)
    }

    // MARK: Board

    private var boardArea: some View {
        GeometryReader { viewport in
            let width = min(280, max(220, (viewport.size.width - 40) / 5))
            ScrollView(grouped ? [.horizontal, .vertical] : .horizontal) {
                if grouped {
                    VStack(alignment: .leading, spacing: 24) {
                        ForEach(categories.indices, id: \.self) { index in
                            let key = categories[index].0, label = categories[index].1
                            let items = visible.filter { $0.category == key || (key.isEmpty && !["internship", "campus", "full_time"].contains($0.category)) }
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 8) { Text(label).font(V3.sans(12, weight: .medium)); Text("\(items.count)").font(V3.sans(11)).foregroundStyle(V3.fnt) }
                                board(items, width: width, height: nil)
                            }
                        }
                    }.padding(.bottom, 24)
                } else {
                    board(visible, width: width, height: max(320, viewport.size.height - 4))
                }
            }.scrollIndicators(.automatic)
        }
    }
    private func board(_ items: [CareerApplication], width: CGFloat, height: CGFloat?) -> some View {
        HStack(alignment: .top, spacing: 10) {
            ForEach(allColumns.filter { !hidden.contains($0) }, id: \.self) { column in
                let matches = items.filter { $0.column == column }
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 7) {
                        Circle().fill(columnTone(column)).frame(width: 7, height: 7)
                        Text(columnTitle(column)).font(V3.sans(12, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1)
                        Text("\(matches.count)").font(V3.sans(11, weight: .medium)).foregroundStyle(V3.fnt)
                    }
                    .padding(.horizontal, 6).frame(height: 40).frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                    .help("拖动调整栏目位置")
                    .draggable("column:" + column)
                    .contextMenu { Button("向左移动") { moveColumn(column, -1) }; Button("向右移动") { moveColumn(column, 1) } }
                    ScrollView(.vertical) {
                        VStack(spacing: 8) {
                            if matches.isEmpty { Text("暂无进程").font(V3.sans(11)).foregroundStyle(V3.fnt2).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 12).padding(.horizontal, 2) }
                            ForEach(matches) { item in card(item).draggable(item.movable ? "job:" + item.id : "locked:" + item.id) }
                        }
                    }.scrollIndicators(.hidden).scrollDisabled(height == nil)
                }
                .padding(.horizontal, 6).padding(.bottom, 6)
                .frame(width: width, alignment: .topLeading)
                .frame(minHeight: height == nil ? 160 : nil, maxHeight: height, alignment: .topLeading)
                .frame(height: height, alignment: .topLeading)
                .background(V3.column, in: RoundedRectangle(cornerRadius: 10))
                .dropDestination(for: String.self) { values, _ in drop(values.first ?? "", on: column) }
            }
        }
    }
    private func drop(_ value: String, on column: String) -> Bool {
        if value.hasPrefix("column:") {
            let source = String(value.dropFirst(7)); var columns = allColumns
            guard source != column, let from = columns.firstIndex(of: source), let to = columns.firstIndex(of: column) else { return false }
            columns.remove(at: from); columns.insert(source, at: to); order = columns; return true
        }
        let id = value.hasPrefix("job:") ? String(value.dropFirst(4)) : value.hasPrefix("locked:") ? String(value.dropFirst(7)) : ""
        guard let item = applications.first(where: { $0.id == id }), item.column != column else { return false }
        if let reason = dropBlockReason(item, column: column) { notice = reason; return false }
        let target = columnStage(column)
        if column == "ended" { action = JobAction(kind: "terminate", application: item); return true }
        action = JobAction(kind: item.stage == "pending" ? "apply" : "stage", application: item, stage: target,
            label: target == "interview" ? (applications.contains { $0.column == column } ? columnTitle(column) : "一面") : CareerStage.label(target),
            round: applications.first { $0.column == column }?.raw["current_round_no"]?.integer,
            compact: item.stage == "pending" && target == "screening")
        return true
    }
    /// `validateApplicationDrop` copy for rejected moves.
    private func dropBlockReason(_ item: CareerApplication, column: String) -> String? {
        if !item.raw.text("archived_at").isEmpty { return "该求职流程已归档，不能拖入其他状态栏。" }
        if item.ended { return "该求职流程已经结束，不能拖入其他状态栏。" }
        if item.stage == "offer" && column != "ended" { return "该求职流程已经进入 Offer 阶段，只能拖到「已结束」。" }
        if item.stage == "pending" && column == "pending" { return "该记录已经位于待投递。" }
        if CareerStage.canAdvance(item, to: column, stage: columnStage(column)) { return nil }
        if column.hasPrefix("interview:") && item.column.hasPrefix("interview:") { return "不能拖回当前或更早的面试阶段。" }
        if ["assessment", "written_test"].contains(column) { return "当前已经在\(columnTitle(item.column))，不能退回\(columnTitle(column))。" }
        return "只能拖动到后续的测评、笔试、面试或 Offer 阶段。"
    }
    private func moveColumn(_ column: String, _ direction: Int) {
        var columns = allColumns
        guard let index = columns.firstIndex(of: column), columns.indices.contains(index + direction) else { return }
        columns.swapAt(index, index + direction); order = columns
    }
    private func columnTone(_ key: String) -> Color {
        if key.hasPrefix("interview") || key == "ai_interview" { return V3.blue }
        if ["assessment", "written_test"].contains(key) { return V3.orange }
        return key == "offer" ? V3.green : V3.fnt
    }
    private func toneColor(_ tone: CareerTone) -> Color {
        switch tone {
        case .blue: return V3.blue
        case .orange: return V3.orange
        case .green: return V3.green
        case .red: return V3.red
        case .gray, .dark: return V3.fnt
        }
    }
    private func card(_ item: CareerApplication) -> some View {
        let done = completed(item)
        let status = CareerBoard.cardStatus(item.raw, completed: done)
        let tone = CareerBoard.tone(item.raw, completed: done)
        let today = done ? nil : CareerBoard.today(item.raw)
        let time = done ? nil : CareerBoard.cardTime(item.raw)
        let hovering = hoveredCard == item.id
        return ZStack(alignment: .topLeading) {
            Text(item.company + " · " + item.title).font(V3.sans(12, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1)
                .padding(.trailing, 22).frame(height: 14).help(item.company + " · " + item.title)
            if !item.category.isEmpty, let label = categories.first(where: { $0.0 == item.category })?.1 {
                V3Chip(label: label, height: 20, size: 10.5).offset(y: 24)
            }
            HStack(spacing: 6) {
                if let today {
                    Text(today).font(V3.number(10, weight: .medium)).foregroundStyle(.white).padding(.horizontal, 7).frame(height: 20)
                        .background(V3.txt, in: RoundedRectangle(cornerRadius: 5)).accessibilityLabel(status)
                } else {
                    Circle().fill(toneColor(tone)).frame(width: 5, height: 5)
                    Text(status).font(V3.sans(10.5)).foregroundStyle(tone == .red ? V3.red : V3.fnt).lineLimit(1)
                }
                Spacer(minLength: 26)
            }.frame(height: 20).frame(maxHeight: .infinity, alignment: .bottom).padding(.bottom, -6).help(time ?? "")
        }
        .padding(11).frame(maxWidth: .infinity, alignment: .topLeading).frame(height: 88)
        .overlay(alignment: .bottomTrailing) { logo(item).padding(.trailing, 11).padding(.bottom, 7) }
        .overlay(alignment: .topTrailing) {
            Menu { cardMenu(item) } label: {
                Image(systemName: "ellipsis").font(.system(size: 13, weight: .medium)).foregroundStyle(V3.txt)
                    .frame(width: 22, height: 22).background(V3.field, in: RoundedRectangle(cornerRadius: 6))
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .opacity(hovering ? 1 : 0).padding(6)
            .accessibilityLabel("更多求职操作 \(item.company) \(item.title)")
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).stroke(hovering ? V3.sk2 : Color(hex: 0xEBEBE7)))
        .shadow(color: .black.opacity(hovering ? 0.06 : 0.04), radius: hovering ? 4 : 1, y: hovering ? 2 : 1)
        .contentShape(RoundedRectangle(cornerRadius: 8))
        .onHover { inside in hoveredCard = inside ? item.id : (hoveredCard == item.id ? nil : hoveredCard) }
        .onTapGesture { selected = item }
        .contextMenu { cardMenu(item) }
        .accessibilityElement(children: .combine).accessibilityLabel("\(item.company) \(item.title)，\(status)").accessibilityAddTraits(.isButton)
        .task(id: account + item.raw.text("company_logo_url")) { await loadLogo(item) }
    }
    @ViewBuilder private func cardMenu(_ item: CareerApplication) -> some View {
        Button { selected = item } label: { Label("查看详情", systemImage: "eye") }
        if item.column != "ended" && !item.ended {
            Button("修改分类") { action = JobAction(kind: "category", application: item) }
            Button { advance(item) } label: { Label("推进流程", systemImage: "arrow.right") }.disabled(!item.movable)
            if item.raw.text("offer_status") == "none" || item.raw.text("offer_status").isEmpty {
                Button(role: .destructive) { action = JobAction(kind: "terminate", application: item) } label: { Label("终止求职", systemImage: "nosign") }
            }
        } else if item.column == "ended" {
            Button(role: .destructive) { action = JobAction(kind: "delete", application: item) } label: { Label("删除岗位", systemImage: "trash") }
        }
    }
    /// `applicationAdvanceAction`: open the stage dialog with the next step in the flow selected.
    private func advance(_ item: CareerApplication) {
        if item.stage == "pending" { action = JobAction(kind: "apply", application: item, stage: "screening", label: "筛选中"); return }
        guard let next = CareerBoard.advanceStage(item) else { return }
        let round = (item.raw["current_round_no"]?.integer ?? 0) + 1
        action = JobAction(kind: "stage", application: item, stage: next.stage, label: next.label.isEmpty ? Self.roundLabel(round) : next.label)
    }
    /// `interviewRoundLabel`.
    static func roundLabel(_ round: Int) -> String { round <= 1 ? "一面" : round == 2 ? "二面" : "第 \(round) 轮" }
    private func logo(_ item: CareerApplication) -> some View {
        Group {
            if let image = logos[item.id] { Image(nsImage: image).resizable().scaledToFit() }
            else { Text(String(item.company.trimmingCharacters(in: .whitespaces).prefix(1)).isEmpty ? "企" : String(item.company.trimmingCharacters(in: .whitespaces).prefix(1))).font(V3.sans(9, weight: .semibold)).foregroundStyle(V3.sub) }
        }
        .frame(width: 20, height: 20).background(V3.field).clipShape(Circle())
        .overlay(Circle().stroke(Color(hex: 0xEBEBE7))).accessibilityHidden(true)
    }
    private func loadLogo(_ item: CareerApplication) async {
        guard let logo = item.logoRequest, logos[item.id] == nil, !pendingLogos.contains(item.id), logos.count + pendingLogos.count < 128 else { return }
        let owner = account; pendingLogos.insert(item.id)
        defer { if owner == account { pendingLogos.remove(item.id) } }
        do {
            let result = try await session.api.careerRequest(path: logo.path, method: "GET", query: ["v": logo.revision], body: nil)
            try Task.checkCancellation()
            if owner == account, let data = Data(base64Encoded: result.text("image_base64")), let image = NSImage(data: data) { logos[item.id] = image }
        } catch { /* Keep the company initial. */ }
    }

    // MARK: List

    private var list: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 18) {
                if grouped {
                    ForEach(categories.indices, id: \.self) { index in
                            let key = categories[index].0, label = categories[index].1
                        let items = visible.filter { $0.category == key || (key.isEmpty && !["internship", "campus", "full_time"].contains($0.category)) }
                        if !items.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(spacing: 10) { Text(label).font(V3.sans(12, weight: .medium)); Text("\(items.count)").font(V3.sans(12)).foregroundStyle(V3.fnt) }
                                table(items, showCategory: false)
                            }
                        }
                    }
                } else { table(visible, showCategory: true) }
            }.padding(.bottom, 24)
        }
    }
    private func table(_ items: [CareerApplication], showCategory: Bool) -> some View {
        VStack(spacing: 0) {
            row(header: true, showCategory: showCategory, cells: ["公司 / 岗位", "求职分类", "当前进度", "最近安排", "投递日期", "更新时间"].map { AnyView(Text($0)) })
            ForEach(items) { item in
                let done = completed(item)
                let label = CareerBoard.progressLabel(item.raw, completed: done)
                let next = nextSession(item)
                Button { selected = item } label: {
                    row(header: false, showCategory: showCategory, cells: [
                        AnyView(HStack(spacing: 6) { Text(item.company).foregroundStyle(V3.txt).fontWeight(.medium); Text("·").foregroundStyle(V3.fnt); Text(item.title) }.lineLimit(1)),
                        AnyView(V3Chip(label: item.categoryLabel, height: 20, size: 10)),
                        AnyView(Text(label).fontWeight(.medium).foregroundStyle(listTone(CareerBoard.tone(item.raw, completed: done))).lineLimit(1)),
                        AnyView(Text(next.map { CareerBoard.sessionRange($0) + " · " + $0.text("stage_label") } ?? "暂无安排").lineLimit(1)),
                        AnyView(Text(CareerBoard.relativeDay(item.raw.text("applied_at")) ?? "未投递")),
                        AnyView(Text(CareerBoard.relativeDay(item.raw.text("updated_at")) ?? "—").font(V3.sans(11)).foregroundStyle(V3.fnt)),
                    ])
                }.buttonStyle(CareerRowStyle())
            }
        }
    }
    private func row(header: Bool, showCategory: Bool, cells: [AnyView]) -> some View {
        HStack(spacing: 0) {
            cells[0].frame(maxWidth: .infinity, alignment: .leading)
            if showCategory { cells[1].frame(width: 96, alignment: .leading).padding(.leading, 12) }
            cells[2].frame(width: 170, alignment: .leading).padding(.leading, 12)
            cells[3].frame(width: 200, alignment: .leading).padding(.leading, 12)
            cells[4].frame(width: 100, alignment: .leading).padding(.leading, 12)
            cells[5].frame(width: 100, alignment: .leading).padding(.leading, 12)
        }
        .font(V3.sans(header ? 11 : 12)).foregroundStyle(header ? V3.fnt : V3.sub)
        .frame(height: header ? 36 : 56)
        .overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
    }
    private func listTone(_ tone: CareerTone) -> Color {
        switch tone {
        case .blue: return V3.blue
        case .orange: return V3.orange
        case .green: return V3.green
        case .red: return V3.red
        case .gray, .dark: return V3.fnt
        }
    }
    private func nextSession(_ item: CareerApplication) -> JSONValue? {
        guard item.raw.text("status") == "active", item.raw.text("archived_at").isEmpty else { return nil }
        let now = Date()
        return sessions.filter { $0.text("application_id") == item.id && $0.text("status") == "scheduled" && (CareerApplication.date($0.text("end_at")) ?? .distantPast) > now }
            .min { (CareerApplication.date($0.text("start_at")) ?? .distantFuture) < (CareerApplication.date($1.text("start_at")) ?? .distantFuture) }
    }

    // MARK: Empty

    @ViewBuilder private var empty: some View {
        if !query.trimmingCharacters(in: .whitespaces).isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text("没有匹配的求职进程").font(V3.serif(18)).foregroundStyle(V3.txt)
                Text("换个公司、职位或阶段关键词试试。").font(V3.sans(13)).foregroundStyle(V3.sub)
            }.padding(.horizontal, 32).padding(.vertical, 30).frame(maxWidth: 520, alignment: .leading)
                .background(.white, in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(V3.cl))
                .frame(maxWidth: .infinity).padding(.top, 40)
        } else {
            ScrollView {
                V3EmptyCard(title: account.isEmpty ? "登录后查看求职进程" : "还没有求职进程",
                            message: "装上浏览器插件，在招聘网站上一键把岗位存进来；也可以粘贴岗位文字导入。", stageHeight: 216) {
                    CareerEmptyBoardArt()
                } actions: {
                    Button { open("plugin") } label: { Image(systemName: "puzzlepiece.extension").font(.system(size: 12)); Text("安装浏览器插件") }
                        .buttonStyle(V3ButtonStyle(kind: .ghost, height: 36))
                    Button("粘贴岗位文字导入") { open("import") }.buttonStyle(CareerActionStyle(kind: .link))
                    Button("创建第一条求职进程") { open("arranged") }.buttonStyle(CareerActionStyle(kind: .link))
                }.frame(maxWidth: .infinity).padding(.top, 24)
            }
        }
    }

    private func open(_ kind: String) {
        if account.isEmpty { pendingAction = kind; requireAccount() }
        else { action = JobAction(kind: kind, application: nil) }
    }
    private func load() async {
        guard !account.isEmpty else { loading = false; failure = nil; return }
        loading = true; failure = nil; logos = [:]; pendingLogos = []
        do {
            var result: [CareerApplication] = []; var cursor = ""; var seen = Set<String>()
            repeat {
                var query = ["scope": "all", "limit": "200"]; if !cursor.isEmpty { query["cursor"] = cursor }
                let page = try await session.api.careerRequest(path: "/api/job-applications", method: "GET", query: query, body: nil)
                try Task.checkCancellation()
                result += (page["items"]?.items ?? []).map { CareerApplication($0) }
                cursor = page.text("next_cursor")
                if !cursor.isEmpty && !seen.insert(cursor).inserted { throw APIError.invalidResponse }
            } while !cursor.isEmpty
            let metrics = try await session.api.careerRequest(path: "/api/interview-overview", method: "GET", query: ["timezone": TimeZone.current.identifier], body: nil)
            var arrangements: [JSONValue] = []; cursor = ""; seen = []
            repeat {
                var params = ["limit": "500", "include_archived": "true"]; if !cursor.isEmpty { params["cursor"] = cursor }
                let page = try await session.api.careerRequest(path: "/api/interview-sessions", method: "GET", query: params, body: nil)
                try Task.checkCancellation(); arrangements += page["items"]?.items ?? []
                cursor = page.text("next_cursor")
                if !cursor.isEmpty && !seen.insert(cursor).inserted { throw APIError.invalidResponse }
            } while !cursor.isEmpty
            try Task.checkCancellation()
            applications = result.map { $0.includingSessions(arrangements) }; sessions = arrangements; overview = metrics
        } catch is CancellationError { return }
        catch APIError.unauthorized { session.reportAuthenticationFailure(); failure = "登录已失效，请重新登录。" }
        catch { failure = "岗位加载失败，请检查服务连接后重试。" }
        loading = false
    }
}

/// `.career-application-table-row` hover background.
struct CareerRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { CareerRowBody(configuration: configuration) }
    private struct CareerRowBody: View {
        let configuration: ButtonStyleConfiguration
        @State private var hover = false
        var body: some View {
            configuration.label.contentShape(Rectangle())
                .background(hover || configuration.isPressed ? Color(hex: 0xFAFAF8) : .clear)
                .onHover { hover = $0 }
        }
    }
}

/// `EmptyBoardArt`: four mini columns with a sample card and a plugin badge.
struct CareerEmptyBoardArt: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            ForEach(Array([("待投递", V3.fnt), ("笔试", V3.orange), ("面试中", V3.blue), ("Offer", V3.green)].enumerated()), id: \.offset) { index, column in
                ZStack(alignment: .topLeading) {
                    RoundedRectangle(cornerRadius: 8).fill(Color(hex: 0xFBFBFA)).overlay(RoundedRectangle(cornerRadius: 8).stroke(V3.line))
                    Circle().fill(column.1).frame(width: 6, height: 6).offset(x: 9, y: 12)
                    Text(column.0).font(V3.sans(9.5, weight: .medium)).foregroundStyle(V3.sub).offset(x: 20, y: 8)
                    RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0xE9E9E5), style: StrokeStyle(lineWidth: 1, dash: [3])).frame(width: 74, height: 44).offset(x: 6, y: 32)
                }.frame(width: 86, height: 168).offset(x: 85 + CGFloat(index) * 96, y: 24)
            }
            Path { path in path.move(to: CGPoint(x: 175, y: 92)); path.addCurve(to: CGPoint(x: 447, y: 148), control1: CGPoint(x: 255, y: 102), control2: CGPoint(x: 375, y: 122)) }
                .stroke(V3.fnt2, style: StrokeStyle(lineWidth: 1.4, dash: [3, 3]))
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 8).fill(.white).shadow(color: .black.opacity(0.06), radius: 4, y: 2)
                Text("美团 · Java 开发").font(V3.sans(10, weight: .medium)).foregroundStyle(V3.txt).offset(x: 10, y: 9)
                Text("校招").font(V3.sans(8, weight: .medium)).foregroundStyle(V3.sub).padding(.horizontal, 5).frame(height: 14).background(V3.field, in: RoundedRectangle(cornerRadius: 3)).offset(x: 10, y: 31)
                Circle().fill(V3.red).frame(width: 4, height: 4).offset(x: 46, y: 36)
                Text("09-30 截止").font(V3.number(8, weight: .regular)).foregroundStyle(V3.red).offset(x: 54, y: 32)
            }.frame(width: 120, height: 54).offset(x: 95, y: 54)
            Image(systemName: "puzzlepiece.extension.fill").font(.system(size: 17)).foregroundStyle(.white)
                .frame(width: 40, height: 40).background(V3.txt, in: RoundedRectangle(cornerRadius: 12)).offset(x: 369, y: 146)
        }.frame(width: 544, height: 216).accessibilityHidden(true)
    }
}

struct CareerForm: View {
    let action: JobAction
    let applications: [CareerApplication]
    let api: any APIClient
    let completed: () -> Void
    let close: () -> Void
    @State private var kind = ""
    @State private var current: CareerApplication?
    @State private var selectedExisting = ""
    @State private var appliedAt = Date()
    @State private var resumes: [JSONValue] = []
    @State private var selectedResume = ""
    @State private var company = ""
    @State private var role = ""
    @State private var description = ""
    @State private var category = ""
    @State private var city = ""
    @State private var stage = "interview"
    @State private var label = "一面"
    @State private var round = 1
    @State private var slotSet = false
    @State private var deadlineSet = false
    @State private var duration = 60
    @State private var planDuration = 60
    @State private var interviewer = ""
    @State private var prepNote = ""
    @State private var ocAt = Date()
    @State private var ocAtSet = false
    @State private var ocStartText = ""
    @State private var ocNote = ""
    @State private var reuseCurrentStage = false
    @State private var allowConflict = false
    @State private var interviewMode = "video"
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(3600)
    @State private var window = false
    @State private var planSet = false
    @State private var planStart = Date()
    @State private var createdSession: JSONValue?
    @State private var savedPlan = false
    @State private var frozenPlan: JSONValue?
    @State private var meeting = ""
    @State private var location = ""
    @State private var reason = "user_withdrew"
    @State private var offerReceived = Date()
    @State private var replySet = false
    @State private var replyDate = Date()
    @State private var startSet = false
    @State private var startDate = Date()
    @State private var ocContact = ""
    @State private var probation = ""
    @State private var offerMaterials = ""
    @State private var salaryDescription = ""
    @State private var channel = ""
    @State private var oralSalary = ""
    @State private var offerIntent = "none"
    @State private var offerSalary = ""
    @State private var offerBase = ""
    @State private var currency = "CNY"
    @State private var salaryPeriod = "month"
    @State private var benefits = ""
    @State private var notes = ""
    @State private var busy = false
    @State private var error: String?
    @State private var creationUnknown = false
    @State private var createdApplicationID: String?
    @State private var savedSession = false
    @State private var savedStage: JSONValue?
    @State private var staged = false
    @State private var frozenStage: JSONValue?
    @State private var frozenOffer: JSONValue?
    @State private var frozenSession: JSONValue?
    @State private var sessions: [JSONValue] = []
    @State private var editingSession: JSONValue?
    @State private var sessionCommand = ""
    @State private var commandPayload: JSONValue?

    private var heading: String { ["import": "导入岗位", "arranged": "已有面试安排", "stage": "添加求职阶段", "category": "修改求职分类", "terminate": "终止求职", "delete": "删除岗位", "detail": "求职详情", "plugin": "安装浏览器插件", "offer": "记录正式 Offer", "apply": "记录投递", "schedule-current": "安排时间", "accept": "接受 Offer", "decline": "婉拒 Offer", "archive": "归档岗位", "restore": "恢复岗位", "notes": "编辑备注", "schedule": "新建面试"][kind] ?? "岗位" }
    private var needsStage: Bool { ["stage", "apply", "schedule-current", "arranged", "schedule"].contains(kind) }
    private var creation: Bool { kind == "import" || (["arranged", "schedule"].contains(kind) && selectedExisting.isEmpty) }
    private var stageOptions: [String] {
        if kind == "offer" { return ["offer"] }
        if staged || reuseCurrentStage { return [stage] }
        let options = CareerStage.nextStages(current ?? applications.first { $0.id == selectedExisting })
        return kind == "schedule" ? options.filter { ["assessment", "written_test", "ai_interview", "interview"].contains($0) } : options
    }
    private var showSchedule: Bool { ["assessment", "written_test", "ai_interview", "interview"].contains(stage) }
    private var startsPending: Bool { current?.stage == "pending" || creation }
    private var isHR: Bool { stage == "interview" && label == "HR 面" }
    private var isWindow: Bool { stage == "assessment" || (stage == "written_test" && window) }
    /// Web saves a session only when the user gave any schedule detail; schedule-only entries require one.
    private var hasScheduleDetails: Bool { slotSet || deadlineSet || ![meeting, prepNote, interviewer].allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
    private var scheduleRequired: Bool { ["schedule-current", "schedule", "arranged"].contains(kind) }
    private var planFinish: Date { planStart.addingTimeInterval(Double(planDuration) * 60) }

    var body: some View {
        Group { if action.compact { compactApply } else {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(dialogTitle).font(V3.serif(20)).foregroundStyle(V3.txt).frame(height: 29)
                    Spacer()
                    Button(action: close) { Image(systemName: "xmark").font(.system(size: 12, weight: .medium)).foregroundStyle(V3.fnt).frame(width: 22, height: 22) }
                        .buttonStyle(.plain).accessibilityLabel("关闭").disabled(busy)
                }
                if let current {
                    Text([current.company, current.title, "现在：" + CareerBoard.projection(current.raw).stageLabel].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(V3.sans(12.5)).foregroundStyle(V3.sub).lineLimit(1)
                } else if needsStage {
                    Text(startsPending ? "选择当前实际进度，可直接补录已经发生的阶段。" : "选择下一阶段，也可以直接补录已发生的阶段。").font(V3.sans(12.5)).foregroundStyle(V3.sub)
                }
            }.padding(.horizontal, 32).padding(.top, 28).padding(.bottom, 14)
            HStack(alignment: .top, spacing: 28) {
                formSummary.frame(width: 272).frame(minHeight: 550)
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if kind == "plugin" {
                        Text("浏览器插件在 Chrome / Edge 中采集岗位，保存后刷新客户端即可查看。")
                        Text("在 Web 的岗位看板选择安装浏览器插件，下载并解压 ZIP；打开浏览器扩展管理，启用开发者模式后加载已解压的扩展。")
                    }
                    if ["arranged", "schedule"].contains(kind) {
                        Picker("岗位", selection: $selectedExisting) {
                            Text("创建新岗位").tag("")
                            ForEach(applications.filter { $0.movable }) { item in Text(item.company + " · " + item.title).tag(item.id) }
                        }.disabled(current != nil || frozenStage != nil)
                    }
                    if kind == "schedule", let chosen = applications.first(where: { $0.id == selectedExisting }), !(chosen.raw["current_stage"]?.text("id") ?? "").isEmpty, chosen.raw.text("stage_state") == "awaiting_schedule", ["assessment", "written_test", "ai_interview", "interview"].contains(chosen.stage) {
                        Toggle("为当前阶段添加排期", isOn: $reuseCurrentStage).disabled(staged)
                    }
                    if creation {
                        Text("填写岗位信息，保存到你的云端账号。").font(.system(size: 13)).foregroundStyle(Color(hex: 0x96968F))
                        HStack { field("公司", text: $company); field("岗位名称", text: $role) }
                        categoryPicker
                        field("工作城市", text: $city)
                        Text("岗位描述 / JD").font(.system(size: 13, weight: .medium))
                        TextEditor(text: $description).frame(height: 140).padding(8).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0xE4E4E0)))
                        Button("选择岗位截图") { chooseImage() }.disabled(busy || current != nil)
                        Button("智能提取岗位信息") { Task { await parseDraft() } }.disabled(busy || description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || current != nil)
                    }
                    if kind == "category" { categoryPicker }
                    if needsStage {
                        VStack(alignment: .leading, spacing: 0) {
                            if !(reuseCurrentStage || kind == "schedule-current") { stageTiles }
                            if startsPending { pendingFields }
                            if stage == "offer" {
                                if offerIntent == "none" { ocFields } else { formalOfferFields.padding(.top, 24) }
                            } else if stage == "screening" {
                                if !startsPending { Text("保存后进入筛选中，等待公司筛选结果。").font(V3.sans(13)).foregroundStyle(V3.sub).padding(.top, 28) }
                            } else {
                                if stage == "interview" && !isHR { roundFields }
                                CareerStageScheduleFields(stage: stage, isHR: isHR, window: $window, startSet: $slotSet, start: $start, endSet: $deadlineSet, end: $end, duration: $duration,
                                    planSet: $planSet, planStart: $planStart, planDuration: $planDuration, mode: $interviewMode, link: $meeting,
                                    interviewer: $interviewer, note: $prepNote, allowConflict: $allowConflict, hasError: error != nil)
                            }
                            if staged { Text("阶段已保存，剩余排期或 Offer 信息尚待确认。重试将复用原请求。").font(V3.sans(12)).foregroundStyle(V3.orange).padding(.top, 16) }
                        }
                    }
                    if kind == "notes" { field("备注", text: $notes) }
                    if ["accept", "decline", "archive", "restore"].contains(kind) { Text(kind == "accept" ? "确认接受这份正式 Offer？本次求职流程将结束，阶段记录会保留。" : kind == "decline" ? "确认婉拒这份正式 Offer？本次求职流程将结束，阶段记录会保留。" : kind == "archive" ? "归档后仍可在已结束列查看并恢复。" : "恢复显示该岗位，已结束的流程不会重新开始。") }
                    if kind == "offer" { stageTiles; formalOfferFields }
                    if kind == "terminate" {
                        Text("终止后会保留岗位、阶段与排期历史。")
                        Picker("结束原因", selection: $reason) { Text("主动结束").tag("user_withdrew"); Text("公司拒绝").tag("company_rejected"); Text("已完成").tag("completed"); Text("其他原因").tag("other") }
                    }
                    if kind == "delete" { Text("确定永久删除这个岗位及其求职进程、阶段、排期和复盘？已关联的资料会保留在资料库。此操作不能撤销。").foregroundStyle(.red) }
                    if kind == "detail", let current {
                        HStack { Text(current.categoryLabel); Text(current.statusLabel).foregroundStyle(.secondary); Spacer() }
                        if !description.isEmpty { Text("岗位描述").font(.headline); Text(description).font(.system(size: 13)).textSelection(.enabled) }
                        Text("求职阶段").font(.headline)
                        ForEach(Array((current.raw["stages"]?.items ?? []).enumerated()), id: \.offset) { _, entry in
                            HStack { Circle().fill(Color(hex: 0x3976CF)).frame(width: 7, height: 7); Text(entry.text("stage_label")); Spacer(); Text(entry.text("entered_at").prefix(10)).foregroundStyle(.secondary) }.font(.system(size: 13))
                        }
                        if !sessions.isEmpty { Text("排期").font(.headline) }
                        ForEach(Array(sessions.enumerated()), id: \.offset) { _, item in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(item.text("stage_label") + " · " + (["scheduled": "已安排", "completed": "已完成", "cancelled": "已取消"][item.text("status")] ?? item.text("status")))
                                Text(item.text("start_at") + " — " + item.text("end_at")).font(.system(size: 12)).foregroundStyle(.secondary)
                                if item.text("status") == "scheduled" {
                                    HStack {
                                        ForEach(["reschedule", "answer-plan", "complete", "cancel"], id: \.self) { command in
                                            Button(["reschedule": "改期", "answer-plan": "个人作答计划", "complete": "标记完成", "cancel": "取消安排"][command]!) {
                                                editingSession = item; sessionCommand = command; commandPayload = nil
                                                start = CareerApplication.date(item.text("start_at")) ?? Date()
                                                end = CareerApplication.date(item.text("end_at")) ?? start.addingTimeInterval(3600)
                                            }.disabled(busy)
                                        }
                                    }
                                }
                            }
                        }
                        if let editingSession {
                            Text(["reschedule": "确认改期", "answer-plan": "个人作答计划", "complete": "确认标记为完成", "cancel": "确认取消安排"][sessionCommand] ?? "")
                                .font(.headline)
                            if ["reschedule", "answer-plan"].contains(sessionCommand) {
                                DatePicker("开始时间", selection: $start).disabled(commandPayload != nil)
                                DatePicker("结束时间", selection: $end).disabled(commandPayload != nil)
                            }
                            HStack {
                                Button("确认") { Task { await saveSession(editingSession) } }.disabled(busy)
                                Button("返回") { self.editingSession = nil; commandPayload = nil }.disabled(busy)
                            }
                        }
                        field("备注", text: $notes)
                        HStack {
                            Button("保存备注") { Task { await saveNotes() } }.disabled(busy)
                            Spacer()
                            if current.movable { Button("推进流程") { kind = "stage" } }
                            if !current.ended { Button("终止求职") { kind = "terminate" } }
                            if current.ended { Button("删除岗位", role: .destructive) { kind = "delete" } }
                        }
                    }
                    if let error { Text(error).font(.system(size: 13)).foregroundStyle(.red).textSelection(.enabled) }
                }.disabled(busy || frozenStage != nil && !staged || frozenSession != nil || frozenOffer != nil)
            }.frame(width: 516) } .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 32)
            Spacer(minLength: 0)
            HStack(spacing: 10) {
                Text(current != nil && creation ? "岗位已保存；后续步骤可继续重试。" : footerHint).font(V3.sans(11.5)).foregroundStyle(V3.fnt).lineLimit(1)
                Spacer()
                Button("取消", action: close).buttonStyle(V3ButtonStyle(kind: .ghost, height: 36)).frame(minWidth: 80).disabled(busy)
                if !["detail", "plugin"].contains(kind) {
                    Button(busy ? "保存中…" : submitLabel) { Task { await save() } }
                        .buttonStyle(V3ButtonStyle(kind: kind == "delete" ? .danger : .dark, height: 36)).frame(minWidth: 108).disabled(busy || creationUnknown)
                }
            }.padding(.horizontal, 32).frame(height: 88)
            .overlay(alignment: .top) { Rectangle().fill(V3.line).frame(height: 1) }
        } } }.font(LibraryTypography.sans(13)).interactiveDismissDisabled(busy).onChange(of: selectedExisting) { _, id in
            if kind == "schedule", let chosen = applications.first(where: { $0.id == id }) {
                reuseCurrentStage = !(chosen.raw["current_stage"]?.text("id") ?? "").isEmpty && chosen.raw.text("stage_state") == "awaiting_schedule" && ["assessment", "written_test", "ai_interview", "interview"].contains(chosen.stage)
                stage = reuseCurrentStage ? chosen.stage : "interview"; label = reuseCurrentStage ? chosen.stageLabel : "一面"
                round = max(1, chosen.raw["current_round_no"]?.integer ?? 1)
            } else { reuseCurrentStage = false }
        }.onChange(of: reuseCurrentStage) { _, reuse in
            guard kind == "schedule", let chosen = applications.first(where: { $0.id == selectedExisting }) else { return }
            stage = reuse ? chosen.stage : "interview"
            label = reuse ? chosen.stageLabel : "一面"
            round = reuse ? max(1, chosen.raw["current_round_no"]?.integer ?? 1) : max(1, (chosen.raw["current_round_no"]?.integer ?? 0) + 1)
        }.task {
            kind = action.kind; current = action.application; stage = action.stage; label = action.label
            round = max(1, action.round ?? max(1, (action.application?.raw["current_round_no"]?.integer ?? 0) + 1))
            if ["stage", "apply"].contains(kind), !["interview", "ai_interview"].contains(current?.stage ?? "") { label = "一面" }
            if kind == "offer", let current {
                stage = "offer"; offerIntent = "received"; offerBase = current.raw.text("offer_base_location"); offerSalary = current.raw.text("offer_salary")
                currency = current.raw.text("offer_salary_currency").isEmpty ? "CNY" : current.raw.text("offer_salary_currency")
                salaryPeriod = current.raw.text("offer_salary_period").isEmpty ? "month" : current.raw.text("offer_salary_period"); benefits = current.raw.text("offer_benefits_description")
            }
            // Structured fields first; older records kept these values as note lines.
            let noteSource = current?.raw.text("notes") ?? ""
            let raw = current?.raw ?? .null
            channel = raw.text("applied_channel").nonEmptyOr(CareerNotes.value("投递渠道", in: noteSource))
            oralSalary = raw.text("oc_salary_text").nonEmptyOr(CareerNotes.value("口头薪酬", in: noteSource))
            ocContact = raw.text("oc_contact")
            probation = raw.text("offer_probation").nonEmptyOr(CareerNotes.value("试用期", in: noteSource))
            offerMaterials = CareerNotes.value("Offer 材料", in: noteSource); salaryDescription = CareerNotes.value("薪酬说明", in: noteSource)
            if let parsed = CareerFormat.offerDate(raw.text("offer_received_on")) { offerReceived = parsed }
            if let parsed = CareerFormat.offerDate(raw.text("offer_reply_due_on")) { replySet = true; replyDate = parsed }
            if let parsed = CareerFormat.offerDate(raw.text("offer_start_on")) { startSet = true; startDate = parsed }
            category = action.application?.category ?? ""
            if let seed = action.start { start = seed; slotSet = true }
            if let seed = action.end { end = seed; if let begin = action.start, seed > begin { duration = max(1, Int(seed.timeIntervalSince(begin) / 60)) } }
            ocStartText = raw.text("oc_start_text"); ocNote = raw.text("oc_note")
            if let parsed = CareerApplication.date(raw.text("oc_communicated_at")) { ocAt = parsed; ocAtSet = true }
            if kind == "schedule-current", let current { reuseCurrentStage = true; stage = current.stage; label = current.stageLabel }
            window = stage == "assessment"
            if kind == "notes" { notes = current?.raw.text("notes") ?? "" }
            if kind == "detail" { await loadDetail() }
            else if needsStage {
                do { resumes = try await request("/api/resumes")["resumes"]?.items ?? [] }
                catch { self.error = "简历列表暂不可用，仍可不关联简历继续。 " + explain(error) }
            }
        }
    }
    /// Only the values without their own column stay in notes; stale date lines from older records are dropped.
    private var offerNotes: String { CareerNotes.merging(["收到日期": "", "回复截止": "", "预计入职": "", "试用期": "", "Offer 材料": offerMaterials, "薪酬说明": salaryDescription], into: current?.raw.text("notes") ?? "") }
    private func calendarDay(_ date: Date) -> String { let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"; return f.string(from: date) }
    /// The stage type sent to the API: HR 面 and OC have their own types.
    private var stageType: String { stage == "interview" && label == "HR 面" ? "hr" : stage == "offer" && offerIntent == "none" ? "oc" : stage }
    private var formalOfferFields: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 16) {
                DatePicker("收到日期", selection: $offerReceived, displayedComponents: .date).frame(maxWidth: .infinity)
                HStack { Toggle("回复截止", isOn: $replySet); if replySet { DatePicker("", selection: $replyDate, displayedComponents: .date).labelsHidden() } }.frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(spacing: 16) { field("薪酬说明（如 35K × 16 薪）", text: $salaryDescription); field("工作地点", text: $offerBase) }
            HStack(spacing: 16) {
                HStack { Toggle("预计入职", isOn: $startSet); if startSet { DatePicker("", selection: $startDate, displayedComponents: .date).labelsHidden() } }.frame(maxWidth: .infinity, alignment: .leading)
                field("试用期（可选）", text: $probation)
            }
            field("Offer 材料（资料库文件名或备注，可选）", text: $offerMaterials)
            DisclosureGroup("结构化薪资与福利（可选）") {
                VStack(spacing: 12) { field("薪资数额", text: $offerSalary); HStack { Picker("币种", selection: $currency) { Text("CNY").tag("CNY"); Text("USD").tag("USD") }; Picker("计薪周期", selection: $salaryPeriod) { Text("月").tag("month"); Text("年").tag("year") } }; field("福利待遇", text: $benefits) }.padding(.top, 12)
            }
        }
    }
    /// `.cd3-stage-choices`: one row of eight stage tiles. Like Web, earlier stages can be back-filled.
    private var stageTiles: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(kind == "offer" ? "阶段" : startsPending ? "当前进度" : "阶段").font(V3.sans(12, weight: .medium)).foregroundStyle(V3.txt).frame(height: 14)
            HStack(spacing: 8) {
                ForEach(["screening", "assessment", "written_test", "ai_interview", "interview", "hr", "oc", "formal"], id: \.self) { choice in
                    let key = ["hr": "interview", "oc": "offer", "formal": "offer"][choice] ?? choice
                    let chosen = stage == key && (key != "offer" || offerIntent == (choice == "formal" ? "received" : "none")) && (key != "interview" || (choice == "hr") == (label == "HR 面"))
                    let allowed = kind == "offer" ? choice == "formal"
                        : kind == "schedule" ? ["assessment", "written_test", "ai_interview", "interview", "hr"].contains(choice)
                        : startsPending || choice != "screening"
                    Button {
                        stage = key; window = key == "assessment"
                        if choice == "hr" { label = "HR 面" } else if choice == "interview" && label == "HR 面" { label = Self.defaultRound(current) }
                        if key == "offer" { offerIntent = choice == "formal" ? "received" : "none" }
                        error = nil
                    } label: {
                        VStack(spacing: 6) {
                            CareerIcon(name: ["screening":"filter", "assessment":"text", "written_test":"edit", "ai_interview":"spark", "interview":"user", "hr":"brief", "oc":"phone", "formal":"mail"][choice]!, size: 16, template: true)
                            Text(["hr":"HR 面", "oc":"OC", "formal":"Offer", "interview":"面试", "screening":"筛选"][choice] ?? CareerStage.label(key)).font(V3.sans(12)).lineLimit(1)
                        }
                        .foregroundStyle(chosen ? V3.txt : V3.sub)
                        .frame(maxWidth: .infinity).frame(height: 58)
                        .background(.white, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(chosen ? V3.txt : V3.cl, lineWidth: chosen ? 1.5 : 1))
                        .overlay(alignment: .topTrailing) {
                            if chosen { Image(systemName: "checkmark").font(.system(size: 7, weight: .bold)).foregroundStyle(.white).frame(width: 14, height: 14).background(V3.txt, in: Circle()).padding(6) }
                        }
                        .contentShape(Rectangle())
                    }.buttonStyle(.plain).opacity(allowed ? 1 : 0.38).disabled(!allowed || staged || frozenStage != nil || reuseCurrentStage)
                    .accessibilityAddTraits(chosen ? .isSelected : [])
                }
            }
        }
    }
    /// `.cd3-apply-dialog`: art on top, applied date and channel below.
    private var compactApply: some View {
        VStack(alignment: .leading, spacing: 0) {
            V3DotStage(height: 148) {
                HStack(spacing: 14) {
                    RoundedRectangle(cornerRadius: 6).fill(.white).frame(width: 70, height: 92).overlay(alignment: .topLeading) {
                        VStack(alignment: .leading, spacing: 6) {
                            RoundedRectangle(cornerRadius: 2).fill(V3.txt).frame(width: 30, height: 5)
                            ForEach(0..<4, id: \.self) { _ in RoundedRectangle(cornerRadius: 1).fill(V3.line).frame(width: 46, height: 3) }
                        }.padding(10)
                    }.shadow(color: .black.opacity(0.06), radius: 4, y: 2).rotationEffect(.degrees(-4))
                    Path { path in path.move(to: .zero); path.addLine(to: CGPoint(x: 60, y: 0)) }
                        .stroke(V3.fnt2, style: StrokeStyle(lineWidth: 1.4, dash: [3, 3])).frame(width: 60, height: 1)
                    VStack(alignment: .leading, spacing: 10) {
                        tagCard(current?.company.isEmpty == false ? current!.company : "目标公司", dot: V3.blue)
                        tagCard("筛选中", dot: V3.orange)
                    }
                }
            }.padding(.horizontal, 24).padding(.top, 24)
            VStack(alignment: .leading, spacing: 0) {
                Text(heading).font(V3.serif(20)).foregroundStyle(V3.txt)
                Text([current?.company ?? "", current?.title ?? ""].filter { !$0.isEmpty }.joined(separator: " · ").nonEmptyOr("记录投递信息"))
                    .font(V3.sans(12.5)).foregroundStyle(V3.sub).padding(.top, 5)
                formField("投递日期（选填）") {
                    DatePicker("", selection: $appliedAt, displayedComponents: .date).labelsHidden().datePickerStyle(.field).frame(height: 40)
                }.padding(.top, 20)
                formField("投递渠道", hint: "选填") { iconInput("link", "例如：同事内推、官网、招聘平台", text: $channel) }.padding(.top, 18)
                Text("保存后岗位从「待投递」进入「筛选中」，等待公司筛选结果。").font(V3.sans(11.5)).foregroundStyle(V3.fnt).padding(.top, 12)
                if let error { Text(error).font(V3.sans(12)).foregroundStyle(V3.red).padding(.top, 10) }
            }.padding(.horizontal, 28).padding(.top, 22).padding(.bottom, 4)
            HStack(spacing: 10) {
                Spacer()
                Button("取消", action: close).buttonStyle(V3ButtonStyle(kind: .ghost, height: 36)).disabled(busy)
                Button(busy ? "保存中…" : "保存求职进度") { Task { await save() } }.buttonStyle(V3ButtonStyle(kind: .dark, height: 36)).disabled(busy)
            }.padding(.horizontal, 28).padding(.vertical, 20)
        }
    }
    private func tagCard(_ text: String, dot: Color) -> some View {
        HStack(spacing: 6) { Circle().fill(dot).frame(width: 6, height: 6); Text(text).font(V3.sans(10, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1) }
            .padding(.horizontal, 10).frame(height: 24).background(.white, in: RoundedRectangle(cornerRadius: 6)).shadow(color: .black.opacity(0.05), radius: 3, y: 1)
    }
    static func defaultRound(_ app: CareerApplication?) -> String {
        guard let app, app.raw.text("current_stage_type") == "interview" else { return "一面" }
        return JobsBoardView.roundLabel((app.raw["current_round_no"]?.integer ?? 0) + 1)
    }
    /// `.cd3-pending-fields`: date, channel and resume for the first application record.
    private var pendingFields: some View {
        VStack(alignment: .leading, spacing: 22) {
            formField("投递日期", hint: "选填") {
                DatePicker("", selection: $appliedAt, displayedComponents: .date).labelsHidden().datePickerStyle(.field).frame(height: 40)
            }
            formField("投递渠道", hint: "选填") { iconInput("link", "例如：同事内推、官网、招聘平台", text: $channel) }
            formField("关联简历", hint: "选填") {
                Picker("", selection: $selectedResume) {
                    Text(resumes.isEmpty ? "还没有简历" : "不关联简历").tag("")
                    ForEach(Array(resumes.enumerated()), id: \.offset) { _, resume in Text(resume.text("title")).tag(resume.text("id")) }
                }.labelsHidden().frame(height: 40).disabled(frozenStage != nil)
            }
        }.padding(.top, 22)
    }
    /// `.cd3-oc-fields`: the verbal offer is recorded as an OC stage with its own columns.
    private var ocFields: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .top, spacing: 16) {
                formField("沟通时间", required: true) {
                    DatePicker("", selection: Binding(get: { ocAt }, set: { ocAt = $0; ocAtSet = true })).labelsHidden().datePickerStyle(.field).frame(height: 40)
                }
                formField("沟通方式") { iconInput(nil, "例如：电话 · HR", text: $ocContact) }
            }
            HStack(alignment: .top, spacing: 16) {
                formField("口头薪酬") { iconInput(nil, "例如：35K × 16 薪", text: $oralSalary) }
                formField("预计到岗") { iconInput(nil, "例如：11 月上旬", text: $ocStartText) }
            }
            formField("补充说明", hint: "可选 · 只提醒自己") { iconInput(nil, "口头意向不等于正式 Offer，等书面确认后再更新结果", text: $ocNote) }
        }.padding(.top, 24)
    }
    /// `.cd3-interview-round`: 一面 / 二面 / 三面 or a custom name.
    private var roundFields: some View {
        let presets = ["一面", "二面", "三面"]
        let choice = Binding<String>(
            get: { presets.contains(label) ? label : label.isEmpty ? "" : "custom" },
            set: { value in
                label = value == "custom" ? "自定义面试" : value
                if let index = presets.firstIndex(of: value) { round = index + 1 }
            })
        return HStack(alignment: .top, spacing: 16) {
            formField("面试轮次") {
                Picker("", selection: choice) {
                    if !presets.contains(label) && label.isEmpty { Text("选择轮次").tag("") }
                    ForEach(presets, id: \.self) { Text($0).tag($0) }
                    Text("自定义").tag("custom")
                }.labelsHidden().frame(height: 40)
            }
            if presets.contains(label) { Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
            else { formField("面试名称") { iconInput(nil, "例如：技术终面", text: $label) } }
        }.padding(.top, 22).disabled(frozenStage != nil || reuseCurrentStage)
    }
    private func formField<Content: View>(_ title: String, required: Bool = false, hint: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 2) {
                Text(title).font(V3.sans(11)).foregroundStyle(V3.sub)
                if required { Text("*").font(V3.sans(11)).foregroundStyle(V3.red) }
                Spacer(minLength: 4)
                if let hint { Text(hint).font(V3.sans(10.5)).foregroundStyle(V3.fnt) }
            }.frame(height: 13)
            content()
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func iconInput(_ icon: String?, _ placeholder: String, text: Binding<String>) -> some View {
        HStack(spacing: 8) {
            if let icon { CareerIcon(name: icon, size: 14, template: true).foregroundStyle(V3.fnt) }
            TextField("", text: text, prompt: Text(placeholder).foregroundStyle(V3.fnt2)).textFieldStyle(.plain).font(V3.sans(13)).foregroundStyle(V3.txt)
        }
        .padding(.horizontal, 12).frame(height: 40)
        .background(.white, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(V3.cl))
    }
    private var sessionStart: Date { isWindow && !slotSet ? Date() : start }
    private var dialogTitle: String {
        if kind == "stage" { return "添加下一阶段" }
        if kind == "apply" { return startsPending ? "记录投递" : heading }
        return heading
    }
    private var stageName: String {
        if stage == "offer" { return offerIntent == "none" ? "OC" : "Offer" }
        if stage == "interview" { return isHR ? "HR 面" : "面试" }
        return stage == "screening" ? "筛选" : CareerStage.label(stage)
    }
    private var currentName: String { stage == "interview" && !isHR ? (label.isEmpty ? "面试" : label) : stageName }
    private var submitLabel: String {
        if kind == "delete" { return "确认删除" }
        if staged { return "重试剩余步骤" }
        if let fixed = ["offer": "记录 Offer", "accept": "确认接受", "decline": "确认婉拒", "schedule-current": "保存安排", "terminate": "终止求职", "category": "保存分类"][kind] { return fixed }
        guard needsStage else { return "保存" }
        if startsPending { return "确认投递" }
        if stage == "offer" { return offerIntent == "none" ? "记录 OC" : "记录 Offer" }
        return "添加" + stageName
    }
    private var footerHint: String {
        guard needsStage else { return "" }
        if ["offer", "screening"].contains(stage) { return "" }
        return isWindow ? "快速选择从现在开始算" : "保存后可在面试日程中调整"
    }
    private func shortDay(_ date: Date?) -> String? {
        guard let date else { return nil }
        let f = DateFormatter(); f.dateFormat = "MM-dd"; return f.string(from: date)
    }
    private func listDateTime(_ date: Date) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN"); f.dateFormat = "M月d日 HH:mm"; return f.string(from: date)
    }
    private struct TrackRow { let key: String; let label: String; let status: String; let current: Bool }
    private struct SummaryRow { let icon: String; let title: String; let text: String; let muted: Bool }
    private var trackRows: [TrackRow] {
        if startsPending {
            return [TrackRow(key: "applied", label: "提交投递 · " + (shortDay(appliedAt) ?? "今天"), status: "本次", current: true),
                    TrackRow(key: "next", label: stageName + " · 投递后", status: "待开始", current: false)]
        }
        let schedulingOnly = kind == "schedule-current" || reuseCurrentStage
        let currentID = current?.raw["current_stage"]?.text("id") ?? ""
        let stages = (current?.raw["stages"]?.items ?? [])
            .sorted { ($0["sequence_no"]?.integer ?? 0) < ($1["sequence_no"]?.integer ?? 0) }
            .filter { !schedulingOnly || $0.text("id") != currentID }
            .suffix(3)
        var rows = stages.map { entry -> TrackRow in
            let type = entry.text("stage_type")
            let name = type == "screening" ? "简历筛选" : type == "oc" ? "OC · 口头意向" : entry.text("stage_label")
            let day = shortDay(CareerApplication.date(entry.text("completed_at").isEmpty ? entry.text("entered_at") : entry.text("completed_at")))
            let status = entry.text("stage_result") == "rejected" ? "未通过" : type == "oc" ? "已沟通" : (entry.text("stage_status") == "completed" || !schedulingOnly) ? "已通过" : "进行中"
            return TrackRow(key: entry.text("id"), label: [name, day].compactMap { $0 }.joined(separator: " · "), status: status, current: false)
        }
        let thisDay = stage == "offer" ? (offerIntent == "none" ? (ocAtSet ? shortDay(ocAt) : nil) : shortDay(offerReceived))
            : isWindow ? (deadlineSet ? shortDay(end) : nil) : (slotSet ? shortDay(start) : nil)
        rows.append(TrackRow(key: "this", label: [currentName, thisDay].compactMap { $0 }.joined(separator: " · "), status: "本次", current: true))
        return rows
    }
    private var summaryRows: [SummaryRow] {
        var rows = [SummaryRow(icon: "flag", title: "阶段", text: (kind == "schedule-current" || reuseCurrentStage ? "当前" : "进入") + "「\(currentName)」", muted: false)]
        if startsPending {
            let channelText = channel.trimmingCharacters(in: .whitespaces)
            let resumeTitle = resumes.first { $0.text("id") == selectedResume }?.text("title")
            rows.append(SummaryRow(icon: "link", title: "投递渠道", text: channelText.isEmpty ? "还没填 · 可选" : channelText + " · 可选", muted: channelText.isEmpty))
            rows.append(SummaryRow(icon: "text", title: "关联简历", text: resumeTitle.map { $0 + " · 可选" } ?? "还没选 · 可选", muted: resumeTitle == nil))
        } else if stage == "offer" && offerIntent == "none" {
            rows.append(SummaryRow(icon: "clock", title: "沟通时间", text: ocAtSet ? listDateTime(ocAt) : "选择沟通时间", muted: !ocAtSet))
            let salary = oralSalary.trimmingCharacters(in: .whitespaces)
            rows.append(SummaryRow(icon: "text", title: "口头薪酬", text: salary.isEmpty ? "可以之后补充" : salary, muted: salary.isEmpty))
        } else if stage == "offer" {
            rows.append(SummaryRow(icon: "calendar", title: "回复截止", text: replySet ? (shortDay(replyDate) ?? "") : "还没填", muted: !replySet))
            let terms = [salaryDescription, offerBase].map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " · ")
            rows.append(SummaryRow(icon: "text", title: "薪酬与地点", text: terms.isEmpty ? "可以之后补充" : terms, muted: terms.isEmpty))
        } else if stage == "screening" {
        } else if isWindow {
            rows.append(SummaryRow(icon: "calendar", title: "开放与截止", text: (slotSet ? listDateTime(start) : "现在") + " 至 " + (deadlineSet ? listDateTime(end) : "待选择截止时间"), muted: false))
            rows.append(SummaryRow(icon: "check", title: "我的计划", text: planSet ? listDateTime(planStart) : "还没定，之后随时可以补", muted: !planSet))
        } else {
            rows.append(SummaryRow(icon: "clock", title: isHR ? "沟通时间" : "官方时间", text: slotSet ? listDateTime(start) + " · \(duration) 分钟" : "选择开始时间和时长", muted: !slotSet))
            let note = prepNote.trimmingCharacters(in: .whitespacesAndNewlines)
            rows.append(SummaryRow(icon: "check", title: isHR ? "沟通准备" : "我的准备", text: note.isEmpty ? "面试准备与复盘" : note, muted: note.isEmpty))
        }
        return rows
    }
    private var summaryNote: String? {
        if startsPending || stage == "screening" { return nil }
        if stage == "offer" { return offerIntent == "none" ? "OC 只是口头意向\n收到书面 Offer 后再记录正式 Offer" : "接受或婉拒后流程结束\n阶段记录和复盘都会保留" }
        if isWindow { return "截止时间过后自动进入「等待结果」\n无需手动标记完成" }
        if isHR { return "沟通结束后自动进入「等待结果」\n无需手动标记完成" }
        return "\(stage == "interview" ? "面试" : stageName)结束后自动进入「等待结果」\n无需手动标记完成"
    }
    private var summaryTitle: String {
        if startsPending { return "这次投递怎么记" }
        if stage == "offer" { return offerIntent == "none" ? "这次意向怎么记" : "这份 Offer 怎么记" }
        return "这一场怎么安排"
    }
    /// `.cd3-stage-summary`: dotted panel with the stage track, what will be saved and an automatic-status note.
    private var formSummary: some View {
        let stageForm = needsStage || kind == "offer"
        let rows: [SummaryRow] = stageForm ? summaryRows : [
            SummaryRow(icon: "flag", title: "阶段", text: ["accept", "decline"].contains(kind) ? "本次求职将结束，历史会保留" : heading, muted: false),
            SummaryRow(icon: "text", title: "记录", text: "保留已有阶段与面试记录", muted: false),
        ]
        let track: [TrackRow] = stageForm ? trackRows : []
        return VStack(alignment: .leading, spacing: 0) {
            Text(stageForm ? summaryTitle : heading).font(V3.sans(11)).foregroundStyle(V3.fnt)
            if !track.isEmpty {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(track, id: \.key) { row in
                        HStack(spacing: 10) {
                            Circle().fill(row.current ? V3.txt : V3.green).frame(width: 7, height: 7)
                                .overlay(Circle().stroke(row.current ? V3.stage : .clear, lineWidth: 2).frame(width: 11, height: 11))
                            Text(row.label).font(V3.sans(11.5)).foregroundStyle(row.current ? V3.txt : V3.sub).lineLimit(1)
                            Spacer(minLength: 4)
                            if row.current {
                                Text(row.status).font(V3.sans(10.5, weight: .medium)).foregroundStyle(.white).padding(.horizontal, 8).padding(.vertical, 2).background(V3.txt, in: Capsule())
                            } else {
                                Text(row.status).font(V3.sans(11.5, weight: ["已通过", "已沟通"].contains(row.status) ? .medium : .regular))
                                    .foregroundStyle(["已通过", "已沟通"].contains(row.status) ? V3.green : V3.fnt)
                            }
                        }.frame(minHeight: 22)
                    }
                }
                .background(alignment: .leading) { Rectangle().fill(V3.sk2).frame(width: 1).padding(.top, 10).padding(.bottom, 10).padding(.leading, 3) }
                .padding(.top, 16).padding(.bottom, 18)
                .overlay(alignment: .bottom) { Rectangle().fill(V3.line).frame(height: 1) }
            }
            if !rows.isEmpty {
                Text(stageForm ? "点「\(submitLabel)」后保存" : "确认后会更新").font(V3.sans(11)).foregroundStyle(V3.fnt).padding(.top, 18)
                ForEach(rows, id: \.title) { row in
                    HStack(alignment: .top, spacing: 12) {
                        CareerIcon(name: row.icon, size: 14, template: true).foregroundStyle(V3.sub)
                            .frame(width: 28, height: 28).background(.white, in: Circle()).overlay(Circle().stroke(V3.cl))
                        VStack(alignment: .leading, spacing: 6) {
                            Text(row.title).font(V3.sans(12.5, weight: .medium)).foregroundStyle(row.muted ? V3.fnt : V3.txt)
                            Text(row.text).font(V3.sans(11.5)).foregroundStyle(V3.sub).lineSpacing(3).lineLimit(3)
                        }
                    }.padding(.top, 18)
                }
            }
            Spacer(minLength: 24)
            if stageForm, let note = summaryNote {
                HStack(alignment: .top, spacing: 6) {
                    CareerIcon(name: "clock", size: 14, template: true).foregroundStyle(V3.fnt)
                    Text(note).font(V3.sans(11)).foregroundStyle(V3.fnt).lineSpacing(4)
                }
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background { V3DotStage(height: nil) { EmptyView() } }
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
    private var categoryPicker: some View {
        Picker("求职分类", selection: $category) { Text("未分类").tag(""); Text("实习").tag("internship"); Text("校招").tag("campus"); Text("正式").tag("full_time") }
    }
    private func field(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text(title).font(.system(size: 12)).foregroundStyle(.secondary); TextField(title, text: text).textFieldStyle(.roundedBorder) }
    }
    private func request(_ path: String, _ method: String = "GET", _ fields: [String: JSONValue]? = nil, query: [String: String] = [:]) async throws -> JSONValue {
        try await api.careerRequest(path: path, method: method, query: query, body: fields.map(JSONValue.object))
    }
    private func loadDetail() async {
        guard let current else { return }; busy = true
        do {
            let detail = try await request("/api/job-applications/\(current.id)")
            self.current = CareerApplication(detail["application"] ?? .null)
            notes = detail["application"]?.text("notes") ?? ""
            if let jobID = detail["application"]?["job_description_id"]?.stringValue {
                let job = try await request("/api/job-descriptions/\(jobID)")
                description = job["job_description"]?.text("description") ?? ""
            }
            let page = try await request("/api/interview-sessions", query: ["application_id": current.id, "limit": "500", "include_archived": "true"])
            sessions = page["items"]?.items ?? []
        } catch { self.error = explain(error) }
        busy = false
    }
    private func saveSession(_ item: JSONValue) async {
        if ["reschedule", "answer-plan"].contains(sessionCommand) && end <= start { error = "结束时间须晚于开始时间。"; return }
        busy = true; error = nil
        do {
            if commandPayload == nil {
                var fields: [String: JSONValue] = ["base_lock_version": item["lock_version"] ?? .number(1)]
                let formatter = ISO8601DateFormatter()
                if sessionCommand == "reschedule" {
                    fields["start_at"] = .string(formatter.string(from: start)); fields["end_at"] = .string(formatter.string(from: end)); fields["timezone"] = .string(TimeZone.current.identifier)
                } else if sessionCommand == "answer-plan" {
                    fields["answer_plan_start_at"] = .string(formatter.string(from: start)); fields["answer_plan_end_at"] = .string(formatter.string(from: end))
                }
                commandPayload = .object(fields)
            }
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(item.text("id"))/\(sessionCommand)", method: sessionCommand == "answer-plan" ? "PUT" : "POST", query: [:], body: commandPayload)
            editingSession = nil; commandPayload = nil
            await loadDetail()
        } catch { self.error = explain(error) }
        busy = false
    }
    private func chooseImage() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.png, .jpeg]; panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            let values = try url.resourceValues(forKeys: [.fileSizeKey])
            guard let size = values.fileSize, size <= 10 * 1024 * 1024 else { throw APIError.invalidResponse }
            let data = try Data(contentsOf: url)
            Task { await parseDraft(image: data, type: url.pathExtension.lowercased() == "png" ? "image/png" : "image/jpeg") }
        } catch { self.error = "截图读取失败，仅支持 10 MiB 以内的 PNG/JPEG。" }
    }
    private func parseDraft(image: Data? = nil, type: String = "image/png") async {
        busy = true; error = nil
        do {
            let result = try await request("/api/job-descriptions/parse-draft", "POST", image.map { ["image_base64": .string($0.base64EncodedString()), "content_type": .string(type)] } ?? ["text": .string(description)])
            let draft = result["draft"] ?? result["job_description"] ?? result
            company = draft.text("company_name"); role = draft.text("job_title"); city = draft.text("work_city"); category = draft.text("employment_type")
            if !draft.text("description").isEmpty { description = draft.text("description") }
        } catch { self.error = explain(error) }
        busy = false
    }
    private func saveOffer(_ app: CareerApplication) async throws {
        if frozenOffer == nil { frozenOffer = .object(["base_lock_version": .number(Double(app.lockVersion)), "received_on": .string(calendarDay(offerReceived)), "reply_due_on": replySet ? .string(calendarDay(replyDate)) : .null, "start_on": startSet ? .string(calendarDay(startDate)) : .null, "probation": probation.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(probation.trimmingCharacters(in: .whitespaces)), "base_location": offerBase.isEmpty ? .null : .string(offerBase), "salary": offerSalary.isEmpty ? .null : .number(Double(offerSalary)!), "salary_currency": offerSalary.isEmpty ? .null : .string(currency), "salary_period": offerSalary.isEmpty ? .null : .string(salaryPeriod), "benefits_description": benefits.isEmpty ? .null : .string(benefits), "notes": .string(offerNotes)]) }
        let result = try await api.careerRequest(path: "/api/job-applications/\(app.id)/offer", method: "POST", query: [:], body: frozenOffer)
        self.current = CareerApplication(result["application"] ?? .null)
    }
    private func saveNotes() async {
        guard let current else { return }; busy = true; error = nil
        do {
            let result = try await request("/api/job-applications/\(current.id)", "PUT", ["base_lock_version": .number(Double(current.lockVersion)), "notes": .string(notes)])
            self.current = CareerApplication(result["application"] ?? .null)
        } catch { self.error = explain(error) }
        busy = false
    }
    private func save() async {
        guard !busy else { return }; error = nil
        if creation && current == nil && (company.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || role.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) { error = "请填写公司和岗位名称。"; return }
        if needsStage && stage == "interview" && label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { error = "请填写面试名称。"; return }
        if needsStage && stageType == "oc" && !ocAtSet { error = "请填写沟通时间。"; return }
        if needsStage && showSchedule {
            if scheduleRequired && !hasScheduleDetails { error = "请选择开始时间或截止时间。"; return }
            if stage == "assessment" && !deadlineSet && !scheduleRequired && hasScheduleDetails { error = "截止时间必须晚于开放时间。"; return }
            if hasScheduleDetails {
                if isWindow {
                    if !deadlineSet || end <= sessionStart { error = "截止时间必须晚于开放时间。"; return }
                } else if !slotSet {
                    error = stage == "written_test" ? "请填写有效的笔试开始时间。" : "请填写有效的\(isHR ? "HR 面" : CareerStage.label(stage))开始时间。"; return
                }
            }
        }
        if stage == "offer" && !offerSalary.isEmpty && (Double(offerSalary) == nil || Double(offerSalary)! < 0) { error = "请填写有效薪资。"; return }
        if needsStage && isWindow && planSet && (planStart < sessionStart || planFinish > end) { error = "作答计划必须完整落在官方作答时段内。"; return }
        busy = true
        var creating = false
        do {
            if ["arranged", "schedule"].contains(kind) && !selectedExisting.isEmpty && current == nil {
                let detail = try await request("/api/job-applications/\(selectedExisting)")
                current = CareerApplication(detail["application"] ?? .null)
            }
            if creation && current == nil {
                if createdApplicationID == nil {
                creating = true
                let result = try await request("/api/job-descriptions", "POST", ["company_name": .string(company.trimmingCharacters(in: .whitespacesAndNewlines)), "job_title": .string(role.trimmingCharacters(in: .whitespacesAndNewlines)), "description": .string(description), "source_type": .string("manual"), "employment_type": category.isEmpty ? .null : .string(category), "work_city": city.isEmpty ? .null : .string(city)])
                guard let id = result["application"]?["id"]?.stringValue else { creationUnknown = true; throw APIError.invalidResponse }
                createdApplicationID = id; creating = false
                }
                let detail = try await request("/api/job-applications/\(createdApplicationID!)")
                current = CareerApplication(detail["application"] ?? .null)
            }
            guard let current else { throw APIError.invalidResponse }
            if kind == "offer" {
                var target = current
                if current.raw["current_stage"]?.text("stage_type") == "oc" && !staged {
                    if frozenStage == nil { frozenStage = .object(["client_request_id": .string(UUID().uuidString), "base_lock_version": .number(Double(current.lockVersion)), "stage_type": .string("offer")]) }
                    let result = try await api.careerRequest(path: "/api/job-applications/\(current.id)/stages", method: "POST", query: [:], body: frozenStage)
                    target = CareerApplication(result["application"] ?? .null); self.current = target; staged = true
                }
                try await saveOffer(target)
            } else if ["accept", "decline"].contains(kind) {
                _ = try await request("/api/job-applications/\(current.id)/close", "POST", ["base_lock_version": .number(Double(current.lockVersion)), "status": .string("closed"), "offer_status": .string(kind == "accept" ? "accepted" : "declined")])
            } else if ["archive", "restore"].contains(kind) {
                _ = try await request("/api/job-applications/\(current.id)/\(kind)", "POST", ["base_lock_version": .number(Double(current.lockVersion))])
            } else if kind == "notes" {
                _ = try await request("/api/job-applications/\(current.id)", "PUT", ["base_lock_version": .number(Double(current.lockVersion)), "notes": .string(notes)])
            } else if kind == "category" {
                _ = try await request("/api/job-applications/\(current.id)", "PUT", ["base_lock_version": .number(Double(current.lockVersion)), "employment_type": category.isEmpty ? .null : .string(category)])
            } else if kind == "delete" { _ = try await request("/api/job-applications/\(current.id)", "DELETE") }
            else if kind == "terminate" {
                if frozenStage == nil { frozenStage = .object(["client_request_id": .string(UUID().uuidString), "base_lock_version": .number(Double(current.lockVersion)), "reason": .string(reason)]) }
                _ = try await api.careerRequest(path: "/api/job-applications/\(current.id)/terminate", method: "POST", query: [:], body: frozenStage)
            } else if needsStage {
                if reuseCurrentStage && !staged { savedStage = current.raw; staged = true }
                if !staged {
                    if frozenStage == nil {
                        let pending = current.stage == "pending"
                        var fields: [String: JSONValue] = ["client_request_id": .string(UUID().uuidString), "base_lock_version": .number(Double(current.lockVersion)), "stage_type": .string(stageType),
                                                           "applied_at": pending ? .string(ISO8601DateFormatter().string(from: appliedAt)) : .null, "resume_id": selectedResume.isEmpty ? .null : .string(selectedResume)]
                        if stageType == "interview" { fields["stage_label"] = .string(label); fields["interview_round_no"] = .number(Double(round)) }
                        if pending && !channel.trimmingCharacters(in: .whitespaces).isEmpty { fields["applied_channel"] = .string(channel.trimmingCharacters(in: .whitespaces)) }
                        if stageType == "oc" {
                            fields["oc_communicated_at"] = .string(ISO8601DateFormatter().string(from: ocAt))
                            fields["oc_start_text"] = ocStartText.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(ocStartText.trimmingCharacters(in: .whitespaces))
                            fields["oc_note"] = ocNote.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(ocNote.trimmingCharacters(in: .whitespaces))
                            fields["oc_salary_text"] = oralSalary.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(oralSalary.trimmingCharacters(in: .whitespaces))
                            fields["oc_contact"] = ocContact.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(ocContact.trimmingCharacters(in: .whitespaces))
                        }
                        frozenStage = .object(fields)
                    }
                    let result = try await api.careerRequest(path: "/api/job-applications/\(current.id)/stages", method: "POST", query: [:], body: frozenStage)
                    savedStage = result["application"]; self.current = CareerApplication(savedStage ?? .null); staged = true
                }
                if hasScheduleDetails && showSchedule && !savedSession {
                    if frozenSession == nil {
                        let formatter = ISO8601DateFormatter()
                        let begin = sessionStart
                        let finish = isWindow ? end : begin.addingTimeInterval(Double(duration) * 60)
                        let mode = stage == "interview" || (stage == "written_test" && !isWindow) ? interviewMode : "video"
                        let place = meeting.trimmingCharacters(in: .whitespacesAndNewlines)
                        let note = prepNote.trimmingCharacters(in: .whitespacesAndNewlines)
                        let person = interviewer.trimmingCharacters(in: .whitespacesAndNewlines)
                        var fields: [String: JSONValue] = ["client_request_id": .string(UUID().uuidString), "application_stage_id": savedStage?["current_stage"]?["id"] ?? .null,
                            "stage_type": .string(isHR ? "hr" : stage == "interview" ? "interview" : "other"),
                            "stage_label": .string(reuseCurrentStage ? (current.raw["current_stage"]?.text("stage_label") ?? label) : stage == "interview" ? label : CareerStage.label(stage)),
                            "round_no": stage == "interview" && !isHR ? .number(Double(round)) : .null,
                            "start_at": .string(formatter.string(from: begin)), "end_at": .string(formatter.string(from: finish)),
                            "schedule_kind": .string(isWindow ? "open_window" : "fixed_slot"), "timezone": .string(TimeZone.current.identifier), "mode": .string(mode),
                            "allow_conflict": .bool(allowConflict),
                            "meeting_url": ["video", "phone"].contains(mode) && !place.isEmpty ? .string(place) : .null,
                            "location": ["onsite", "other"].contains(mode) && !place.isEmpty ? .string(place) : .null,
                            "preparation_note": note.isEmpty ? .null : .string(note)]
                        if stage == "interview" && !person.isEmpty { fields["interviewer_name"] = .string(person) }
                        frozenSession = .object(fields)
                    }
                    let result = try await api.careerRequest(path: "/api/job-applications/\(current.id)/interview-sessions", method: "POST", query: [:], body: frozenSession)
                    createdSession = result["session"]
                    savedSession = true
                }
                if savedSession && isWindow && planSet && !savedPlan {
                    guard let createdSession, !createdSession.text("id").isEmpty else { throw APIError.invalidResponse }
                    if frozenPlan == nil {
                        let f = ISO8601DateFormatter()
                        frozenPlan = .object(["base_lock_version": createdSession["lock_version"] ?? .number(1), "answer_plan_start_at": .string(f.string(from: planStart)), "answer_plan_end_at": .string(f.string(from: planFinish))])
                    }
                    do {
                        let result = try await api.careerRequest(path: "/api/interview-sessions/\(createdSession.text("id"))/answer-plan", method: "PUT", query: [:], body: frozenPlan)
                        self.createdSession = result["session"] ?? createdSession; savedPlan = true
                    } catch {
                        // A lost response must not make a successful plan look unsaved or overwrite a newer plan.
                        let originalError = error
                        let result = try? await request("/api/interview-sessions/\(createdSession.text("id"))")
                        let remote = result?["session"]
                        let desiredStart = CareerApplication.date(frozenPlan?.text("answer_plan_start_at") ?? "")
                        let desiredEnd = CareerApplication.date(frozenPlan?.text("answer_plan_end_at") ?? "")
                        if let remote, let desiredStart, let desiredEnd,
                           CareerApplication.date(remote.text("answer_plan_start_at")) == desiredStart,
                           CareerApplication.date(remote.text("answer_plan_end_at")) == desiredEnd {
                            self.createdSession = remote; savedPlan = true
                        } else { throw originalError }
                    }
                }
                if stage == "offer" && offerIntent == "received" {
                    let app = self.current!
                    try await saveOffer(app)
                }
            }
            completed()
        } catch {
            if case APIError.server(let status, let code) = error, [400, 422, 409].contains(status), code != "INTERVIEW_EDIT_CONFLICT" {
                if !staged { frozenStage = nil }; if !savedSession { frozenSession = nil }; frozenOffer = nil
            }
            if creating {
                if case APIError.server(let status, _) = error, (400..<500).contains(status) { creationUnknown = false }
                else { creationUnknown = true }
            }
            self.error = creationUnknown ? "创建结果尚未确认。请关闭后刷新岗位列表确认，避免重复创建。" : explain(error)
        }
        busy = false
    }
    private func explain(_ error: Error) -> String {
        if error is CancellationError { return "操作已取消。" }
        if case APIError.unauthorized = error { return "登录已失效，请关闭并重新登录。" }
        if case APIError.server(let status, let code) = error {
            if status == 409 { return "服务端状态发生变化或操作冲突（\(code)）。请刷新后重试；已保存步骤不会回滚。" }
            if status == 403 { return "当前服务尚未开放桌面岗位权限，请更新服务端后重试。" }
            return "操作失败（\(code)），你的输入已保留。"
        }
        return "连接失败，输入已保留。可重试；如已保存部分步骤，请先确认服务端状态。"
    }
}
