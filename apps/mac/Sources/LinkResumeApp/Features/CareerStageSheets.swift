import AppKit
import LinkResumeCore
import SwiftUI
import UniformTypeIdentifiers

/// 05.N20 添加记录: upload a recording or document to the session, attach from the library, or paste text.
struct CareerAddContentSheet: View {
    enum Mode: String, CaseIterable { case upload, library, text }
    let session: JSONValue
    let recordKind: String
    let initialMode: Mode
    let api: any APIClient
    let close: () -> Void
    let saved: () -> Void
    @State private var mode: Mode = .upload
    @State private var file: URL?
    @State private var text = ""
    @State private var datasets: [JSONValue]?
    @State private var busy = false
    @State private var error: String?
    @State private var upload: DatasetUpload?

    var body: some View {
        CareerSheet(title: "添加\(recordKind)内容", subtitle: "选择一种方式保存本场\(recordKind)记录。", width: 640) {
            HStack(spacing: 10) {
                ForEach(Mode.allCases, id: \.self) { item in
                    Button { mode = item; error = nil } label: {
                        VStack(spacing: 4) {
                            Image(systemName: item == .upload ? "square.and.arrow.up" : item == .library ? "folder" : "doc.text").font(.system(size: 14))
                            Text(item == .upload ? "上传文件" : item == .library ? "从资料库选择" : "粘贴文字").font(LibraryTypography.sans(12, weight: mode == item ? .medium : .regular))
                        }
                        .foregroundStyle(mode == item ? CareerPalette.text : CareerPalette.sub)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(.white, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(mode == item ? CareerPalette.text : CareerPalette.border, lineWidth: mode == item ? 1.5 : 1))
                    }.buttonStyle(.plain).disabled(busy)
                }
            }
            switch mode {
            case .upload:
                Button { choose() } label: {
                    VStack(spacing: 6) {
                        Image(systemName: "square.and.arrow.up").font(.system(size: 18)).foregroundStyle(CareerPalette.sub)
                        Text(file?.lastPathComponent ?? "点击选择或拖放文件").font(LibraryTypography.sans(13, weight: .medium))
                        Text(file.map { _ in "已选择" } ?? "支持音视频与 PDF、DOCX、Markdown、TXT").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.faint)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 32)
                    .background(CareerPalette.soft, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(CareerPalette.rail, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                }.buttonStyle(.plain).disabled(busy || upload != nil)
                    .onDrop(of: [UTType.fileURL], isTargeted: nil) { providers in
                        guard let provider = providers.first else { return false }
                        _ = provider.loadObject(ofClass: URL.self) { url, _ in if let url { Task { @MainActor in file = url } } }
                        return true
                    }
                if !recordKind.isEmpty && recordKind == "面试" { Text("录音上传后会自动转写为文字稿。").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint) }
            case .library:
                if let datasets {
                    if datasets.isEmpty { Text("资料库还没有可用的文件。").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint) }
                    VStack(spacing: 8) {
                        ForEach(Array(datasets.enumerated()), id: \.offset) { _, item in
                            HStack(spacing: 12) {
                                CareerFileBadge(name: item.text("file_name"), size: 34)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(item.text("file_name")).font(LibraryTypography.sans(13, weight: .medium)).lineLimit(1).truncationMode(.middle)
                                    Text(["audio": "录音", "video": "视频"][item.text("asset_kind")] ?? "文档").font(LibraryTypography.sans(11)).foregroundStyle(CareerPalette.faint)
                                }
                                Spacer()
                                Button("添加") { Task { await attach(item.text("id")) } }.buttonStyle(CareerActionStyle()).disabled(busy)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 10)
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(CareerPalette.border))
                        }
                    }
                } else { ProgressView("正在加载资料库…").font(LibraryTypography.sans(12)) }
            case .text:
                CareerTextArea(title: "", text: $text, placeholder: "粘贴\(recordKind)过程、逐字稿或整理后的文字记录…", minHeight: 220)
            }
            if let error { Text(error).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.red) }
        } footer: {
            Button("取消") { upload?.discard(); close() }.buttonStyle(CareerActionStyle(large: true)).disabled(busy)
            if mode != .library {
                Button(busy ? "保存中…" : upload != nil ? "重试上传" : "保存内容") { Task { await save() } }
                    .buttonStyle(CareerActionStyle(kind: .primary, large: true))
                    .disabled(busy || (mode == .text ? text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : file == nil))
            }
        }
        .frame(height: 560).interactiveDismissDisabled(busy)
        .task { mode = initialMode }
        .task(id: mode) {
            guard mode == .library, datasets == nil else { return }
            do {
                let result = try await api.careerRequest(path: "/api/datasets", method: "GET", query: [:], body: nil)
                datasets = (result["datasets"]?.items ?? result["items"]?.items ?? []).filter { DatasetRecord($0).ready }
            } catch { datasets = []; self.error = CareerErrors.message(error) }
        }
    }

    private func choose() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.audio, .movie, .pdf, .plainText, UTType(filenameExtension: "docx") ?? .data, UTType(filenameExtension: "md") ?? .plainText]
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK { file = panel.url; error = nil }
    }

    private func save() async {
        busy = true; error = nil; defer { busy = false }
        do {
            if mode == .text {
                _ = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))", method: "PUT", query: [:],
                                                body: .object(["questions_markdown": .string(text.trimmingCharacters(in: .whitespacesAndNewlines)), "base_lock_version": session["lock_version"] ?? .number(1)]))
            } else if let file {
                // The snapshot and its idempotency key survive a failed attempt, so a retry cannot create a second copy.
                if upload == nil { upload = try DatasetUpload.snapshot(file, session: session.text("id"), limit: 512 * 1024 * 1024) }
                guard let upload else { return }
                _ = try await api.uploadDataset(upload)
                upload.discard(); self.upload = nil
            }
            saved()
        } catch {
            if case APIError.server(let status, _) = error, (400..<500).contains(status), status != 409 { upload?.discard(); upload = nil }
            self.error = CareerErrors.message(error)
        }
    }

    private func attach(_ datasetID: String) async {
        busy = true; error = nil; defer { busy = false }
        do {
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))/assets/attach", method: "POST", query: [:], body: .object(["dataset_id": .string(datasetID)]))
            saved()
        } catch { self.error = CareerErrors.message(error) }
    }
}

/// Edit the transcript or questions of a session.
struct CareerTextSheet: View {
    let title: String
    let subtitle: String
    let initial: String
    let session: JSONValue
    let api: any APIClient
    let close: () -> Void
    let saved: () -> Void
    @State private var text = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        CareerSheet(title: title, subtitle: subtitle, width: 640) {
            CareerTextArea(title: "", text: $text, minHeight: 300)
            if let error { Text(error).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.red) }
        } footer: {
            Button("取消", action: close).buttonStyle(CareerActionStyle(large: true)).disabled(busy)
            Button(busy ? "保存中…" : "保存修改") { Task { await save() } }.buttonStyle(CareerActionStyle(kind: .primary, large: true))
                .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .frame(height: 520).interactiveDismissDisabled(busy)
        .task { text = initial }
    }
    private func save() async {
        busy = true; error = nil; defer { busy = false }
        do {
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))", method: "PUT", query: [:],
                                            body: .object(["questions_markdown": .string(text.trimmingCharacters(in: .whitespacesAndNewlines)), "base_lock_version": session["lock_version"] ?? .number(1)]))
            saved()
        } catch { self.error = CareerErrors.message(error) }
    }
}

/// 复盘笔记: the round's review and how to answer next time.
struct CareerNotesSheet: View {
    let session: JSONValue
    let api: any APIClient
    let close: () -> Void
    let saved: () -> Void
    @State private var summary = ""
    @State private var improvement = ""
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        CareerSheet(title: "复盘笔记", subtitle: session.text("stage_label"), width: 640) {
            CareerTextArea(title: "这一轮的复盘", text: $summary, placeholder: "哪些问题答得好，哪里卡住了")
            CareerTextArea(title: "下次怎么答", text: $improvement, placeholder: "先一句结论，再讲动机和自己负责的部分")
            if let error { Text(error).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.red) }
        } footer: {
            Button("取消", action: close).buttonStyle(CareerActionStyle(large: true)).disabled(busy)
            Button(busy ? "保存中…" : "保存") { Task { await save() } }.buttonStyle(CareerActionStyle(kind: .primary, large: true)).disabled(busy)
        }
        .frame(height: 480).interactiveDismissDisabled(busy)
        .task { summary = session.text("review_summary"); improvement = session.text("improvement_markdown") }
    }
    private func save() async {
        busy = true; error = nil; defer { busy = false }
        func value(_ text: String) -> JSONValue { let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines); return trimmed.isEmpty ? .null : .string(trimmed) }
        do {
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))", method: "PUT", query: [:],
                                            body: .object(["review_summary": value(summary), "improvement_markdown": value(improvement), "base_lock_version": session["lock_version"] ?? .number(1)]))
            saved()
        } catch { self.error = CareerErrors.message(error) }
    }
}

/// 05.N22 AI 复盘: show what the analysis is based on, then start it in the background.
struct CareerAnalysisSheet: View {
    let detail: JSONValue
    let audioName: String?
    let api: any APIClient
    let close: () -> Void
    let started: () -> Void
    @State private var busy = false
    @State private var error: String?
    @State private var requestID = UUID().uuidString.lowercased()
    private var session: JSONValue { detail["session"] ?? .null }
    private var application: JSONValue { detail["application"] ?? .null }
    var body: some View {
        let range = CareerFormat.range(session.text("start_at"), session.text("end_at"))
        let sources: [(badge: String, name: String, meta: String, ready: Bool)] = [
            ("PDF", application.text("resume_title_snapshot").nonEmptyOr("投递简历"), "投递简历", !application.text("resume_title_snapshot").isEmpty),
            (audioName.map { CareerFileBadge.badge($0) } ?? "TXT", audioName ?? "面试文字稿", audioName == nil ? "文字记录" : "录音 · 已转写", !session.text("questions_markdown").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
            ("INFO", session.text("stage_label"), [range, session.text("interviewer_name")].filter { !$0.isEmpty }.joined(separator: " · "), true),
            ("MD", application.text("company_name_snapshot") + "_岗位JD.md", "岗位要求", !application.text("job_description_id").isEmpty),
            ("LIB", "资料库", "按题自动召回相关资料作为佐证", true),
        ]
        return CareerSheet(title: "AI 复盘", subtitle: [application.text("company_name_snapshot"), application.text("job_title_snapshot"), session.text("stage_label"), CareerFormat.monthDay(session.text("start_at"))].joined(separator: " · "), width: 560) {
            Text("分析依据").font(LibraryTypography.sans(12, weight: .medium))
            VStack(spacing: 8) {
                ForEach(sources, id: \.badge) { source in
                    HStack(spacing: 12) {
                        Text(source.badge).font(LibraryTypography.sans(8, weight: .medium)).foregroundStyle(CareerPalette.sub).frame(width: 34, height: 34)
                            .overlay(RoundedRectangle(cornerRadius: 8).stroke(CareerPalette.border))
                        VStack(alignment: .leading, spacing: 2) {
                            Text(source.name).font(LibraryTypography.sans(13, weight: .medium)).lineLimit(1).truncationMode(.middle)
                            Text(source.meta).font(LibraryTypography.sans(11)).foregroundStyle(CareerPalette.faint).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        CareerChipView(source.ready ? "已就绪" : "未提供", source.ready ? .green : .gray)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10).overlay(RoundedRectangle(cornerRadius: 10).stroke(CareerPalette.border))
                }
            }
            if let error { Text(error).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.red) }
        } footer: {
            Button("取消", action: close).buttonStyle(CareerActionStyle(large: true)).disabled(busy)
            Button(busy ? "正在分析…" : "开始分析") { Task { await start() } }.buttonStyle(CareerActionStyle(kind: .primary, large: true))
                .disabled(busy || session.text("questions_markdown").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .frame(height: 560).interactiveDismissDisabled(busy)
    }
    private func start() async {
        busy = true; error = nil; defer { busy = false }
        do {
            // The same request id is reused on retry, so an unknown result cannot start a second generation.
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))/review:generate", method: "POST", query: [:],
                                            body: .object(["request_id": .string(requestID), "base_lock_version": session["lock_version"] ?? .number(1)]))
            started()
        } catch {
            if case APIError.server(let status, _) = error, [400, 404, 409].contains(status) { requestID = UUID().uuidString.lowercased() }
            if case APIError.server(_, let code) = error, code == "LLM_MODEL_NOT_CONFIGURED" { self.error = CareerErrors.message(error) }
            else { self.error = "复盘生成失败，原记录和已有报告已保留。" }
        }
    }
}

/// 05.N21 导入笔试题: three sources → numbered preview → save as the session's questions.
struct CareerWrittenImportSheet: View {
    enum Source: String, CaseIterable { case text, images, dataset }
    let detail: JSONValue
    let api: any APIClient
    let close: () -> Void
    let saved: (Int) -> Void
    @State private var source: Source = .text
    @State private var text = ""
    @State private var images: [URL] = []
    @State private var datasets: [JSONValue]?
    @State private var datasetID = ""
    @State private var preview: JSONValue?
    @State private var busy: String?
    @State private var error: String?
    private var session: JSONValue { detail["session"] ?? .null }
    private var application: JSONValue { detail["application"] ?? .null }
    private var ready: Bool { source == .text ? !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty : source == .images ? !images.isEmpty : !datasetID.isEmpty }
    private var questions: [JSONValue] { preview?["questions"]?.items ?? [] }

    var body: some View {
        CareerSheet(title: "导入笔试题", subtitle: [application.text("company_name_snapshot"), application.text("job_title_snapshot"), session.text("stage_label"), CareerFormat.monthDay(session.text("start_at"))].joined(separator: " · "), width: 880) {
            HStack(alignment: .top, spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("导入后").font(LibraryTypography.sans(11)).foregroundStyle(CareerPalette.hint)
                    ForEach([("题目列表", "按题号拆分，保存为这一场的题目"), ("作答记录", "逐题记录作答结果与思路"), ("截图不保存", "截图只用于这一次识别，识别后即丢弃")], id: \.0) { item in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.0).font(LibraryTypography.sans(12.5, weight: .medium))
                            Text(item.1).font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.sub)
                        }
                    }
                    if !session.text("questions_markdown").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("确认导入会替换这一场现有的题目。").font(LibraryTypography.sans(11.5)).foregroundStyle(CareerPalette.orange)
                    }
                    Spacer(minLength: 0)
                }
                .padding(16).frame(width: 260, alignment: .topLeading).frame(minHeight: 360, alignment: .top)
                .background(CareerPalette.chipGray, in: RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 14) {
                    Text("导入方式").font(LibraryTypography.sans(12, weight: .medium))
                    HStack(spacing: 10) {
                        ForEach(Source.allCases, id: \.self) { item in
                            Button { source = item; preview = nil; error = nil } label: {
                                VStack(spacing: 4) {
                                    Text(item == .text ? "≡" : item == .images ? "▣" : "⇪")
                                    Text(item == .text ? "粘贴文本" : item == .images ? "上传截图" : "资料库文档").font(LibraryTypography.sans(12, weight: source == item ? .medium : .regular))
                                }
                                .foregroundStyle(source == item ? CareerPalette.text : CareerPalette.sub)
                                .frame(maxWidth: .infinity).padding(.vertical, 12)
                                .background(.white, in: RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(source == item ? CareerPalette.text : CareerPalette.border, lineWidth: source == item ? 1.5 : 1))
                            }.buttonStyle(.plain).disabled(busy != nil)
                        }
                    }
                    switch source {
                    case .text:
                        CareerTextArea(title: "题目内容", text: $text, placeholder: "把笔试题目粘贴到这里，一道题一段或带题号都可以", minHeight: 120)
                            .onChange(of: text) { _, _ in preview = nil }
                    case .images:
                        HStack(spacing: 10) {
                            Button(images.isEmpty ? "选择截图" : "重新选择截图") { pickImages() }.buttonStyle(CareerActionStyle()).disabled(busy != nil)
                            Text(images.isEmpty ? "最多 5 张，按顺序识别，每张不超过 5MB" : images.map(\.lastPathComponent).joined(separator: "、"))
                                .font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint).lineLimit(2)
                        }
                    case .dataset:
                        Picker("资料库文档", selection: $datasetID) {
                            Text(datasets == nil ? "正在加载…" : datasets!.isEmpty ? "资料库还没有可用的文档" : "选择一份已解析的 PDF 或 Word 文档").tag("")
                            ForEach(datasets ?? [], id: \.self) { item in Text(item.text("file_name")).tag(item.text("id")) }
                        }
                        .disabled(datasets == nil).onChange(of: datasetID) { _, _ in preview = nil }
                        .task {
                            guard datasets == nil else { return }
                            do {
                                let result = try await api.careerRequest(path: "/api/datasets", method: "GET", query: [:], body: nil)
                                datasets = (result["datasets"]?.items ?? result["items"]?.items ?? [])
                                    .filter { ($0.text("asset_kind").isEmpty || $0.text("asset_kind") == "document") && $0.text("parse_status") == "succeeded" }
                            } catch { datasets = [] }
                        }
                    }
                    if let error { Text(error).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.red) }
                    HStack {
                        Text("识别结果").font(LibraryTypography.sans(12, weight: .medium))
                        Spacer()
                        if preview != nil { Text("识别到 \(questions.count) 题").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint) }
                    }
                    if preview != nil {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(Array(questions.enumerated()), id: \.offset) { index, item in
                                    if index > 0 { Rectangle().fill(CareerPalette.line).frame(height: 1) }
                                    HStack(alignment: .top, spacing: 12) {
                                        Text(String(format: "%02d", item["no"]?.integer ?? index + 1)).font(.system(size: 11, weight: .medium, design: .monospaced)).foregroundStyle(CareerPalette.hint)
                                        Text(item.text("text")).font(LibraryTypography.sans(12.5)).frame(maxWidth: .infinity, alignment: .leading)
                                    }.padding(.vertical, 8)
                                }
                            }.padding(.horizontal, 12).padding(.vertical, 4)
                        }
                        .frame(maxHeight: 220).overlay(RoundedRectangle(cornerRadius: 10).stroke(CareerPalette.border))
                    } else {
                        Text(busy == "extract" ? "正在识别…" : "点击「识别题目」后在这里预览，确认无误再导入").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        } footer: {
            Button("取消", action: close).buttonStyle(CareerActionStyle(large: true)).disabled(busy != nil)
            if preview != nil {
                Button(busy == "save" ? "保存中…" : "导入 \(questions.count) 题") { Task { await save() } }.buttonStyle(CareerActionStyle(kind: .primary, large: true)).disabled(busy != nil)
            } else {
                Button(busy == "extract" ? "正在识别…" : "识别题目") { Task { await extract() } }.buttonStyle(CareerActionStyle(kind: .primary, large: true)).disabled(!ready || busy != nil)
            }
        }
        .frame(height: 640).interactiveDismissDisabled(busy != nil)
    }

    private func pickImages() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, UTType(filenameExtension: "webp") ?? .image]
        panel.allowsMultipleSelection = true
        guard panel.runModal() == .OK else { return }
        let picked = panel.urls
        if picked.count > CareerUpload.maxImages { error = "一次最多上传 5 张截图。"; return }
        if picked.contains(where: { ((try? $0.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? Int.max) > CareerUpload.maxImageBytes }) { error = "每张截图不能超过 5MB。"; return }
        error = nil; preview = nil; images = picked
    }

    private func extract() async {
        busy = "extract"; error = nil; defer { busy = nil }
        do {
            var body: [String: JSONValue] = ["source": .string(source.rawValue)]
            switch source {
            case .text: body["text"] = .string(text)
            case .dataset: body["dataset_id"] = .string(datasetID)
            case .images:
                body["images"] = .array(try images.map { (url: URL) -> JSONValue in
                    let type = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"][url.pathExtension.lowercased()] ?? "application/octet-stream"
                    return JSONValue.object(["base64": .string(try Data(contentsOf: url).base64EncodedString()), "content_type": .string(type)])
                })
            }
            preview = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))/written-questions:extract", method: "POST", query: [:], body: .object(body))
        } catch { self.error = CareerErrors.message(error) }
    }

    private func save() async {
        guard let preview else { return }
        busy = "save"; error = nil; defer { busy = nil }
        do {
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))", method: "PUT", query: [:],
                                            body: .object(["questions_markdown": preview["markdown"] ?? .null, "base_lock_version": session["lock_version"] ?? .number(1)]))
            saved(questions.count)
        } catch { self.error = CareerErrors.message(error) }
    }
}

/// Personal answer plan inside an open-window test; it must stay within the official window.
struct CareerPlanSheet: View {
    let session: JSONValue
    let api: any APIClient
    let close: () -> Void
    let saved: () -> Void
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(3600)
    @State private var busy = false
    @State private var error: String?
    var body: some View {
        CareerSheet(title: "作答计划", subtitle: "开放窗口 " + CareerFormat.range(session.text("start_at"), session.text("end_at")), width: 520) {
            DatePicker("开始时间", selection: $start)
            DatePicker("结束时间", selection: $end)
            Text("计划只提醒自己，须落在开放与截止时间之内。").font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.hint)
            if let error { Text(error).font(LibraryTypography.sans(12)).foregroundStyle(CareerPalette.red) }
        } footer: {
            Button("取消", action: close).buttonStyle(CareerActionStyle(large: true)).disabled(busy)
            Button(busy ? "正在保存…" : "保存") { Task { await save() } }.buttonStyle(CareerActionStyle(kind: .primary, large: true)).disabled(busy)
        }
        .interactiveDismissDisabled(busy)
        .task {
            let windowStart = CareerApplication.date(session.text("start_at")) ?? Date()
            start = CareerApplication.date(session.text("answer_plan_start_at")) ?? windowStart
            end = CareerApplication.date(session.text("answer_plan_end_at")) ?? start.addingTimeInterval(3600)
        }
    }
    private func save() async {
        let windowStart = CareerApplication.date(session.text("start_at")) ?? .distantPast
        let windowEnd = CareerApplication.date(session.text("end_at")) ?? .distantFuture
        guard end > start, start >= windowStart, end <= windowEnd else { error = "我的作答计划必须在开放与截止时间内，结束须晚于开始。"; return }
        busy = true; error = nil; defer { busy = false }
        let formatter = ISO8601DateFormatter()
        do {
            _ = try await api.careerRequest(path: "/api/interview-sessions/\(session.text("id"))/answer-plan", method: "PUT", query: [:],
                                            body: .object(["base_lock_version": session["lock_version"] ?? .number(1), "answer_plan_start_at": .string(formatter.string(from: start)), "answer_plan_end_at": .string(formatter.string(from: end))]))
            saved()
        } catch { self.error = CareerErrors.message(error) }
    }
}
