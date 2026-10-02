import AppKit
import LinkResumeCore
import SwiftUI

struct CareerButtonStyle: ButtonStyle {
    var primary = false
    var radius: CGFloat = 6
    var height: CGFloat = 34
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(LibraryTypography.sans(12, weight: .medium))
            .padding(.horizontal, 16).frame(height: height)
            .foregroundStyle(primary ? .white : Color(hex: 0x1D1D1B))
            .background(primary ? Color(hex: 0x1D1D1B) : .white, in: RoundedRectangle(cornerRadius: radius))
            .overlay(RoundedRectangle(cornerRadius: radius).stroke(primary ? .clear : Color(hex: 0xE4E4E0)))
            .opacity(configuration.isPressed ? 0.7 : 1)
    }
}
struct CareerIcon: View {
    let name: String
    var size: CGFloat = 20
    var body: some View {
        if let url = Bundle.module.url(forResource: name, withExtension: "png", subdirectory: "Career"), let image = NSImage(contentsOf: url) {
            Image(nsImage: image).resizable().scaledToFit().frame(width: size, height: size).accessibilityHidden(true)
        }
    }
}
struct CareerApplicationDetailView: View {
    let application: CareerApplication
    let api: any APIClient
    let back: () -> Void
    let perform: (String, CareerApplication) -> Void
    @State private var historyScroll = 0
    @State private var current: CareerApplication?
    @State private var sessions: [JSONValue] = []
    @State private var assets: [JSONValue] = []
    @State private var error: String?
    @State private var loading = true
    @State private var record: JSONValue?
    @State private var jobDescription: String?
    @State private var showJob = false
    @State private var refreshed = UUID()
    private var item: CareerApplication { (current ?? application).includingSessions(sessions) }
    private var flow: CareerFlow { CareerFlow(item) }
    private var stages: [JSONValue] { item.raw["stages"]?.items ?? [] }
    var body: some View {
        ScrollViewReader { proxy in ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                if loading { ProgressView("正在读取求职记录…") }
                if let error { HStack { Text(error).foregroundStyle(.red); Button("重试") { refreshed = UUID() } }.font(LibraryTypography.sans(12)) }
                pipeline
                nextAction
                HStack(alignment: .top, spacing: 24) {
                    history.id("career-history").frame(maxWidth: .infinity, alignment: .leading)
                    sidebar.frame(width: 276)
                }
            }.padding(.horizontal, 32).padding(.top, 35).padding(.bottom, 32).frame(maxWidth: 924)
                .frame(maxWidth: .infinity, alignment: .top)
        }.onChange(of: historyScroll) { _, _ in withAnimation { proxy.scrollTo("career-history", anchor: .top) } } }.foregroundStyle(Color(hex: 0x1D1D1B)).font(LibraryTypography.sans(13))
            .task(id: refreshed) { await load() }
            .sheet(item: Binding(get: { record.map(CareerRecord.init) }, set: { if $0 == nil { record = nil } })) { entry in
                CareerSessionRecordView(session: entry.value, api: api, close: { record = nil }, saved: { record = nil; refreshed = UUID() }).frame(width: 880, height: 740)
            }
            .sheet(isPresented: $showJob) {
                VStack(alignment: .leading, spacing: 20) { HStack { Text("岗位详情").font(LibraryTypography.serif(24)); Spacer(); Button("关闭") { showJob = false } }; ScrollView { Text(jobDescription ?? "正在读取岗位描述…").textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading) } }.padding(32).frame(width: 720, height: 600)
            }
    }
    private var header: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button("← 岗位看板 / " + item.company, action: back).buttonStyle(.plain).font(LibraryTypography.sans(12)).foregroundStyle(Color(hex: 0x96968F))
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(item.company + " · " + item.title).font(LibraryTypography.serif(28)).fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 10) { if !item.category.isEmpty { Text(item.categoryLabel).font(LibraryTypography.sans(11)).padding(.horizontal, 8).padding(.vertical, 4).background(Color(hex: 0xF4F4F1), in: RoundedRectangle(cornerRadius: 5)) }; Text(item.raw["job_snapshot"]?.text("work_city") ?? "").foregroundStyle(Color(hex: 0x55554F)); Text(date(item.raw.text("created_at")) + " 导入").foregroundStyle(Color(hex: 0x96968F)) }
                }
                Spacer(minLength: 12)
                Button("岗位详情") { showJob = true }.buttonStyle(CareerButtonStyle())
                Menu {
                    Button("修改求职分类") { perform("category", item) }
                    Button("编辑备注") { perform("notes", item) }
                    if item.stage == "offer" && !item.ended {
                        Button("修改 Offer 信息") { perform("offer", item) }
                        if item.raw.text("offer_status") == "received" { Button("婉拒 Offer") { perform("decline", item) } }
                    }
                    if !item.ended { Button(item.stage == "pending" ? "不投了" : "结束本次求职") { perform("terminate", item) } }
                    if item.raw.text("archived_at").isEmpty { Button("归档岗位") { perform("archive", item) } } else { Button("恢复岗位") { perform("restore", item) } }
                    if item.ended { Button("删除岗位", role: .destructive) { perform("delete", item) } }
                } label: { Text("⋯").font(.system(size: 20)).frame(width: 32, height: 34) }.menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            }
        }
    }
    private var pipeline: some View {
        let steps = CareerProgress.steps(item)
        return VStack(alignment: .leading, spacing: 14) {
            Text("求职进度").font(LibraryTypography.sans(14, weight: .medium))
            HStack(alignment: .top, spacing: 0) {
                ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            ZStack { Circle().fill(step.state == "current" ? Color(hex: 0x3F6FD8) : step.state == "completed" ? Color(hex: 0xF0F0EC) : .white).frame(width: 18, height: 18).overlay(Circle().stroke(step.state == "current" ? Color(hex: 0x3F6FD8) : Color(hex: 0xBBBBB5))); if step.state == "completed" { Text("✓").font(.system(size: 10)).foregroundStyle(Color(hex: 0x96968F)) } }
                            if index < steps.count - 1 { Rectangle().fill(Color(hex: 0xE4E4E0)).frame(height: 2) }
                        }.padding(.trailing, 6)
                        Text(step.label).font(LibraryTypography.sans(13, weight: step.state == "current" ? .medium : .regular)).foregroundStyle(step.state == "current" ? Color(hex: 0x3F6FD8) : Color(hex: 0x96968F)).lineLimit(2)
                        Text(step.date.isEmpty ? " " : date(step.date)).font(LibraryTypography.sans(11)).foregroundStyle(Color(hex: 0x96968F))
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }.padding(.horizontal, 20).padding(.vertical, 16).background(Color(hex: 0xFAFAF9), in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0xEDEDE9)))
    }
    private var nextAction: some View {
        HStack(spacing: 20) {
            VStack(spacing: 8) { Text(item.stageLabel).font(LibraryTypography.sans(15, weight: .medium)); Text(item.ended ? "已结束" : item.stage == "pending" ? "等待投递" : item.statusLabel).font(LibraryTypography.sans(10)).foregroundStyle(Color(hex: 0x96968F)) }.frame(width: 88, height: 88).background(Color(hex: 0xF0F0EC), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 8) { Text("下一步").font(LibraryTypography.sans(11)).foregroundStyle(Color(hex: 0x96968F)); Text(flow.headline).font(LibraryTypography.sans(19, weight: .medium)); Text(flow.explanation).font(LibraryTypography.sans(13)).foregroundStyle(Color(hex: 0x55554F)) }.frame(maxWidth: .infinity, alignment: .leading)
            Button(flow.button) {
                if flow.kind == "history" { historyScroll += 1 }
                else if flow.kind == "records" { if let latest = sessions.last(where: { $0.text("status") != "cancelled" && (flow.kind == "history" || $0.text("application_stage_id") == item.raw["current_stage"]?.text("id")) }) { record = latest } }
                else { perform(flow.kind, item) }
            }.buttonStyle(CareerButtonStyle(primary: true)).disabled(loading || error != nil || (flow.kind == "records" && sessions.isEmpty))
        }.padding(20).background(.white, in: RoundedRectangle(cornerRadius: 16)).overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(hex: 0xE6E6E2)))
    }
    private var history: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("阶段记录").font(LibraryTypography.sans(14, weight: .medium))
            if stages.isEmpty { Text("还没有阶段记录。记录投递后，会在这里留下求职进程。").font(LibraryTypography.sans(12)).foregroundStyle(Color(hex: 0x96968F)).padding(.top, 10) }
            ForEach(Array(stages.reversed().enumerated()), id: \.offset) { _, stage in
                VStack(alignment: .leading, spacing: 14) {
                    HStack { Text(stage.text("stage_label")).font(LibraryTypography.sans(14, weight: .medium)); Spacer(); Text(date(stage.text("entered_at"))).foregroundStyle(Color(hex: 0x96968F)) }
                    Text(stage.text("stage_status") == "completed" ? (stage.text("stage_result") == "rejected" ? "未通过" : "已完成") : item.ended ? "已结束" : "当前阶段").font(LibraryTypography.sans(11)).foregroundStyle(Color(hex: 0x55554F))
                    ForEach(Array(sessions.filter { $0.text("application_stage_id") == stage.text("id") }.enumerated()), id: \.offset) { _, entry in
                        Button { record = entry } label: {
                            HStack { CareerIcon(name: "calendar", size: 14); Text(date(entry.text("start_at"), time: true)); Spacer(); Text(["scheduled": "已安排", "completed": "已完成", "cancelled": "已取消"][entry.text("status")] ?? "查看记录"); Text("→") }.font(LibraryTypography.sans(12)).padding(12).background(Color(hex: 0xFAFAF9), in: RoundedRectangle(cornerRadius: 8))
                        }.buttonStyle(.plain)
                    }
                    if stage.text("stage_type") == "offer" { ForEach(["口头薪酬", "薪酬说明", "收到日期", "回复截止", "预计入职", "试用期", "Offer 材料"], id: \.self) { field in let value = CareerNotes.value(field, in: item.raw.text("notes")); if !value.isEmpty { info(field, field == "收到日期" ? date(value) : value) } }; Text(item.raw.text("offer_status") == "none" ? "OC · 口头意向" : "正式 Offer").font(LibraryTypography.sans(12)); if !item.raw.text("offer_salary").isEmpty { Text("薪资：" + item.raw.text("offer_salary") + " " + item.raw.text("offer_salary_currency")) }; if !item.raw.text("offer_base_location").isEmpty { Text("工作地点：" + item.raw.text("offer_base_location")) }; if !item.raw.text("offer_benefits_description").isEmpty { Text(item.raw.text("offer_benefits_description")) } }
                }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0xE6E6E2)))
            }
        }
    }
    private var sidebar: some View {
        VStack(spacing: 14) {
            sideCard("投递信息", edit: "编辑备注", action: { perform("notes", item) }) {
                info("投递日期", date(item.raw.text("applied_at")))
                info("投递渠道", CareerNotes.value("投递渠道", in: item.raw.text("notes")))
                info("简历", item.raw.text("resume_title_snapshot").isEmpty ? (item.raw.text("resume_id").isEmpty ? "未关联" : "已关联简历") : item.raw.text("resume_title_snapshot"))
                if !item.raw.text("notes").isEmpty { Text(CareerNotes.freeText(item.raw.text("notes"))).font(LibraryTypography.sans(12)).foregroundStyle(Color(hex: 0x55554F)).textSelection(.enabled) }
            }
            sideCard("关联资料", edit: nil, action: {}) {
                if assets.isEmpty { Text(sessions.isEmpty ? "暂无关联资料" : "在各轮记录中查看关联资料").foregroundStyle(Color(hex: 0x96968F)).font(LibraryTypography.sans(12)) }
                ForEach(Array(assets.enumerated()), id: \.offset) { _, asset in Text(asset.text("file_name").isEmpty ? asset.text("display_name") : asset.text("file_name")).font(LibraryTypography.sans(12)) }
            }
        }
    }
    private func sideCard<Content: View>(_ title: String, edit: String?, action: @escaping () -> Void, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) { HStack { Text(title).font(LibraryTypography.sans(13, weight: .medium)); Spacer(); if let edit { Button(edit, action: action).buttonStyle(.plain).font(LibraryTypography.sans(11)).foregroundStyle(Color(hex: 0x3F6FD8)) } }; content() }.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(.white, in: RoundedRectangle(cornerRadius: 14)).overlay(RoundedRectangle(cornerRadius: 14).stroke(Color(hex: 0xE6E6E2)))
    }
    private func info(_ name: String, _ value: String) -> some View { HStack { Text(name).foregroundStyle(Color(hex: 0x96968F)); Spacer(); Text(value.isEmpty ? "—" : value) }.font(LibraryTypography.sans(12)) }
    private func progress(_ type: String) -> Int { type == "pending" ? 0 : type == "screening" ? 1 : ["assessment", "written_test"].contains(type) ? 2 : type == "offer" ? 4 : 3 }
    private func date(_ raw: String, time: Bool = false) -> String { guard let date = CareerApplication.date(raw) else { return "—" }; let format = DateFormatter(); format.dateFormat = time ? "MM.dd HH:mm" : "MM.dd"; return format.string(from: date) }
    private func load() async {
        loading = true; error = nil
        do {
            let detail = try await api.careerRequest(path: "/api/job-applications/\(application.id)", method: "GET", query: [:], body: nil)
            var all: [JSONValue] = []; var cursor = ""; var seen = Set<String>()
            repeat {
                var query = ["application_id": application.id, "limit": "500", "include_archived": "true"]; if !cursor.isEmpty { query["cursor"] = cursor }
                let page = try await api.careerRequest(path: "/api/interview-sessions", method: "GET", query: query, body: nil)
                all += page["items"]?.items ?? []; cursor = page.text("next_cursor")
                if !cursor.isEmpty && !seen.insert(cursor).inserted { throw APIError.invalidResponse }
            } while !cursor.isEmpty
            let app = CareerApplication(detail["application"] ?? .null)
            if !app.raw.text("job_description_id").isEmpty {
                let jd = try await api.careerRequest(path: "/api/job-descriptions/\(app.raw.text("job_description_id"))", method: "GET", query: [:], body: nil)
                try Task.checkCancellation(); jobDescription = jd["job_description"]?.text("description") ?? "暂无岗位描述"
            }
            try Task.checkCancellation(); current = app; sessions = all.sorted { $0.text("start_at") < $1.text("start_at") }
        } catch is CancellationError { return } catch { self.error = "求职记录读取失败，请重试。" }
        loading = false
    }
}
private struct CareerRecord: Identifiable { let value: JSONValue; var id: String { value.text("id") } }

struct CareerSessionRecordView: View {
    let session: JSONValue
    let api: any APIClient
    let close: () -> Void
    let saved: () -> Void
    @State private var text = ""
    @State private var questions = ""
    @State private var improvement = ""
    @State private var busy = false
    @State private var error: String?
    @State private var loaded = false
    @State private var full: JSONValue = .null
    @State private var frozenCommand: String?
    @State private var command: String?
    @State private var payload: JSONValue?
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack { Text(session.text("stage_label") + " · 记录与复盘").font(LibraryTypography.serif(24)); Spacer(); Button("关闭", action: close).disabled(busy) }
            Text(session.text("start_at") + " · " + (["scheduled": "已安排", "completed": "已完成", "cancelled": "已取消"][session.text("status")] ?? "")).foregroundStyle(Color(hex: 0x96968F))
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("面试记录 / 文字稿").font(LibraryTypography.sans(14, weight: .medium)); TextEditor(text: $text).frame(minHeight: 180).border(Color(hex: 0xE4E4E0))
                    Text("问题记录").font(LibraryTypography.sans(14, weight: .medium)); TextEditor(text: $questions).frame(minHeight: 100).border(Color(hex: 0xE4E4E0))
                    Text("复盘与改进").font(LibraryTypography.sans(14, weight: .medium)); TextEditor(text: $improvement).frame(minHeight: 100).border(Color(hex: 0xE4E4E0))
                    if let error { Text(error).foregroundStyle(.red) }
                }.disabled(!loaded || busy || payload != nil)
            }
            HStack {
                Group { if session.text("status") == "scheduled" { Button("标记已完成") { command = "complete" }.buttonStyle(CareerButtonStyle()); Button("取消安排") { command = "cancel" }.buttonStyle(CareerButtonStyle()) } }.disabled(!loaded || busy || payload != nil)
                Spacer(); Button(busy ? "保存中…" : payload != nil ? "重试上次操作" : "保存记录") { Task { await save(frozenCommand == "edit" ? nil : frozenCommand) } }.buttonStyle(CareerButtonStyle(primary: true)).disabled(busy || !loaded)
            }
        }.padding(32).font(LibraryTypography.sans(13)).interactiveDismissDisabled(busy)
        .task { do { let result = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))", method: "GET", query: [:], body: nil); try Task.checkCancellation(); full = result["session"] ?? .null; guard !full.text("id").isEmpty else { throw APIError.invalidResponse }; text = full.text("review_summary"); questions = full.text("questions_markdown"); improvement = full.text("improvement_markdown"); loaded = true } catch is CancellationError { return } catch { self.error = "记录读取失败，请关闭后重试。" } }
        .confirmationDialog(command == "cancel" ? "确认取消这次安排？" : "确认标记为已完成？", isPresented: Binding(get: { command != nil }, set: { if !$0 { command = nil } })) {
            Button("确认") { let value = command; command = nil; Task { await save(value) } }
        }
    }
    private func save(_ command: String?) async {
        guard !busy && loaded else { return }; if payload != nil && frozenCommand != (command ?? "edit") { error = "请重试上次操作，或关闭后刷新确认状态。"; return }; busy = true; error = nil
        do {
            if payload == nil { frozenCommand = command ?? "edit" }
            if payload == nil { payload = .object(command == nil ? ["base_lock_version": full["lock_version"] ?? .number(1), "review_summary": .string(text), "questions_markdown": .string(questions), "improvement_markdown": .string(improvement)] : ["base_lock_version": full["lock_version"] ?? .number(1)]) }
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))" + (command.map { "/" + $0 } ?? ""), method: command == nil ? "PUT" : "POST", query: [:], body: payload)
            try Task.checkCancellation(); saved()
        } catch { self.error = "保存失败，输入已保留。请关闭后刷新确认状态，避免覆盖其他窗口的改动。" }
        busy = false
    }
}
