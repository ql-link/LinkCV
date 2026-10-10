import AppKit
import UniformTypeIdentifiers
import DrawOfferCore
import DrawOfferRender
import SwiftUI

/// 「我的简历」：按 Web `features/home/HomePage.tsx` 的 02.1 列表结构，读取本人简历、预览纸面、导出 PDF，
/// 并提供编辑、导入、重命名、复制、分享与删除。新建经模板页；编辑进入原生编辑器（正文、格式、版式与模板）。
struct ResumesView: View {
    @Environment(SessionStore.self) private var session
    /// 刚创建的简历：列表加载后自动打开预览。
    @Binding var focusResumeID: String?
    /// 正在编辑的简历；首页“继续编辑”也通过它直接进入编辑器。
    @Binding var editResumeID: String?
    let browse: () -> Void
    let login: () -> Void

    @State private var resumes: [ResumeSummary] = []
    @State private var loadedAccount: String?
    @State private var loading = false
    @State private var loadError = false
    @State private var reload = UUID()
    @State private var query = ""
    @State private var preview: ResumeSummary?
    @State private var exportingID: String?
    @State private var notice: (text: String, failed: Bool)?
    @State private var renaming: ResumeSummary?
    @State private var copying: ResumeSummary?
    @State private var sharing: ResumeSummary?
    @State private var deleting: ResumeSummary?
    @State private var deleteBusy = false
    @State private var imports: [JSONValue] = []
    @State private var importing = false
    @State private var importPoll: UUID?
    private var atLimit: Bool { loaded && resumes.count >= ResumeRequest.maximumPerUser }

    private var account: String { if case .signedIn(let user) = session.phase { return user.id }; return "" }
    private var loaded: Bool { !account.isEmpty && loadedAccount == account }
    private var visible: [ResumeSummary] {
        let text = query.trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? resumes : resumes.filter { $0.title.localizedCaseInsensitiveContains(text) }
    }

    var body: some View {
        if let editResumeID, !account.isEmpty {
            ResumeEditorView(resumeID: editResumeID, close: { self.editResumeID = nil; reload = UUID() }).id(editResumeID)
        } else { listPage }
    }

    private var listPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                V3PageHead(eyebrow: ["RESUMES", account.isEmpty ? "游客预览" : loaded ? "\(resumes.count) 份" : "个人工作区"],
                           title: "我的简历", subtitle: atLimit ? "已达到 \(ResumeRequest.maximumPerUser) 份上限。删除不用的简历后，才能新建或复制。" : "每份简历独立编辑，需要时复制一份按岗位修改。") {
                    if !account.isEmpty {
                        Button { Task { await importFile() } } label: { Label(importing ? "正在上传…" : "导入简历", systemImage: "square.and.arrow.up") }
                            .buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(atLimit || importing)
                            .help(atLimit ? "已达 \(ResumeRequest.maximumPerUser) 份上限" : "导入 Markdown、DOCX 或 PDF 简历")
                        Button(action: browse) { Label("新建简历", systemImage: "plus") }
                            .buttonStyle(V3ButtonStyle(kind: .dark)).disabled(atLimit)
                            .help(atLimit ? "已达 \(ResumeRequest.maximumPerUser) 份上限" : "选择模板新建简历")
                    }
                }
                if account.isEmpty { GuestResumesEmpty(browse: browse, login: login) }
                else if loadError && !loaded { loadFailure }
                else if !loaded { skeleton }
                else if resumes.isEmpty && imports.isEmpty { emptyList }
                else { list }
                if let notice {
                    HStack(spacing: 10) {
                        Text(notice.text).font(V3.sans(12.5)).foregroundStyle(notice.failed ? V3.red : V3.sub)
                        Spacer()
                        Button { self.notice = nil } label: { Image(systemName: "xmark").font(.system(size: 10)) }
                            .buttonStyle(.plain).foregroundStyle(V3.fnt).accessibilityLabel("关闭提示")
                    }.padding(.top, 16)
                }
            }.frame(maxWidth: 860, alignment: .leading).padding(.horizontal, 52).padding(.vertical, 20)
                .frame(maxWidth: .infinity)
        }
        .task(id: "\(account)|\(reload)") { await load() }
        .task(id: importPoll) { if importPoll != nil { await pollImports() } }
        .onChange(of: account) { _, _ in
            // 退出或切换账号：清理上一账号的列表、预览与提示
            resumes = []; loadedAccount = nil; preview = nil; exportingID = nil; notice = nil; query = ""; loadError = false; imports = []
        }
        .sheet(item: $preview) { resume in
            ResumePreviewSheet(resume: resume, exporting: exportingID == resume.id,
                               export: { Task { await exportPDF(resume) } },
                               share: { preview = nil; sharing = resume }, edit: { preview = nil; editResumeID = resume.id }, close: { preview = nil })
                .frame(width: 960, height: 720)
        }
        .sheet(item: $renaming) { resume in
            ResumeTitleSheet(mode: .rename, resume: resume, close: { renaming = nil }, done: { title in
                renaming = nil; notice = ("已将简历重命名为「\(title)」", false); reload = UUID()
            })
        }
        .sheet(item: $copying) { resume in
            ResumeTitleSheet(mode: .copy, resume: resume, close: { copying = nil }, done: { title in
                copying = nil; notice = ("已复制为「\(title)」", false); reload = UUID()
            })
        }
        .sheet(item: $sharing) { resume in
            ResumeShareSheet(resume: resume, close: { sharing = nil })
        }
        .alert("删除这份简历？", isPresented: Binding(get: { deleting != nil }, set: { if !$0 && !deleteBusy { deleting = nil } }), presenting: deleting) { resume in
            Button("取消", role: .cancel) { deleting = nil }
            Button(deleteBusy ? "正在删除…" : "删除", role: .destructive) { Task { await delete(resume) } }
        } message: { resume in
            Text("「\(resume.title)」删除后无法恢复：公开分享链接会立即失效，关联的求职记录会解除关联，其他简历不受影响。")
        }
    }

    private var list: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("全部简历 ").font(V3.sans(14, weight: .medium)) + Text("\(resumes.count)").font(V3.number(14))
                Spacer()
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundStyle(V3.fnt)
                    TextField("搜索简历…", text: $query).textFieldStyle(.plain).font(V3.sans(13))
                }.padding(.horizontal, 10).frame(width: 220, height: 30)
                    .background(V3.field, in: RoundedRectangle(cornerRadius: 8))
                    .accessibilityLabel("搜索简历")
            }.padding(.top, 28)
            Divider().padding(.top, 12)
            if visible.isEmpty {
                Text("没有找到「\(query)」相关的简历").font(V3.sans(13)).foregroundStyle(V3.fnt)
                    .frame(maxWidth: .infinity, minHeight: 160)
            } else {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 199), spacing: 20)], alignment: .leading, spacing: 37) {
                    if query.isEmpty {
                        ForEach(imports, id: \.self) { task in importCard(task) }
                    }
                    ForEach(visible) { resume in
                        ResumeCard(resume: resume, exporting: exportingID == resume.id, atLimit: atLimit,
                                   open: { editResumeID = resume.id }, preview: { preview = resume }, export: { Task { await exportPDF(resume) } },
                                   rename: { renaming = resume }, copy: { copying = resume },
                                   share: { sharing = resume }, delete: { deleting = resume })
                    }
                    if query.isEmpty && !atLimit {
                        Button(action: browse) {
                            VStack(spacing: 10) {
                                Image(systemName: "plus").font(.system(size: 20))
                                Text("新建空白简历").font(V3.sans(13))
                            }.foregroundStyle(V3.fnt).frame(maxWidth: .infinity).aspectRatio(210.0 / 297, contentMode: .fit)
                                .overlay(RoundedRectangle(cornerRadius: 6).stroke(V3.cl, style: StrokeStyle(lineWidth: 1, dash: [4])))
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityLabel("新建简历：选择模板")
                    }
                }.padding(.top, 27)
            }
        }
    }

    private var skeleton: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 199), spacing: 20)], alignment: .leading, spacing: 37) {
            ForEach(0..<4, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 10) {
                    RoundedRectangle(cornerRadius: 6).fill(V3.field).aspectRatio(210.0 / 297, contentMode: .fit)
                    RoundedRectangle(cornerRadius: 3).fill(V3.field).frame(width: 120, height: 12)
                    RoundedRectangle(cornerRadius: 3).fill(V3.field).frame(width: 80, height: 10)
                }
            }
        }.padding(.top, 55).accessibilityLabel("正在加载我的简历…")
    }

    private var loadFailure: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.arrow.triangle.2.circlepath").font(.system(size: 30)).foregroundStyle(V3.fnt)
            Text("简历列表没能加载出来").font(V3.serif(18))
            Text("网络不稳定或服务暂时不可用，你的简历都还在，刷新一下试试。").font(V3.sans(13)).foregroundStyle(V3.sub)
            Button { reload = UUID() } label: { Label("重新加载", systemImage: "arrow.clockwise") }
                .buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(loading).padding(.top, 4)
        }.frame(maxWidth: .infinity).padding(.top, 80)
    }

    private var emptyList: some View {
        VStack(spacing: 12) {
            EmptyResumeArt().frame(width: 504, height: 236)
            Text("从第一份简历开始").font(V3.serif(18))
            Text("新建时选一套模板、起个名字；已有简历文件可以用「导入简历」。").font(V3.sans(13)).foregroundStyle(V3.sub)
            HStack(spacing: 20) {
                Button("新建简历 →", action: browse).buttonStyle(WebActionStyle())
                Button("导入简历", systemImage: "square.and.arrow.up") { Task { await importFile() } }.buttonStyle(.plain).disabled(importing)
            }.padding(.top, 8)
        }.frame(maxWidth: .infinity).padding(.top, 42)
    }

    private func load() async {
        let owner = account
        guard !owner.isEmpty else { return }
        loading = true; loadError = false
        defer { if owner == account { loading = false } }
        do {
            let result = try await session.api.listResumes()
            try Task.checkCancellation()
            guard owner == account else { return }
            resumes = result; loadedAccount = owner
            await loadImports(owner: owner)
            if let current = preview { preview = result.first { $0.id == current.id } }
            if let focus = focusResumeID {
                focusResumeID = nil
                if let created = result.first(where: { $0.id == focus }) {
                    preview = created; notice = ("已创建「\(created.title)」", false)
                }
            }
        } catch is CancellationError {
        } catch {
            guard owner == account else { return }
            if case APIError.unauthorized = error { session.reportAuthenticationFailure(); return }
            loadError = true
            if loaded { notice = ("刷新简历列表失败，当前显示的是上次读取的结果。", true) }
        }
    }

    // MARK: Import

    /// 导入任务卡（`GET /api/resume-overview` 的进行中与失败任务）；有进行中的任务时每 3 秒刷新，完成后刷新列表。
    private func loadImports(owner: String) async {
        guard let overview = try? await session.api.careerRequest(path: "/api/resume-overview", method: "GET", query: [:], body: nil),
              owner == account else { return }
        let active = overview["active_imports"]?.items ?? []
        let previousActive = imports.filter { $0.text("upload_status") != "failed" && $0.text("parse_status") != "failed" }.count
        imports = active + (overview["failed_imports"]?.items ?? [])
        // 有任务结束（成功生成简历或失败）时刷新简历列表
        if previousActive > active.count { reload = UUID() }
        if !active.isEmpty { importPoll = UUID() }
    }

    private func pollImports() async {
        let owner = account
        guard !owner.isEmpty, !imports.isEmpty else { return }
        try? await Task.sleep(for: .seconds(3))
        guard !Task.isCancelled, owner == account else { return }
        await loadImports(owner: owner)
    }

    private func importFile() async {
        guard !importing else { return }
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.pdf] + ["md", "docx"].compactMap { UTType(filenameExtension: $0) }
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let file = panel.url else { return }
        let owner = account
        importing = true; notice = nil
        defer { if owner == account { importing = false } }
        do {
            let templates = (try? await session.api.listResumeTemplates()) ?? []
            // Web 导入默认使用生产保留的 classic-technical-cn 版式，不可用时回退到第一套可选模板
            let template = templates.first { $0.key == "classic-technical-cn" } ?? templates.first
            let upload = try ResumeImportUpload(file: file, templateID: template?.id)
            _ = try await session.api.importResume(upload)
            guard owner == account else { return }
            notice = ("已开始导入「\(upload.fileName)」，解析完成后会出现在列表中。", false)
            await loadImports(owner: owner)
        } catch {
            guard owner == account else { return }
            if case APIError.unauthorized = error { session.reportAuthenticationFailure(); return }
            notice = (ResumeImportUpload.errorMessage(error), true)
        }
    }

    private func importCard(_ task: JSONValue) -> some View {
        let failed = task.text("upload_status") == "failed" || task.text("parse_status") == "failed"
        let stage = task.text("upload_status") == "uploading" ? "正在上传" : "正在解析"
        return VStack(alignment: .leading, spacing: 10) {
            VStack(spacing: 10) {
                if failed { Image(systemName: "exclamationmark.triangle").font(.system(size: 24)).foregroundStyle(V3.red) }
                else { ProgressView().controlSize(.small) }
                Text(failed ? (task.text("upload_status") == "failed" ? "上传失败" : "解析失败") : stage + "…").font(V3.sans(12)).foregroundStyle(failed ? V3.red : V3.sub)
            }.frame(maxWidth: .infinity).aspectRatio(210.0 / 297, contentMode: .fit)
                .background(failed ? V3.redSoft : V3.stage, in: RoundedRectangle(cornerRadius: 6))
            Text(task.text("source_filename")).font(V3.sans(13, weight: .medium)).lineLimit(1)
            HStack {
                Text(failed ? "可以删除记录后重新导入" : "\(stage) · 请稍候").font(V3.sans(11)).foregroundStyle(failed ? V3.red : V3.fnt)
                Spacer()
                if failed {
                    Button("删除记录") { Task { await deleteImport(task) } }.buttonStyle(.link).font(V3.sans(11))
                }
            }
        }
    }

    private func deleteImport(_ task: JSONValue) async {
        do {
            _ = try await session.api.careerRequest(path: "/api/resume-imports/\(task.text("id"))", method: "DELETE", query: [:], body: nil)
            imports.removeAll { $0.text("id") == task.text("id") }
            notice = ("已删除「\(task.text("source_filename"))」的失败记录", false)
        } catch { notice = ("删除失败记录失败，请稍后重试。", true) }
    }

    private func exportPDF(_ resume: ResumeSummary) async {
        guard exportingID == nil else { return }
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = ResumesView.fileName(resume.title)
        guard panel.runModal() == .OK, let destination = panel.url else { return }
        let owner = account
        exportingID = resume.id; notice = nil
        defer { if owner == account { exportingID = nil } }
        do {
            let data = try await session.api.downloadResumePDF(id: resume.id, lockVersion: resume.lockVersion)
            guard owner == account else { return }
            try data.write(to: destination, options: .atomic)
            notice = ("已导出「\(resume.title)」", false)
        } catch {
            guard owner == account, !(error is CancellationError) else { return }
            if case APIError.unauthorized = error { session.reportAuthenticationFailure(); return }
            if case APIError.server(_, "RESUME_PDF_SNAPSHOT_STALE") = error {
                notice = ("简历已在其他设备更新，已刷新列表，请重新导出。", true); reload = UUID()
            } else if case APIError.server(_, "RESUME_NOT_FOUND") = error {
                notice = ("这份简历已不存在，已刷新列表。", true); preview = nil; reload = UUID()
            } else if error is CocoaError {
                notice = ("PDF 已生成，但保存到所选位置失败，请换个位置重试。", true)
            } else {
                notice = ("导出 PDF 失败，请稍后重试。", true)
            }
        }
    }

    private func delete(_ resume: ResumeSummary) async {
        guard !deleteBusy else { return }
        let owner = account
        deleteBusy = true
        defer { if owner == account { deleteBusy = false; deleting = nil } }
        do {
            _ = try await session.api.careerRequest(path: "/api/resumes/\(resume.id)", method: "DELETE", query: [:], body: nil)
            guard owner == account else { return }
            resumes.removeAll { $0.id == resume.id }
            if preview?.id == resume.id { preview = nil }
            notice = ("已删除「\(resume.title)」", false); reload = UUID()
        } catch {
            guard owner == account, !(error is CancellationError) else { return }
            if case APIError.unauthorized = error { session.reportAuthenticationFailure(); return }
            if case APIError.server(404, _) = error { notice = ("这份简历已不存在，已刷新列表。", true); reload = UUID(); return }
            notice = ("删除「\(resume.title)」失败，请刷新列表确认后重试。", true)
        }
    }

    /// 与后端 Content-Disposition 一致：保留中文标题，只替换文件系统不接受的字符。
    static func fileName(_ title: String) -> String {
        let cleaned = title.map { "/:\\\0".contains($0) ? "-" : $0 }.reduce(into: "") { $0.append($1) }
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (cleaned.isEmpty ? "resume" : cleaned) + ".pdf"
    }
}

/// `.hv3-card`：A4 缩略纸面 + 标题 + 更新时间；悬停出现 ⋯ 菜单。
private struct ResumeCard: View {
    @Environment(SessionStore.self) private var session
    let resume: ResumeSummary
    let exporting: Bool
    let atLimit: Bool
    let open: () -> Void
    let preview: () -> Void
    let export: () -> Void
    let rename: () -> Void
    let copy: () -> Void
    let share: () -> Void
    let delete: () -> Void
    @State private var hovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ZStack(alignment: .topTrailing) {
                Button(action: open) { ResumeThumbnail(resume: resume) }
                    .buttonStyle(.plain).accessibilityLabel("编辑 \(resume.title)")
                Menu {
                    Button("编辑", systemImage: "pencil", action: open)
                    Button("预览", systemImage: "eye", action: preview)
                    Button("在 Web 编辑器打开", systemImage: "safari") { WebBridge.openEditor(resume.id, api: session.api) }
                    Button("重命名", systemImage: "character.cursor.ibeam", action: rename)
                    Button(atLimit ? "复制为新简历（已达上限）" : "复制为新简历", systemImage: "doc.on.doc", action: copy).disabled(atLimit)
                    Button("分享链接", systemImage: "link", action: share)
                    Button(exporting ? "正在导出…" : "导出 PDF", systemImage: "arrow.down.doc", action: export).disabled(exporting)
                    Divider()
                    Button("删除", systemImage: "trash", role: .destructive, action: delete)
                } label: { Image(systemName: "ellipsis").font(.system(size: 12)).frame(width: 26, height: 26) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                    .background(.white, in: RoundedRectangle(cornerRadius: 6))
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(V3.cl))
                    .padding(8).opacity(hovered || exporting ? 1 : 0)
                    .accessibilityLabel("更多简历操作 \(resume.title)")
            }
            Text(resume.title).font(V3.sans(13, weight: .medium)).foregroundStyle(V3.txt).lineLimit(1).help(resume.title)
            Text(exporting ? "正在导出 PDF…" : "\(resume.updatedLabel()) · 已保存").font(V3.number(11, weight: .regular)).foregroundStyle(V3.fnt)
        }.onHover { hovered = $0 }
    }
}

private struct ResumeThumbnail: View {
    @Environment(SessionStore.self) private var session
    let resume: ResumeSummary
    @State private var paper: ResumeRenderRequest?
    @State private var failed = false

    var body: some View {
        GeometryReader { geometry in
            if let paper {
                ResumePaperView(request: paper, onError: { _ in failed = true })
                    .frame(width: 794, height: 1123)
                    .scaleEffect(geometry.size.width / 794, anchor: .topLeading)
                    .frame(width: geometry.size.width, height: geometry.size.height, alignment: .topLeading)
                    .allowsHitTesting(false)
            } else if !failed { ProgressView().controlSize(.small).frame(maxWidth: .infinity, maxHeight: .infinity) }
            if failed {
                Text("预览不可用").font(V3.sans(11)).foregroundStyle(V3.fnt)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }.aspectRatio(210.0 / 297, contentMode: .fit).background(.white)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(hex: 0xD3D3CE)))
            .task(id: "\(resume.id)|\(resume.lockVersion)") {
                paper = nil; failed = false
                guard let request = resume.renderRequest() else { failed = true; return }
                do { let result = try await session.api.preparePaper(request); try Task.checkCancellation(); paper = result.request }
                catch is CancellationError { }
                catch { failed = true }
            }
    }
}

/// 只读预览：连续纸面 + 导出 PDF。私有图片经桌面会话下载后注入，失败时保留正文并提示。
private struct ResumePreviewSheet: View {
    @Environment(SessionStore.self) private var session
    let resume: ResumeSummary
    let exporting: Bool
    let export: () -> Void
    let share: () -> Void
    let edit: () -> Void
    let close: () -> Void
    @State private var paper: ResumeRenderRequest?
    @State private var height: CGFloat = 1123
    @State private var missingImages = 0
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(resume.title).font(.title3.weight(.semibold)).lineLimit(1)
                    Text("\(resume.updatedLabel()) · 已保存").font(V3.sans(12)).foregroundStyle(V3.fnt)
                }
                Spacer()
                Button("编辑", action: edit).buttonStyle(V3ButtonStyle(kind: .ghost))
                Button("分享", action: share).buttonStyle(V3ButtonStyle(kind: .ghost))
                Button(exporting ? "正在导出…" : "导出 PDF", action: export).buttonStyle(WebActionStyle()).disabled(exporting)
                Button("关闭", action: close).buttonStyle(.plain).keyboardShortcut(.cancelAction)
            }.padding(20)
            Text("点“编辑”在原生编辑器修改内容、格式、版式与模板。最终排版以 PDF 为准，字体、换行与分页可能不同。")
                .font(V3.sans(12)).foregroundStyle(V3.fnt).padding(.horizontal, 20).padding(.bottom, 12)
            if missingImages > 0 { Text("部分图片不可用，正文仍可预览").font(V3.sans(12)).foregroundStyle(V3.orange).padding(.bottom, 8) }
            if let error { Text(error).font(V3.sans(12.5)).foregroundStyle(V3.red).padding(.bottom, 8) }
            ScrollView([.vertical, .horizontal]) {
                if let paper {
                    ResumePaperView(request: paper, onRendered: { height = max(1123, $0) }, onError: { error = $0 })
                        .frame(width: 794, height: height).padding(24)
                } else if error == nil { ProgressView("加载预览…").padding(40) }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Tokens.Color.stage)
        }.task(id: "\(resume.id)|\(resume.lockVersion)") {
            paper = nil; error = nil; missingImages = 0; height = 1123
            guard let request = resume.renderRequest() else { error = "这份简历暂时没有可用的预览，请打开编辑器保存一次后重试。"; return }
            do {
                let result = try await session.api.preparePaper(request)
                try Task.checkCancellation()
                paper = result.request; missingImages = result.missingImageCount
            } catch is CancellationError {
            } catch APIError.unauthorized {
                session.reportAuthenticationFailure(); error = "登录已失效，请重新登录。"
            } catch { self.error = "预览加载失败，请重试。" }
        }
    }
}

/// 游客空状态：沿用 Web 新用户引导，不代表已查询到账号没有简历。
private struct GuestResumesEmpty: View {
    let browse: () -> Void
    let login: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            Divider().padding(.top, 24)
            VStack(spacing: 12) {
                EmptyResumeArt().frame(width: 504, height: 236)
                Text("从第一份简历开始").font(V3.serif(18))
                Text("新建时选一套模板、起个名字；已有简历文件可以用「导入简历」。").font(V3.sans(13)).foregroundStyle(V3.sub)
                HStack(spacing: 20) {
                    Button("新建简历 →", action: browse).buttonStyle(WebActionStyle())
                    Button("导入简历", systemImage: "square.and.arrow.up", action: login).buttonStyle(.plain)
                }.padding(.top, 8)
                Text("内置示例可离线预览；登录后可查看和导出你的简历。").font(V3.sans(12)).foregroundStyle(V3.fnt).padding(.top, 8)
            }.frame(maxWidth: .infinity).padding(.top, 42)
        }
    }
}

/// 原生端没有的正文编辑等能力，在默认浏览器打开 Web 对应页面。网页使用自己的登录态，不传递桌面凭据。
enum WebBridge {
    static func open(_ path: String, api: any APIClient) {
        guard let origin = (api as? HTTPAPIClient)?.origin, path.hasPrefix("/"),
              let url = URL(string: path, relativeTo: origin)?.absoluteURL, ["https", "http"].contains(url.scheme ?? "") else { return }
        NSWorkspace.shared.open(url)
    }
    static func openEditor(_ resumeID: String, api: any APIClient) {
        guard resumeID.allSatisfy({ $0.isASCII && $0.isNumber }) else { return }
        open("/resumes/\(resumeID)/edit", api: api)
    }
}
