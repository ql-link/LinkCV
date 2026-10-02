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
}

struct JobsBoardView: View {
    @Environment(SessionStore.self) private var session
    let requireAccount: () -> Void
    @State private var applications: [CareerApplication] = []
    @State private var overview: JSONValue = .null
    @State private var logos: [String: NSImage] = [:]
    @State private var pendingLogos = Set<String>()
    @State private var loading = false
    @State private var failure: String?
    @State private var filterOpen = false
    @State private var query = ""
    @State private var mode = "board"
    @State private var earliest = false
    @State private var grouped = false
    @State private var hidden = Set<String>()
    @State private var order: [String] = []
    @State private var selected: CareerApplication?
    @State private var action: JobAction?
    @State private var pendingAction: String?
    @State private var refreshing = UUID()
    private var account: String { if case .signedIn(let user) = session.phase { return user.id }; return "" }
    private var allColumns: [String] {
        let available = CareerStage.columns(applications)
        return order.filter { available.contains($0) } + available.filter { !order.contains($0) }
    }
    private var visible: [CareerApplication] {
        CareerStage.sorted(applications.filter { query.isEmpty || ($0.company + $0.title + $0.stageLabel).localizedCaseInsensitiveContains(query) }, earliest: earliest)
    }
    private func columnStage(_ column: String) -> String { applications.first { $0.column == column }?.stage ?? (column.hasPrefix("interview:") ? "interview" : column) }
    private func columnTitle(_ column: String) -> String { column.hasPrefix("interview:") ? String(column.dropFirst(10)) : CareerStage.label(column) }

    var body: some View {
        Group {
        if let selected {
            CareerApplicationDetailView(application: selected, api: session.api, back: { self.selected = nil }, perform: { kind, app in action = JobAction(kind: kind, application: app, stage: kind == "apply" ? "screening" : kind == "schedule-current" ? app.stage : CareerStage.nextStages(app).first(where: { $0 == "interview" }) ?? CareerStage.nextStages(app).first ?? "screening", label: kind == "stage" ? "第 \(max(1, (app.raw["current_round_no"]?.integer ?? 0) + 1)) 轮面试" : app.stageLabel, round: kind == "schedule-current" ? app.raw["current_round_no"]?.integer : nil) }).id(refreshing)
        } else { VStack(alignment: .leading, spacing: 0) {
            header
            statistics.padding(.top, 28).padding(.bottom, 26)
            Rectangle().fill(Color(hex: 0xEDEDE9)).frame(height: 1).padding(.bottom, 20)
            if loading { ProgressView("正在加载求职数据…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if let failure {
                VStack(spacing: 16) {
                    Text(failure).foregroundStyle(.red)
                    Button("重试") { refreshing = UUID() }.buttonStyle(WebActionStyle())
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                controls.padding(.bottom, 20)
                if mode == "list" { list }
                else {
                    GeometryReader { viewport in
                        ScrollView([.horizontal, .vertical]) {
                            VStack(alignment: .leading, spacing: 26) {
                                if grouped && !applications.isEmpty {
                                    ForEach(["实习", "校招", "正式", "未分类"], id: \.self) { category in
                                        let items = visible.filter { $0.categoryLabel == category }
                                        if !items.isEmpty {
                                            Text("\(category) · \(items.count)").font(.system(size: 13, weight: .semibold))
                                            board(items)
                                        }
                                    }
                                } else { board(visible, height: max(320, viewport.size.height - 24)) }
                            }.padding(.bottom, 24)
                        }
                    }

                }
            }
        }.padding(.horizontal, 32).padding(.top, 52).padding(.bottom, 20).frame(maxWidth: 924)
        } }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .task(id: account + refreshing.uuidString) { await load() }
        .sheet(item: $action) { item in
            CareerForm(action: item, applications: applications, api: session.api, completed: { action = nil; refreshing = UUID() }, close: { action = nil })
                .frame(width: 880, height: 740)
        }
        .onChange(of: account) { old, new in
            applications = []; overview = .null; logos = [:]; pendingLogos = []; query = ""; hidden = []; order = []; action = nil; selected = nil
            if new.isEmpty { pendingAction = nil }
            else if let pendingAction { action = JobAction(kind: pendingAction, application: nil); self.pendingAction = nil }
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                Text("CAREER · 本周 \(weekLabel)").font(.system(size: 11, weight: .medium)).foregroundStyle(Color(hex: 0x96968F))
                Text("岗位看板").font(LibraryTypography.serif(28))
                Text("\(applications.filter { !$0.ended }.count) 个进行中 · \(weeklyInterviews) 场面试")
                    .font(.system(size: 13)).foregroundStyle(Color(hex: 0x96968F))
            }
            Spacer()
            Button { open("arranged") } label: { Label("已有面试安排", systemImage: "calendar") }.buttonStyle(CareerButtonStyle()).padding(.top, 32)
            Button("导入岗位") { open("import") }.buttonStyle(CareerButtonStyle(primary: true)).padding(.top, 32)
        }
    }
    private var weekLabel: String {
        var calendar = Calendar.current; calendar.firstWeekday = 2
        let start = calendar.dateInterval(of: .weekOfYear, for: Date())!.start
        let end = calendar.date(byAdding: .day, value: 6, to: start)!
        let formatter = DateFormatter(); formatter.dateFormat = "M.d"
        return formatter.string(from: start) + " 至 " + formatter.string(from: end)
    }
    private var weeklyInterviews: Int { overview["metrics"]?["weekly_interviews"]?.integer ?? 0 }
    private var statistics: some View {
        let applied = applications.filter { $0.raw.text("phase") != "pending" && !$0.raw.text("applied_at").isEmpty }.count
        let interviews = applications.filter { ["interview", "hr", "ai_interview", "offer"].contains($0.raw.text("current_stage_type")) || ($0.raw["stages"]?.items ?? []).contains(where: { ["interview", "ai_interview", "offer"].contains($0.text("stage_type")) }) }.count
        let values = [account.isEmpty ? "—" : "\(applied)", account.isEmpty ? "—" : "\(weeklyInterviews)", applied == 0 ? "—" : "\(Int(Double(interviews) / Double(applied) * 100))%", account.isEmpty ? "—" : "\(overview["metrics"]?["offers_received"]?.integer ?? applications.filter { $0.stage == "offer" }.count)"]
        return HStack(spacing: 0) {
            ForEach(Array(["投递总数", "本周面试", "面试转化率", "Offer"].enumerated()), id: \.offset) { index, label in
                if index > 0 { Rectangle().fill(Color(hex: 0xE4E4E0)).frame(width: 1, height: 40) }
                VStack(alignment: .leading, spacing: 5) {
                    Text(loading ? "—" : values[index]).font(.system(size: 22, weight: .semibold, design: .rounded))
                    Text(label).font(.system(size: 11)).foregroundStyle(Color(hex: 0x96968F))
                }.frame(maxWidth: .infinity, alignment: .leading).padding(.leading, index == 0 ? 0 : 24)
            }
        }
    }
    private var controls: some View {
        HStack(spacing: 12) {
            HStack(spacing: 3) { ForEach(["board", "list"], id: \.self) { value in Button(value == "board" ? "看板" : "列表") { mode = value }.buttonStyle(.plain).font(LibraryTypography.sans(12)).frame(width: 60, height: 24).background(mode == value ? .white : .clear, in: RoundedRectangle(cornerRadius: 6)) } }.padding(3).background(Color(hex: 0xF4F4F2), in: RoundedRectangle(cornerRadius: 8)).accessibilityLabel("看板或列表")
            Spacer()
            Menu { Button("最近排期") { earliest = false }; Button("最先添加") { earliest = true }; Divider(); Button("刷新岗位") { refreshing = UUID() } } label: { Text("☷ 排序").font(LibraryTypography.sans(12)) }.menuStyle(.borderlessButton).fixedSize()
            Button { filterOpen.toggle() } label: { HStack(spacing: 6) { CareerIcon(name: "filter", size: 13); Text(query.isEmpty && hidden.isEmpty && !grouped ? "筛选" : "筛选 · 已启用") } }.buttonStyle(.plain).font(LibraryTypography.sans(12))
                .popover(isPresented: $filterOpen) {
                    VStack(alignment: .leading, spacing: 14) { TextField("搜索公司、岗位或阶段", text: $query).textFieldStyle(.roundedBorder); Toggle("按求职分类分组", isOn: $grouped); ForEach(allColumns, id: \.self) { column in Toggle(columnTitle(column), isOn: Binding(get: { !hidden.contains(column) }, set: { if $0 { hidden.remove(column) } else { hidden.insert(column) } })) }; Button("清除筛选") { query = ""; hidden = []; grouped = false } }.padding(20).frame(width: 250)
                }
        }
    }
    private func board(_ items: [CareerApplication], height: CGFloat = 400) -> some View {
        HStack(alignment: .top, spacing: 10) {
            ForEach(allColumns.filter { !hidden.contains($0) }, id: \.self) { column in
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 7) {
                        Circle().fill(tone(column)).frame(width: 7, height: 7)
                        Text(columnTitle(column)).font(.system(size: 12, weight: .medium))
                        Text("\(items.filter { $0.column == column }.count)").font(.system(size: 11)).foregroundStyle(Color(hex: 0x96968F))
                    }.padding(.horizontal, 6).frame(height: 32).contextMenu {
                        Button("向左移动") { moveColumn(column, -1) }; Button("向右移动") { moveColumn(column, 1) }
                    }.draggable("column:" + column)
                    let matches = items.filter { $0.column == column }
                    if matches.isEmpty { Text("暂无进程").font(.system(size: 11)).foregroundStyle(Color(hex: 0x96968F)) }
                    ForEach(matches) { item in card(item).draggable(item.movable ? "job:" + item.id : "disabled") }
                }.padding(.horizontal, 6).padding(.bottom, 6).frame(width: 164, alignment: .topLeading)
                    .frame(minHeight: height, alignment: .topLeading).background(Color(hex: 0xF7F7F5), in: RoundedRectangle(cornerRadius: 10))
                    .dropDestination(for: String.self) { values, _ in
                        guard let value = values.first else { return false }
                        if value.hasPrefix("column:") {
                            let source = String(value.dropFirst(7)); var columns = allColumns
                            guard let from = columns.firstIndex(of: source), let to = columns.firstIndex(of: column) else { return false }
                            columns.remove(at: from); columns.insert(source, at: to); order = columns; return true
                        }
                        guard value.hasPrefix("job:"), let item = applications.first(where: { "job:" + $0.id == value }), CareerStage.canAdvance(item, to: column, stage: columnStage(column)) else { return false }
                        action = JobAction(kind: column == "ended" ? "terminate" : "stage", application: item, stage: columnStage(column), label: columnTitle(column), round: applications.first { $0.column == column }?.raw["current_round_no"]?.integer)
                        return true
                    }
            }
        }
    }
    private func moveColumn(_ column: String, _ direction: Int) {
        var columns = allColumns
        guard let index = columns.firstIndex(of: column), columns.indices.contains(index + direction) else { return }
        columns.swapAt(index, index + direction); order = columns
    }
    private func tone(_ key: String) -> Color {
        if key.hasPrefix("interview") || key == "ai_interview" { return Color(hex: 0x3976CF) }
        if ["assessment", "written_test"].contains(key) { return Color(hex: 0xC68842) }
        return key == "offer" ? Color(hex: 0x478B66) : Color(hex: 0x96968F)
    }
    private func card(_ item: CareerApplication) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .top) {
                Button { selected = item } label: { Text(item.company + " · " + item.title).font(LibraryTypography.sans(12, weight: .medium)).lineLimit(1).multilineTextAlignment(.leading) }.buttonStyle(.plain)
                Spacer(minLength: 2)
            }
            if !item.category.isEmpty { Text(item.categoryLabel).font(LibraryTypography.sans(10)).padding(.horizontal, 6).padding(.vertical, 2).background(Color(hex: 0xF4F4F2), in: RoundedRectangle(cornerRadius: 4)) }
            Spacer(minLength: 0)
            HStack {
                Circle().fill(tone(item.stage)).frame(width: 5, height: 5)
                Text(item.stage == "pending" ? "等待确认投递" : item.statusLabel).font(LibraryTypography.sans(10.5)).foregroundStyle(Color(hex: 0x96968F)).lineLimit(1)
                Spacer()
                if let image = logos[item.id] {
                    Image(nsImage: image).resizable().scaledToFit().frame(width: 20, height: 20).clipShape(Circle())
                } else {
                    Text(String(item.company.prefix(1))).font(.system(size: 12, weight: .semibold)).frame(width: 20, height: 20).background(Color(hex: 0xF4F4F2), in: Circle()).help("未提供或无法读取公司 Logo")
                }
            }

        }.padding(.horizontal, 12).padding(.vertical, 10).frame(height: 88).background(.white, in: RoundedRectangle(cornerRadius: 9))
            .overlay(RoundedRectangle(cornerRadius: 9).stroke(Color(hex: 0xE4E4E0)))
            .contentShape(Rectangle()).onTapGesture { selected = item }
            .contextMenu { Button("查看详情") { selected = item }; if item.ended { Button("删除岗位", role: .destructive) { action = JobAction(kind: "delete", application: item) } } else { if item.stage == "offer" { Button("修改 Offer 信息") { action = JobAction(kind: "offer", application: item) }; if item.raw.text("offer_status") == "received" { Button("接受 Offer") { action = JobAction(kind: "accept", application: item) }; Button("婉拒 Offer") { action = JobAction(kind: "decline", application: item) } } }; Button("修改分类") { action = JobAction(kind: "category", application: item) }; Button("结束本次求职") { action = JobAction(kind: "terminate", application: item) } } }
            .task(id: account + item.raw.text("company_logo_url")) {
                guard let logo = item.logoRequest, logos[item.id] == nil, !pendingLogos.contains(item.id), logos.count + pendingLogos.count < 128 else { return }
                let owner = account; pendingLogos.insert(item.id)
                defer { if owner == account { pendingLogos.remove(item.id) } }
                do {
                    let result = try await session.api.careerRequest(path: logo.path, method: "GET", query: ["v": logo.revision], body: nil)
                    try Task.checkCancellation()
                    if owner == account, let data = Data(base64Encoded: result.text("image_base64")), let image = NSImage(data: data) { logos[item.id] = image }
                } catch { /* Preserve the named company fallback. */ }
            }
    }
    private func timeLabel(_ item: CareerApplication) -> String {
        let field = item.ended ? "terminated_at" : item.stage == "pending" ? "created_at" : item.stage == "screening" ? "applied_at" : item.stage == "offer" ? "updated_at" : "next_session_start_at"
        guard let date = CareerApplication.date(item.raw.text(field)) else { return ["assessment", "written_test", "ai_interview", "interview"].contains(item.stage) ? "尚未安排" : "时间待确认" }
        let formatter = DateFormatter(); formatter.dateFormat = "M月d日 HH:mm"
        return formatter.string(from: date)
    }
    private var list: some View {
        ScrollView([.horizontal, .vertical]) {
            VStack(alignment: .leading, spacing: 0) {
                if grouped {
                    ForEach(["实习", "校招", "正式", "未分类"], id: \.self) { category in
                        let items = visible.filter { $0.categoryLabel == category }
                        if !items.isEmpty { Text("\(category) · \(items.count)").font(.headline).padding(.vertical, 16); table(items) }
                    }
                } else { table(visible) }
            }.frame(minWidth: 850)
        }
    }
    private func table(_ items: [CareerApplication]) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("公司 / 岗位").frame(maxWidth: .infinity, alignment: .leading)
                Text("分类").frame(width: 60); Text("当前进度").frame(width: 100)
                Text("最近安排").frame(width: 130); Text("投递日期").frame(width: 100); Text("更新时间").frame(width: 100)
            }.font(.system(size: 11)).foregroundStyle(Color(hex: 0x96968F)).padding(.vertical, 12)
            ForEach(items) { item in
                Divider()
                Button { selected = item } label: {
                    HStack {
                        Text(item.company + " · " + item.title).frame(maxWidth: .infinity, alignment: .leading)
                        Text(item.categoryLabel).frame(width: 60); Text(item.stageLabel).foregroundStyle(tone(item.stage)).frame(width: 100)
                        Text(timeLabel(item)).frame(width: 130)
                        Text(String(item.raw.text("applied_at").prefix(10)).isEmpty ? "—" : String(item.raw.text("applied_at").prefix(10))).frame(width: 100)
                        Text(String(item.raw.text("updated_at").prefix(10))).frame(width: 100)
                    }.font(.system(size: 12)).padding(.vertical, 16)
                }.buttonStyle(.plain)
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
            try Task.checkCancellation(); applications = result.map { $0.includingSessions(arrangements) }; overview = metrics
        } catch is CancellationError { return }
        catch APIError.unauthorized { session.reportAuthenticationFailure(); failure = "登录已失效，请重新登录。" }
        catch { failure = "岗位加载失败，请检查服务连接后重试。" }
        loading = false
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
    @State private var scheduled = false
    @State private var reuseCurrentStage = false
    @State private var allowConflict = false
    @State private var interviewMode = "video"
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(3600)
    @State private var window = false
    @State private var meeting = ""
    @State private var location = ""
    @State private var reason = "user_withdrew"
    @State private var offerReceived = Date()
    @State private var replyDeadline = ""
    @State private var startWork = ""
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

    private var heading: String { ["import": "导入岗位", "arranged": "已有面试安排", "stage": "添加下一阶段", "category": "修改求职分类", "terminate": "终止求职", "delete": "删除岗位", "detail": "求职详情", "plugin": "安装浏览器插件", "offer": "记录正式 Offer", "apply": "记录投递", "schedule-current": "安排时间", "accept": "接受 Offer", "decline": "婉拒 Offer", "archive": "归档岗位", "restore": "恢复岗位", "notes": "编辑备注", "schedule": "新建面试"][kind] ?? "岗位" }
    private var needsStage: Bool { ["stage", "apply", "schedule-current", "arranged", "schedule"].contains(kind) }
    private var creation: Bool { kind == "import" || (["arranged", "schedule"].contains(kind) && selectedExisting.isEmpty) }
    private var stageOptions: [String] {
        if kind == "offer" { return ["offer"] }
        if staged || reuseCurrentStage { return [stage] }
        let options = CareerStage.nextStages(current ?? applications.first { $0.id == selectedExisting })
        return kind == "schedule" ? options.filter { ["assessment", "written_test", "ai_interview", "interview"].contains($0) } : options
    }
    private var showSchedule: Bool { ["assessment", "written_test", "ai_interview", "interview"].contains(stage) }

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) { HStack { Text(heading).font(LibraryTypography.serif(22)); Spacer(); Button(action: close) { Text("×").font(.system(size: 24)).frame(width: 22, height: 22) }.buttonStyle(.plain).accessibilityLabel("关闭").disabled(busy) }; if let current { Text(current.company + " · " + current.title + " · 现在：" + current.statusLabel).font(LibraryTypography.sans(11)).foregroundStyle(Color(hex: 0x96968F)) } }.padding(.horizontal, 32).padding(.top, 28).padding(.bottom, 20)
            HStack(alignment: .top, spacing: 22) {
                formSummary.frame(width: 272)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
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
                        if current?.stage == "pending" || creation {
                            DatePicker("投递时间", selection: $appliedAt)
                            field("投递渠道（可选）", text: $channel)
                            Picker("投递简历（可选）", selection: $selectedResume) {
                                Text("不关联简历").tag("")
                                ForEach(Array(resumes.enumerated()), id: \.offset) { _, resume in Text(resume.text("title")).tag(resume.text("id")) }
                            }.disabled(frozenStage != nil)
                        }

                        stageTiles
                        if stage == "interview" {
                            field("面试名称", text: $label).disabled(frozenStage != nil || reuseCurrentStage)
                            Stepper("面试轮次：\(round)", value: $round, in: 1...100).disabled(frozenStage != nil || reuseCurrentStage)
                        }
                        if showSchedule {
                            Toggle("同时添加排期", isOn: $scheduled).disabled(staged || frozenStage != nil || kind == "schedule")
                            if scheduled {
                                if stage == "interview" { Picker("面试方式", selection: $interviewMode) { Text("视频").tag("video"); Text("现场").tag("onsite"); Text("电话").tag("phone"); Text("其他").tag("other") } }
                                Toggle("确认仍保存有时间冲突的安排", isOn: $allowConflict)
                                if ["assessment", "written_test"].contains(stage) { Toggle("开放作答窗口", isOn: $window) }
                                DatePicker(window ? "开放时间" : "开始时间", selection: $start)
                                DatePicker(window ? "完成期限" : "结束时间", selection: $end)
                                field("会议或作答链接（可选）", text: $meeting)
                                field("地点（可选）", text: $location)
                            }
                        }
                        if stage == "offer" {
                            if offerIntent == "none" { field("口头薪酬（可选）", text: $oralSalary) } else { formalOfferFields }
                        }
                        if staged { Text("阶段已保存，剩余排期或 Offer 信息尚待确认。重试将复用原请求。").font(.system(size: 12)).foregroundStyle(.orange) }
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
                }.padding(.trailing, 1).disabled(busy || frozenStage != nil && !staged || frozenSession != nil || frozenOffer != nil)
            } } .padding(.horizontal, 32)
            Spacer(minLength: 16)
            HStack {
                if current != nil && creation { Text("岗位已保存；后续步骤可继续重试。").font(.system(size: 12)).foregroundStyle(.secondary) }
                Spacer()
                Button("取消", action: close).buttonStyle(CareerButtonStyle(radius: 18, height: 36)).disabled(busy)
                if !["detail", "plugin"].contains(kind) {
                    Button(busy ? "正在保存…" : kind == "delete" ? "确认删除" : staged ? "重试剩余步骤" : ["offer": "记录 Offer", "apply": "记录投递", "stage": "添加阶段", "accept": "确认接受", "decline": "确认婉拒", "schedule-current": "保存安排"][kind] ?? "保存") { Task { await save() } }
                        .buttonStyle(CareerButtonStyle(primary: true, radius: 18, height: 36)).disabled(busy || creationUnknown)
                }
            }.padding(.horizontal, 32).padding(.bottom, 28)
        }.font(LibraryTypography.sans(13)).interactiveDismissDisabled(busy).onChange(of: selectedExisting) { _, id in
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
            let noteSource = current?.raw.text("notes") ?? ""
            channel = CareerNotes.value("投递渠道", in: noteSource); oralSalary = CareerNotes.value("口头薪酬", in: noteSource); replyDeadline = CareerNotes.value("回复截止", in: noteSource); startWork = CareerNotes.value("预计入职", in: noteSource); probation = CareerNotes.value("试用期", in: noteSource); offerMaterials = CareerNotes.value("Offer 材料", in: noteSource); salaryDescription = CareerNotes.value("薪酬说明", in: noteSource)
            let day = ISO8601DateFormatter(); if let parsed = day.date(from: CareerNotes.value("收到日期", in: noteSource)) { offerReceived = parsed }
            category = action.application?.category ?? ""; scheduled = ["arranged", "schedule"].contains(action.kind)
            if let seed = action.start { start = seed }; if let seed = action.end { end = seed }
            if kind == "schedule-current", let current { reuseCurrentStage = true; stage = current.stage; label = current.stageLabel; scheduled = true }
            if kind == "notes" { notes = current?.raw.text("notes") ?? "" }
            if kind == "detail" { await loadDetail() }
            else if needsStage {
                do { resumes = try await request("/api/resumes")["resumes"]?.items ?? [] }
                catch { self.error = "简历列表暂不可用，仍可不关联简历继续。 " + explain(error) }
            }
        }
    }
    private var offerNotes: String { CareerNotes.merging(["收到日期": ISO8601DateFormatter().string(from: offerReceived), "回复截止": replyDeadline, "预计入职": startWork, "试用期": probation, "Offer 材料": offerMaterials, "薪酬说明": salaryDescription], into: current?.raw.text("notes") ?? "") }
    private var formalOfferFields: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 16) { DatePicker("收到日期", selection: $offerReceived, displayedComponents: .date).frame(maxWidth: .infinity); field("回复截止（可选）", text: $replyDeadline) }
            HStack(spacing: 16) { field("薪酬说明（如 35K × 16 薪）", text: $salaryDescription); field("工作地点", text: $offerBase) }
            HStack(spacing: 16) { field("预计入职（可选）", text: $startWork); field("试用期（可选）", text: $probation) }
            field("Offer 材料（资料库文件名或备注，可选）", text: $offerMaterials)
            DisclosureGroup("结构化薪资与福利（可选）") {
                VStack(spacing: 12) { field("薪资数额", text: $offerSalary); HStack { Picker("币种", selection: $currency) { Text("CNY").tag("CNY"); Text("USD").tag("USD") }; Picker("计薪周期", selection: $salaryPeriod) { Text("月").tag("month"); Text("年").tag("year") } }; field("福利待遇", text: $benefits) }.padding(.top, 12)
            }
        }
    }
    private var stageTiles: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("阶段").font(LibraryTypography.sans(12, weight: .medium))
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 4), spacing: 8) {
                ForEach(["screening", "assessment", "written_test", "ai_interview", "interview", "hr", "oc", "formal"], id: \.self) { choice in
                    let key = ["hr": "interview", "oc": "offer", "formal": "offer"][choice] ?? choice
                    let chosen = stage == key && (key != "offer" || offerIntent == (choice == "formal" ? "received" : "none")) && (key != "interview" || (choice == "hr") == (label == "HR 面"))
                    let allowed = stageOptions.contains(key)
                    Button {
                        stage = key
                        if choice == "hr" { label = "HR 面" } else if choice == "interview" && label == "HR 面" { label = "面试" }
                        if key == "offer" { offerIntent = choice == "formal" ? "received" : "none" }
                    } label: {
                        VStack(spacing: 4) { CareerIcon(name: ["screening":"filter", "assessment":"text", "written_test":"edit", "ai_interview":"spark", "interview":"user", "hr":"brief", "oc":"phone", "formal":"mail"][choice]!); Text(["hr":"HR 面", "oc":"OC", "formal":"Offer", "interview":"面试"][choice] ?? CareerStage.label(key)).font(LibraryTypography.sans(12)) }
                            .frame(maxWidth: .infinity).frame(height: 58)
                            .background(chosen ? Color(hex: 0xFAFAF9) : .white, in: RoundedRectangle(cornerRadius: 10))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(chosen ? Color(hex: 0x1D1D1B) : Color(hex: 0xE4E4E0), lineWidth: chosen ? 1.5 : 1))
                    }.buttonStyle(.plain).foregroundStyle(Color(hex: 0x1D1D1B)).opacity(allowed ? 1 : 0.38).disabled(!allowed || staged || frozenStage != nil || reuseCurrentStage || kind == "offer")
                }
            }
        }
    }
    private var formSummary: some View {
        let previous = current?.raw["stages"]?.items.suffix(3) ?? []
        let next = !needsStage && kind != "offer" ? heading : kind == "offer" ? "Offer · 正式录用" : stage == "offer" ? offerIntent == "none" ? "OC · 口头录用意向" : "Offer · 正式录用" : stage == "interview" ? label : CareerStage.label(stage)
        return VStack(alignment: .leading, spacing: 20) {
            Text("这一场怎么安排").font(LibraryTypography.sans(11)).foregroundStyle(Color(hex: 0x96968F))
            VStack(alignment: .leading, spacing: 22) {
                ForEach(Array(previous.enumerated()), id: \.offset) { _, entry in
                    HStack(spacing: 9) { Circle().fill(Color(hex: 0x96968F)).frame(width: 6, height: 6); Text(entry.text("stage_label")).lineLimit(1); Spacer(minLength: 0); Text(entry.text("stage_status") == "completed" ? "已通过" : current?.stage == "offer" ? "已沟通" : current?.statusLabel ?? "").font(LibraryTypography.sans(10.5)).foregroundStyle(Color(hex: 0x96968F)) }.font(LibraryTypography.sans(12))
                }
                HStack(spacing: 9) { Circle().fill(Color(hex: 0x1D1D1B)).frame(width: 8, height: 8); Text(next).font(LibraryTypography.sans(12, weight: .medium)).lineLimit(1); Spacer(minLength: 0); Text("本次").font(LibraryTypography.sans(11)).padding(.horizontal, 7).padding(.vertical, 3).background(.white, in: Capsule()) }
            }
            Rectangle().fill(Color(hex: 0xE4E4E0)).frame(height: 1)
            Text("确认后会保存").font(LibraryTypography.sans(11)).foregroundStyle(Color(hex: 0x96968F))
            summaryRow("阶段", ["accept", "decline"].contains(kind) ? "本次求职将结束，历史会保留" : kind == "offer" ? "进入「Offer · 待确认」" : "进入「" + next + "」")
            if ["accept", "decline", "archive", "restore", "terminate"].contains(kind) {
                summaryRow("记录", "保留已有阶段与面试记录")
                summaryRow("确认", "此操作会更新该岗位的求职状态")
            } else if kind == "apply" {
                summaryRow("投递日期", summaryDate(appliedAt))
                summaryRow("投递渠道", channel)
            } else {
            summaryRow(kind == "offer" ? "回复截止" : "时间", kind == "offer" ? replyDeadline.isEmpty ? "可选，稍后完善" : replyDeadline : scheduled ? summaryDate(start) : "稍后安排")
            summaryRow(kind == "offer" ? "薪酬与地点" : "方式", kind == "offer" ? [salaryDescription, offerBase].filter { !$0.isEmpty }.joined(separator: " · ") : ["video":"视频", "onsite":"现场", "phone":"电话", "other":"其他"][interviewMode] ?? "其他")
            }
            Spacer(minLength: 0)
        }.padding(20).frame(maxHeight: .infinity, alignment: .topLeading).background { CareerIcon(name: "dot-grid", size: 572).frame(maxWidth: .infinity, maxHeight: .infinity).clipped() }.background(Color(hex: 0xF7F7F5), in: RoundedRectangle(cornerRadius: 14)).clipShape(RoundedRectangle(cornerRadius: 14))
    }
    private func summaryDate(_ date: Date) -> String { let formatter = DateFormatter(); formatter.locale = Locale(identifier: "zh_CN"); formatter.dateFormat = "MM-dd EEE HH:mm"; return formatter.string(from: date) }
    private func summaryRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top, spacing: 12) { CareerIcon(name: "brief", size: 14).frame(width: 28, height: 28).background(.white, in: RoundedRectangle(cornerRadius: 7)); VStack(alignment: .leading, spacing: 6) { Text(title).font(LibraryTypography.sans(11)).foregroundStyle(Color(hex: 0x96968F)); Text(value.isEmpty ? "可选，稍后完善" : value).font(LibraryTypography.sans(12)) } }.padding(.top, 4)
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
        if frozenOffer == nil { frozenOffer = .object(["base_lock_version": .number(Double(app.lockVersion)), "base_location": offerBase.isEmpty ? .null : .string(offerBase), "salary": offerSalary.isEmpty ? .null : .number(Double(offerSalary)!), "salary_currency": offerSalary.isEmpty ? .null : .string(currency), "salary_period": offerSalary.isEmpty ? .null : .string(salaryPeriod), "benefits_description": benefits.isEmpty ? .null : .string(benefits), "notes": .string(offerNotes)]) }
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
        if needsStage && scheduled && showSchedule && end <= start { error = "结束时间须晚于开始时间。"; return }
        if needsStage && stage == "interview" && label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { error = "请填写面试名称。"; return }
        if stage == "offer" && !offerSalary.isEmpty && (Double(offerSalary) == nil || Double(offerSalary)! < 0) { error = "请填写有效薪资。"; return }
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
                try await saveOffer(current)
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
                    if frozenStage == nil { frozenStage = .object(["client_request_id": .string(UUID().uuidString), "base_lock_version": .number(Double(current.lockVersion)), "stage_type": .string(stage), "stage_label": .string(stage == "interview" ? label : stage == "offer" && offerIntent == "none" ? "OC" : CareerStage.label(stage)), "interview_round_no": stage == "interview" ? .number(Double(round)) : .null, "applied_at": current.stage == "pending" ? .string(ISO8601DateFormatter().string(from: appliedAt)) : .null, "resume_id": selectedResume.isEmpty ? .null : .string(selectedResume), "notes": .string(CareerNotes.merging(["投递渠道": channel, "口头薪酬": oralSalary], into: current.raw.text("notes")))]) }
                    let result = try await api.careerRequest(path: "/api/job-applications/\(current.id)/stages", method: "POST", query: [:], body: frozenStage)
                    savedStage = result["application"]; self.current = CareerApplication(savedStage ?? .null); staged = true
                }
                if scheduled && showSchedule && !savedSession {
                    if frozenSession == nil {
                        let formatter = ISO8601DateFormatter()
                        frozenSession = .object(["client_request_id": .string(UUID().uuidString), "application_stage_id": savedStage?["current_stage"]?["id"] ?? .null, "stage_type": .string(stage == "interview" ? "interview" : "other"), "stage_label": .string(reuseCurrentStage ? (current.raw["current_stage"]?.text("stage_label") ?? label) : stage == "interview" ? label : CareerStage.label(stage)), "round_no": stage == "interview" ? .number(Double(round)) : .null, "start_at": .string(formatter.string(from: start)), "end_at": .string(formatter.string(from: end)), "schedule_kind": .string(window && ["assessment", "written_test"].contains(stage) ? "open_window" : "fixed_slot"), "timezone": .string(TimeZone.current.identifier), "mode": .string(stage == "interview" ? interviewMode : "other"), "allow_conflict": .bool(allowConflict), "meeting_url": meeting.isEmpty ? .null : .string(meeting), "location": location.isEmpty ? .null : .string(location)])
                    }
                    _ = try await api.careerRequest(path: "/api/job-applications/\(current.id)/interview-sessions", method: "POST", query: [:], body: frozenSession)
                    savedSession = true
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
