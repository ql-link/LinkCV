import LinkResumeCore
import SwiftUI

/// 岗位详情（Web `features/jobs/JobDetailPage.tsx` + `JobMatchCard.tsx`）：岗位信息、简历匹配度与 JD 覆盖、
/// 关联简历、个人备注、完整字段编辑与永久删除。分析只由用户触发；进行中每 3 秒轮询，最多 20 次。
struct JobDetailView: View {
    @Environment(SessionStore.self) private var session
    let jobID: String
    /// 打开详情的求职进程；用于关联简历与显示当前阶段。
    let application: JSONValue?
    let back: () -> Void
    let deleted: () -> Void

    @State private var job: JSONValue?
    @State private var app: JSONValue?
    @State private var loading = true
    @State private var error: String?
    @State private var notice: String?
    @State private var busy = false
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var editingNotes = false
    @State private var notesDraft = ""
    @State private var resumes: [ResumeSummary]?
    @State private var match: JobMatch?
    @State private var matchLoading = false
    @State private var analyzing = false
    @State private var matchError: String?
    @State private var reload = UUID()

    private var api: any APIClient { session.api }
    private var resumeID: String { (app ?? application)?.text("resume_id") ?? "" }
    private var hasDescription: Bool { !(job?.text("description").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) }
    private var matchScope: String { "\(jobID)|\(resumeID)|\(hasDescription)" }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Button(action: back) { Label("返回求职进度", systemImage: "chevron.left") }.buttonStyle(.plain)
                    .font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.sub)
                if loading && job == nil { ProgressView("正在加载岗位详情…").font(LibraryTypography.sans(12)).frame(maxWidth: .infinity, minHeight: 200) }
                else if let job { content(job) }
                else {
                    VStack(spacing: 10) {
                        Text("无法打开这个岗位").font(LibraryTypography.serif(20))
                        Text(error ?? "岗位服务暂时不可用，请稍后重试。").font(LibraryTypography.sans(13)).foregroundStyle(CareerPalette.sub)
                        Button("重试") { reload = UUID() }.buttonStyle(CareerActionStyle())
                    }.frame(maxWidth: .infinity, minHeight: 240)
                }
            }.frame(maxWidth: 860, alignment: .leading).padding(.horizontal, 52).padding(.vertical, 28).frame(maxWidth: .infinity)
        }
        .task(id: reload) { await load() }
        .task(id: matchScope) { await loadMatch() }
        .sheet(isPresented: $editing) {
            if let job { JobFieldsSheet(job: job, close: { editing = false }, saved: { updated in self.job = updated; editing = false; notice = "岗位信息已保存" }) }
        }
        .confirmationDialog("永久删除这个岗位？", isPresented: $confirmDelete) {
            Button(busy ? "正在删除…" : "永久删除", role: .destructive) { Task { await deleteJob() } }
        } message: {
            Text("\(job?.text("job_title") ?? "") · \(job?.text("company_name") ?? "") · 删除后无法恢复。求职进程、阶段、复盘和面试排期会一起删除；关联资料的原文件仍保留在资料库。")
        }
    }

    // MARK: - Layout

    private func content(_ job: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            header(job)
            if let error { Text(error).font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.red) }
            if let notice { Text(notice).font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.sub) }
            HStack(alignment: .top, spacing: 16) {
                matchCard.frame(maxWidth: .infinity, alignment: .topLeading)
                notesCard(job).frame(width: 276, alignment: .topLeading)
            }
            descriptionCard(job)
            companyCard(job)
        }
    }

    private func header(_ job: JSONValue) -> some View {
        let source = job.text("source_type") == "external_import" ? "插件导入" : job.text("source_type") == "manual" ? "手工创建" : "智能导入"
        let site = job.text("source_site")
        let stage = (app ?? application).map { $0["current_stage"]?.text("stage_label") ?? "" }.flatMap { $0.isEmpty ? nil : $0 }
            ?? (app ?? application)?.text("current_stage_label")
        let facts: [String] = [
            job.text("work_city"), label(JobDescriptionFields.employment, job.text("employment_type")),
            job.text("education_requirement"), job.text("experience_requirement"), label(JobDescriptionFields.workMode, job.text("work_mode")),
        ].filter { !$0.isEmpty }
        return VStack(alignment: .leading, spacing: 8) {
            Text("JOBS · \(job.text("company_name")) · 岗位详情").font(LibraryTypography.sans(12, weight: .medium)).foregroundStyle(CareerPalette.faint)
            HStack(spacing: 6) {
                Image(systemName: job.text("source_type") == "external_import" ? "puzzlepiece.extension" : "doc.text").font(.system(size: 11))
                Text([source, site].filter { !$0.isEmpty }.joined(separator: " · ") + " · 更新于 " + CareerFormat.monthDay(job.text("updated_at")))
                if let url = URL(string: job.text("source_url")), ["http", "https"].contains(url.scheme ?? "") { Link("打开来源", destination: url) }
            }.font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub)
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(job.text("job_title")).font(LibraryTypography.serif(28)).foregroundStyle(CareerPalette.text).textSelection(.enabled)
                if let stage, !stage.isEmpty, (app ?? application)?.text("status") == "active" { CareerChipView(stage, .blue) }
                Spacer()
                Button { confirmDelete = true } label: { Label("删除", systemImage: "trash") }.buttonStyle(CareerActionStyle()).disabled(busy)
                Button { editing = true } label: { Label("编辑岗位", systemImage: "pencil") }.buttonStyle(CareerActionStyle(kind: .primary)).disabled(busy)
            }
            HStack(spacing: 8) {
                Text(job.text("salary_text").nonEmptyOr("薪资未填写")).font(LibraryTypography.sans(15, weight: .medium))
                if !facts.isEmpty { Text("· " + facts.joined(separator: " · ")).font(LibraryTypography.sans(13)).foregroundStyle(CareerPalette.sub) }
            }
        }
    }

    private var matchCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("简历匹配度").font(LibraryTypography.sans(15, weight: .medium))
                Spacer()
                if let resumes { resumePicker(resumes) } else {
                    Button(resumeID.isEmpty ? "选择关联简历" : "更换简历") { Task { await loadResumes() } }
                        .buttonStyle(CareerActionStyle()).disabled(application == nil || busy)
                }
            }
            if resumeID.isEmpty {
                Text("还没有关联简历").font(LibraryTypography.serif(18))
                Text(application == nil ? "从求职进程打开岗位详情后可关联简历。" : "选一份简历后，会对照 JD 算出匹配度，并告诉你还缺哪些经历。")
                    .font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.sub)
            } else { matchBody }
        }.careerCard(padding: 20)
    }

    private var matchBody: some View {
        let ready = match?.ready == true && !analyzing ? match : nil
        let failedCode = !analyzing && match?.status == "failed" ? match?.errorCode : nil
        let failure = matchError ?? failedCode.map { JobMatch.errorMessage($0) }
        let title: String, note: String?
        if !hasDescription { title = "补充岗位描述后可分析"; note = "有了岗位描述才能对照简历计算匹配度。" }
        else if matchLoading { title = "正在读取分析结果…"; note = nil }
        else if analyzing { title = "正在分析…"; note = "正在对照岗位要求逐条检查这份简历，通常需要十几秒。" }
        else if let failure { title = "分析没有完成"; note = failure }
        else if let ready { title = ready.headline.map { "还缺：\($0)" } ?? "已覆盖主要要求"; note = ready.stale ? "简历或岗位描述已变化，这个分数可能已过期。" : nil }
        else { title = "还没有分析匹配度"; note = "点击下方按钮，对照岗位描述检查这份简历。" }
        return HStack(alignment: .top, spacing: 20) {
            VStack(spacing: 2) {
                Text(ready?.score.map(String.init) ?? "—").font(.system(size: 40, weight: .semibold).monospacedDigit())
                Text("匹配度").font(LibraryTypography.sans(11)).foregroundStyle(CareerPalette.faint)
                ProgressView(value: Double(ready?.score ?? 0), total: 100).frame(width: 96)
            }.frame(width: 120)
            VStack(alignment: .leading, spacing: 8) {
                Text("基于「\((app ?? application)?.text("resume_title_snapshot").nonEmptyOr("关联简历") ?? "关联简历")」")
                    .font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.faint)
                Text(title).font(LibraryTypography.serif(18)).fixedSize(horizontal: false, vertical: true)
                if let note { Text(note).font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.sub).fixedSize(horizontal: false, vertical: true) }
                if let ready {
                    if !ready.hits.isEmpty { tagGroup("已命中 · \(ready.hits.count)", ready.hits, tone: .green) }
                    if !ready.gaps.isEmpty { tagGroup("待补充 · \(ready.gaps.count)", ready.gaps, tone: .orange) }
                }
                Button { Task { await analyze() } } label: {
                    Label(analyzing ? "分析中…" : ready != nil || failure != nil ? "重新分析" : "分析匹配度", systemImage: "wand.and.stars")
                }.buttonStyle(CareerActionStyle()).disabled(!hasDescription || matchLoading || analyzing).padding(.top, 4)
            }
        }
    }

    private func tagGroup(_ label: String, _ words: [String], tone: CareerTone) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.faint)
            FlowTags(words: Array(words.prefix(6)) + (words.count > 6 ? ["等 \(words.count) 项"] : []), tone: tone)
        }
    }

    private func resumePicker(_ resumes: [ResumeSummary]) -> some View {
        Menu("选择简历") {
            if resumes.isEmpty { Text("还没有简历，请先在“我的简历”创建") }
            ForEach(resumes) { resume in
                Button(resume.title + (resume.id == resumeID ? "（当前）" : "")) { Task { await linkResume(resume) } }.disabled(resume.id == resumeID)
            }
            Divider()
            Button("取消") { self.resumes = nil }
        }.fixedSize().disabled(busy)
    }

    private func notesCard(_ job: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("个人备注").font(LibraryTypography.sans(15, weight: .medium))
                Spacer()
                if !editingNotes {
                    Button { notesDraft = job.text("notes"); editingNotes = true } label: { Image(systemName: "pencil") }
                        .buttonStyle(.plain).foregroundStyle(CareerPalette.faint).disabled(busy).accessibilityLabel("编辑备注")
                }
            }
            if editingNotes {
                TextEditor(text: $notesDraft).font(LibraryTypography.sans(13)).frame(minHeight: 120)
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(CareerPalette.control))
                HStack {
                    Spacer()
                    Button("取消") { editingNotes = false }.buttonStyle(CareerActionStyle(kind: .text)).disabled(busy)
                    Button(busy ? "保存中…" : "保存") { Task { await save(["notes": notesDraft]) { editingNotes = false } } }
                        .buttonStyle(CareerActionStyle(kind: .primary)).disabled(busy)
                }
            } else {
                Text(job.text("notes").nonEmptyOr("未填写")).font(LibraryTypography.sans(13))
                    .foregroundStyle(job.text("notes").isEmpty ? CareerPalette.faint : CareerPalette.text).textSelection(.enabled)
            }
        }.careerCard(padding: 20)
    }

    private func descriptionCard(_ job: JSONValue) -> some View {
        let skills = (job["skills"]?.items ?? []).compactMap(\.stringValue)
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("岗位描述").font(LibraryTypography.sans(15, weight: .medium))
                Spacer()
                if let ready = match, ready.ready, !analyzing, !(ready.covered.isEmpty && ready.missing.isEmpty) {
                    Text("已覆盖 \(ready.covered.count) · 待补充 \(ready.missing.count)").font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.faint)
                }
            }
            if hasDescription {
                NativeMarkdownView(source: job.text("description")).textSelection(.enabled)
                if let ready = match, ready.ready, !analyzing {
                    if !ready.covered.isEmpty { tagGroup("JD 中已覆盖", ready.covered, tone: .green) }
                    if !ready.missing.isEmpty { tagGroup("JD 中待补充", ready.missing, tone: .orange) }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("核心技能").font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.faint)
                    if skills.isEmpty { Text("未填写").font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.faint) }
                    else { FlowTags(words: skills, tone: .gray) }
                }
                HStack(alignment: .top, spacing: 24) {
                    info("工作安排", job.text("work_schedule"))
                    info("详细地址", job.text("work_address"))
                }
            } else {
                VStack(spacing: 10) {
                    Text("岗位描述暂未记录").font(LibraryTypography.serif(18))
                    Text("粘贴招聘网站上的岗位文字。有了岗位描述才能计算简历匹配度。").font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.sub)
                    Button { editing = true } label: { Label("粘贴岗位文字", systemImage: "text.alignleft") }.buttonStyle(CareerActionStyle())
                }.frame(maxWidth: .infinity).padding(.vertical, 20)
            }
        }.careerCard(padding: 20)
    }

    private func companyCard(_ job: JSONValue) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Text(String(job.text("company_name").prefix(1))).font(LibraryTypography.sans(16, weight: .semibold))
                    .frame(width: 40, height: 40).background(CareerPalette.field, in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(job.text("company_name")).font(LibraryTypography.sans(14, weight: .medium))
                    if !job.text("company_legal_name").isEmpty { Text(job.text("company_legal_name")).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.sub) }
                }
            }
            HStack(alignment: .top, spacing: 24) {
                info("行业", job.text("company_industry"))
                info("规模", job.text("company_size"))
                info("融资阶段", job.text("company_financing_stage"))
                info("招聘者", [job.text("recruiter_name"), job.text("recruiter_title")].filter { !$0.isEmpty }.joined(separator: " · "))
            }
            if !job.text("company_description").isEmpty {
                Text(job.text("company_description")).font(LibraryTypography.sans(13)).foregroundStyle(CareerPalette.sub).textSelection(.enabled)
            }
        }.careerCard(padding: 20)
    }

    private func info(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.faint)
            Text(value.nonEmptyOr("未填写")).font(LibraryTypography.sans(13)).foregroundStyle(value.isEmpty ? CareerPalette.faint : CareerPalette.text)
        }
    }

    private func label(_ options: [(String, String)], _ value: String) -> String { options.first { $0.0 == value }?.1 ?? value }

    // MARK: - Actions

    private func load() async {
        loading = true; error = nil
        defer { loading = false }
        do {
            let result = try await api.careerRequest(path: "/api/job-descriptions/\(jobID)", method: "GET", query: [:], body: nil)
            job = result["job_description"]
            if let id = application?.text("id"), !id.isEmpty,
               let latest = try? await api.careerRequest(path: "/api/job-applications/\(id)", method: "GET", query: [:], body: nil) {
                app = latest["application"] ?? latest["job_application"] ?? app
            }
        } catch is CancellationError {
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            self.error = JobDescriptionFields.errorMessage(error, fallback: "岗位服务暂时不可用，请稍后重试。")
        }
    }

    private func loadMatch() async {
        match = nil; matchError = nil; analyzing = false
        guard !resumeID.isEmpty, hasDescription else { return }
        let scope = matchScope
        matchLoading = true
        defer { if scope == matchScope { matchLoading = false } }
        do {
            let result = try await api.careerRequest(path: "/api/job-descriptions/\(jobID)/match", method: "GET", query: ["resume_id": resumeID], body: nil)
            guard scope == matchScope else { return }
            match = JobMatch(result["match"])
            if match?.pending == true { matchLoading = false; await poll(scope) }
        } catch is CancellationError {
        } catch { if scope == matchScope { matchError = JobMatch.errorMessage(nil) } }
    }

    private func analyze() async {
        guard !resumeID.isEmpty, hasDescription, !analyzing else { return }
        let scope = matchScope
        matchError = nil; analyzing = true
        do {
            let result = try await api.careerRequest(path: "/api/job-descriptions/\(jobID)/match:analyze", method: "POST", query: [:],
                                                     body: .object(["resume_id": .string(resumeID)]))
            guard scope == matchScope else { return }
            match = JobMatch(result["match"]); analyzing = false
            if match?.pending == true { await poll(scope) }
        } catch is CancellationError {
        } catch {
            guard scope == matchScope else { return }
            if case APIError.server(_, "JOB_MATCH_IN_PROGRESS") = error { await poll(scope); return }
            analyzing = false
            if case APIError.server(_, let code) = error { matchError = JobMatch.errorMessage(code) } else { matchError = JobMatch.errorMessage(nil) }
        }
    }

    private func poll(_ scope: String) async {
        analyzing = true
        defer { if scope == matchScope { analyzing = false } }
        for _ in 0..<JobMatch.pollLimit {
            do { try await Task.sleep(for: JobMatch.pollInterval) } catch { return }
            guard scope == matchScope else { return }
            guard let result = try? await api.careerRequest(path: "/api/job-descriptions/\(jobID)/match", method: "GET", query: ["resume_id": resumeID], body: nil) else { return }
            guard scope == matchScope else { return }
            match = JobMatch(result["match"])
            if match?.pending != true { return }
        }
    }

    private func loadResumes() async {
        do { resumes = try await api.listResumes() }
        catch { notice = "简历列表加载失败，请稍后重试。" }
    }

    private func linkResume(_ resume: ResumeSummary) async {
        guard let current = app ?? application, !busy else { return }
        busy = true; defer { busy = false }
        do {
            let result = try await api.careerRequest(path: "/api/job-applications/\(current.text("id"))", method: "PUT", query: [:],
                body: .object(["resume_id": .string(resume.id), "base_lock_version": .number(Double(current["lock_version"]?.integer ?? 1))]))
            app = result["application"] ?? result["job_application"]
            resumes = nil; notice = "已关联「\(resume.title)」"
            if app == nil { reload = UUID() }
        } catch { notice = CareerErrors.message(error).replacingOccurrences(of: "操作失败", with: "关联简历失败") }
    }

    private func save(_ changes: [String: String], then: () -> Void) async {
        guard let job, !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let result = try await api.careerRequest(path: "/api/job-descriptions/\(jobID)", method: "PUT", query: [:],
                                                     body: JobDescriptionFields.payload(record: job, changes: changes))
            self.job = result["job_description"] ?? job
            then()
        } catch { self.error = JobDescriptionFields.errorMessage(error, fallback: "保存岗位失败，请稍后重试。") }
    }

    private func deleteJob() async {
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            _ = try await api.careerRequest(path: "/api/job-descriptions/\(jobID)", method: "DELETE", query: [:], body: nil)
            deleted()
        } catch { self.error = JobDescriptionFields.errorMessage(error, fallback: "删除岗位失败，请稍后重试。") }
    }
}

/// 自动换行的标签组。
struct FlowTags: View {
    let words: [String]
    let tone: CareerTone
    var body: some View {
        FlowLayout(spacing: 6) { ForEach(Array(words.enumerated()), id: \.offset) { CareerChipView($0.element, tone) } }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: rows.last.map { $0.y + $0.height } ?? 0)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: bounds.minY + row.y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
        }
    }
    private func arrange(width: CGFloat, subviews: Subviews) -> [(indices: [Int], y: CGFloat, width: CGFloat, height: CGFloat)] {
        var rows: [(indices: [Int], y: CGFloat, width: CGFloat, height: CGFloat)] = []
        var current: [Int] = [], x: CGFloat = 0, y: CGFloat = 0, height: CGFloat = 0
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !current.isEmpty && x + size.width > width {
                rows.append((current, y, x - spacing, height)); y += height + spacing
                current = []; x = 0; height = 0
            }
            current.append(index); x += size.width + spacing; height = max(height, size.height)
        }
        if !current.isEmpty { rows.append((current, y, x - spacing, height)) }
        return rows
    }
}

/// 完整岗位字段编辑（Web 详情页的逐项编辑合并为一张表单）；PUT 提交完整字段与 base_lock_version。
private struct JobFieldsSheet: View {
    @Environment(SessionStore.self) private var session
    let job: JSONValue
    let close: () -> Void
    let saved: (JSONValue) -> Void
    @State private var values: [String: String] = [:]
    @State private var busy = false
    @State private var error: String?

    private func binding(_ key: String) -> Binding<String> { Binding(get: { values[key] ?? "" }, set: { values[key] = $0 }) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("编辑岗位").font(LibraryTypography.serif(20)).padding(24)
            Form {
                Section("岗位") {
                    TextField("职位名称（必填）", text: binding("job_title"))
                    TextField("公司名称（必填）", text: binding("company_name"))
                    picker("求职分类", "employment_type", JobDescriptionFields.employment)
                    TextField("工作地点", text: binding("work_city"))
                    picker("工作方式", "work_mode", JobDescriptionFields.workMode)
                    TextField("学历要求", text: binding("education_requirement"))
                    TextField("经验要求", text: binding("experience_requirement"))
                    TextField("工作安排", text: binding("work_schedule"))
                    TextField("详细地址", text: binding("work_address"))
                }
                Section("薪资") {
                    TextField("薪资原文（页头显示）", text: binding("salary_text"))
                    HStack {
                        TextField("最低", text: binding("salary_min"))
                        TextField("最高", text: binding("salary_max"))
                        TextField("币种", text: binding("salary_currency")).frame(width: 90)
                    }
                    picker("计薪周期", "salary_period", JobDescriptionFields.salaryPeriod)
                    TextField("年薪月数", text: binding("salary_months_per_year"))
                }
                Section("岗位描述（支持 Markdown，## 开头是小标题）") {
                    TextEditor(text: binding("description")).font(LibraryTypography.sans(13)).frame(minHeight: 180)
                    TextField("核心技能（用逗号分隔）", text: binding("skills"))
                }
                Section("公司") {
                    TextField("公司全称", text: binding("company_legal_name"))
                    TextField("公司 Logo URL", text: binding("logo_url"))
                    TextField("行业", text: binding("company_industry"))
                    TextField("公司规模", text: binding("company_size"))
                    TextField("融资阶段", text: binding("company_financing_stage"))
                    TextField("招聘者姓名", text: binding("recruiter_name"))
                    TextField("招聘者职位", text: binding("recruiter_title"))
                    TextEditor(text: binding("company_description")).font(LibraryTypography.sans(13)).frame(minHeight: 80)
                }
            }.formStyle(.grouped)
            if let error { Text(error).font(LibraryTypography.sans(12.5)).foregroundStyle(CareerPalette.red).padding(.horizontal, 24) }
            HStack {
                Spacer()
                Button("取消", action: close).buttonStyle(CareerActionStyle()).disabled(busy).keyboardShortcut(.cancelAction)
                Button(busy ? "保存中…" : "保存", action: submit).buttonStyle(CareerActionStyle(kind: .primary)).disabled(busy)
            }.padding(24)
        }.frame(width: 640, height: 720)
            .onAppear {
                var initial: [String: String] = [:]
                for key in ["job_title", "company_name", "description"] + JobDescriptionFields.optionalText { initial[key] = job.text(key) }
                initial["skills"] = (job["skills"]?.items ?? []).compactMap(\.stringValue).joined(separator: ", ")
                initial["salary_months_per_year"] = job["salary_months_per_year"]?.numberValue.map { String(Int($0)) } ?? ""
                values = initial
            }
    }

    private func picker(_ title: String, _ key: String, _ options: [(String, String)]) -> some View {
        Picker(title, selection: binding(key)) {
            Text("未填写").tag("")
            ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
        }
    }

    private func submit() {
        guard !busy else { return }
        guard !(values["job_title"] ?? "").trimmingCharacters(in: .whitespaces).isEmpty,
              !(values["company_name"] ?? "").trimmingCharacters(in: .whitespaces).isEmpty else { error = "职位名称和公司名称为必填项。"; return }
        if let months = values["salary_months_per_year"], !months.trimmingCharacters(in: .whitespaces).isEmpty, Int(months.trimmingCharacters(in: .whitespaces)) == nil {
            error = "年薪月数需要填写整数。"; return
        }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                let result = try await session.api.careerRequest(path: "/api/job-descriptions/\(job.text("id"))", method: "PUT", query: [:],
                                                                 body: JobDescriptionFields.payload(record: job, changes: values))
                saved(result["job_description"] ?? job)
            } catch { self.error = JobDescriptionFields.errorMessage(error, fallback: "保存岗位失败，请稍后重试。") }
        }
    }
}
