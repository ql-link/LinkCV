import AppKit
import LinkResumeCore
import SwiftUI

/// 重命名（Web `RenameResumeDialog`）与复制为新简历。重命名只改列表标题，不写入正文；
/// 复制携带固定的 `client_request_id`，结果不确定时重试不会多复制一份。
struct ResumeTitleSheet: View {
    enum Mode { case rename, copy }
    @Environment(SessionStore.self) private var session
    let mode: Mode
    let resume: ResumeSummary
    let close: () -> Void
    let done: (String) -> Void
    @State private var title = ""
    @State private var busy = false
    @State private var error: String?
    @State private var requestID = UUID().uuidString.lowercased()

    private var normalized: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(mode == .rename ? "重命名简历" : "复制为新简历").font(V3.serif(20))
            Text(mode == .rename ? "只修改列表中用于识别的名称，不会改动简历正文。" : "基于「\(resume.title)」的当前版本复制一份，原简历不受影响。")
                .font(V3.sans(13)).foregroundStyle(V3.sub).fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 6) {
                Text("简历名称").font(V3.sans(12, weight: .medium)).foregroundStyle(V3.sub)
                TextField("简历名称", text: $title).textFieldStyle(.roundedBorder).onSubmit { submit() }
                    .onChange(of: title) { _, _ in if mode == .copy { requestID = UUID().uuidString.lowercased() } }
            }
            if let error { Text(error).font(V3.sans(12.5)).foregroundStyle(V3.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                Button("取消", action: close).buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(busy).keyboardShortcut(.cancelAction)
                Button(busy ? "正在保存…" : mode == .rename ? "保存" : "确认复制", action: submit)
                    .buttonStyle(V3ButtonStyle(kind: .dark))
                    .disabled(busy || normalized.isEmpty || (mode == .rename && normalized == resume.title))
            }
        }.padding(24).frame(width: 440)
            .onAppear { title = mode == .rename ? resume.title : "\(resume.title) 副本" }
    }

    private func submit() {
        let name = normalized
        guard !busy, !name.isEmpty else { return }
        guard name.count <= 255, !name.contains(where: \.isNewline) else { error = "名称无效，请输入 1–255 个字符且不含换行。"; return }
        if mode == .rename && name == resume.title { close(); return }
        busy = true; error = nil
        Task {
            defer { busy = false }
            do {
                switch mode {
                case .rename:
                    _ = try await session.api.careerRequest(path: "/api/resumes/\(resume.id)", method: "PUT", query: [:],
                        body: .object(["title": .string(name), "base_lock_version": .number(Double(resume.lockVersion))]))
                case .copy:
                    _ = try await session.api.careerRequest(path: "/api/resumes/\(resume.id)/copy", method: "POST", query: [:],
                        body: .object(["title": .string(name), "base_lock_version": .number(Double(resume.lockVersion)), "client_request_id": .string(requestID)]))
                }
                done(name)
            } catch {
                if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
                let fallback = mode == .rename ? "保存名称失败，请刷新列表后重试。" : "复制失败，请检查名称、简历数量或刷新后重试。"
                if case APIError.server = error { self.error = ResumeRequest.errorMessage(error, fallback: fallback) }
                else if case APIError.unauthorized = error { self.error = ResumeRequest.errorMessage(error, fallback: fallback) }
                else { self.error = mode == .copy ? "网络中断，结果尚未确认。可以直接重试，不会重复复制。" : "网络中断，结果尚未确认，请重试。" }
            }
        }
    }
}

/// 分享简历（Web `features/home/SharePanel.tsx`）：生成只读链接，设置谁可以查看、有效期与是否允许下载 PDF，
/// 支持复制、重新生成和删除链接。链接为 `{站点 origin}/share/{token}`。
struct ResumeShareSheet: View {
    private enum Expiry: String, CaseIterable, Identifiable {
        case week = "7 天", month = "30 天", forever = "永久"
        var id: String { rawValue }
        func date(now: Date = Date()) -> Date? {
            switch self {
            case .week: now.addingTimeInterval(7 * 86_400)
            case .month: now.addingTimeInterval(30 * 86_400)
            case .forever: nil
            }
        }
    }

    @Environment(SessionStore.self) private var session
    let resume: ResumeSummary
    let close: () -> Void
    @State private var share: ResumeShare?
    @State private var loaded = false
    @State private var loadFailed = false
    @State private var busy = false
    @State private var error: String?
    @State private var copied = false
    @State private var createPublic = true
    @State private var createExpiry = Expiry.week
    @State private var createAllowDownload = true
    @State private var confirmRegenerate = false
    @State private var confirmDelete = false

    private var origin: URL? { (session.api as? HTTPAPIClient)?.origin }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("分享简历").font(V3.serif(20))
            Text("为「\(resume.title)」生成只读链接，对方不用登录就能查看。").font(V3.sans(13)).foregroundStyle(V3.sub)
            if !loaded && !loadFailed {
                ProgressView("正在读取分享状态…").font(V3.sans(13)).frame(maxWidth: .infinity, minHeight: 120)
            } else if loadFailed {
                HStack {
                    Text("分享状态读取失败，请稍后重试。").font(V3.sans(13)).foregroundStyle(V3.red)
                    Spacer()
                    Button("重试") { Task { await load() } }.buttonStyle(V3ButtonStyle(kind: .ghost))
                }.frame(minHeight: 80)
            } else if let share { existing(share) }
            else { creation }
            if let error { Text(error).font(V3.sans(12.5)).foregroundStyle(V3.red).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Spacer()
                if loaded && share == nil {
                    Button("取消", action: close).buttonStyle(V3ButtonStyle(kind: .ghost)).keyboardShortcut(.cancelAction)
                    Button(busy ? "正在创建…" : "创建分享链接") { Task { await create() } }.buttonStyle(V3ButtonStyle(kind: .dark)).disabled(busy)
                } else {
                    Button("完成", action: close).buttonStyle(V3ButtonStyle(kind: .ghost)).keyboardShortcut(.cancelAction)
                }
            }
        }.padding(24).frame(width: 500)
            .task { await load() }
            .confirmationDialog("重新生成分享链接？", isPresented: $confirmRegenerate) {
                Button("确认重新生成") { Task { await regenerate() } }
            } message: {
                Text("重新生成后旧链接将立即失效，已转发的旧地址无法再访问。「\(resume.title)」的可见性与下载权限会保留。")
            }
            .confirmationDialog("删除分享链接？", isPresented: $confirmDelete) {
                Button("确认删除", role: .destructive) { Task { await deleteShare() } }
            } message: {
                Text("删除后旧地址将显示「分享链接已失效」，之后可重新创建。「\(resume.title)」本身不受影响。")
            }
    }

    private var creation: some View {
        VStack(alignment: .leading, spacing: 12) {
            row("谁可以查看", hint: createPublic ? "公开后，拿到链接的人都能打开" : "仅自己登录后可以打开") {
                Picker("访问权限", selection: $createPublic) { Text("公开").tag(true); Text("仅自己").tag(false) }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 150)
            }
            row("链接有效期", hint: "到期后链接自动失效，可以重新生成") {
                Picker("有效期", selection: $createExpiry) { ForEach(Expiry.allCases) { Text($0.rawValue).tag($0) } }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 190)
            }
            row("允许下载 PDF", hint: createAllowDownload ? "关闭后，公开页面不显示下载入口" : "关闭后，任何访问者（包括分享者）均不可下载") {
                Toggle("允许下载 PDF", isOn: $createAllowDownload).toggleStyle(.switch).labelsHidden()
            }
        }.disabled(busy)
    }

    private func existing(_ share: ResumeShare) -> some View {
        let expired = share.isExpired()
        let link = origin.map { share.url(origin: $0).absoluteString } ?? ""
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Text(expired ? "该分享链接已失效，访客将无法继续访问简历" : link)
                    .font(V3.sans(12.5)).foregroundStyle(expired ? V3.fnt : V3.txt).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                Spacer(minLength: 8)
                Button(expired ? "不可复制" : copied ? "已复制" : "复制链接") { copy(link) }
                    .buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(expired || link.isEmpty)
            }.padding(12).background(V3.field, in: RoundedRectangle(cornerRadius: 8))
            HStack(spacing: 6) {
                Circle().fill(expired ? V3.red : V3.green).frame(width: 6, height: 6)
                Text(expired ? "链接已过期" : "链接可用").font(V3.sans(12, weight: .medium))
                Text("· " + expiryLabel(share)).font(V3.sans(12)).foregroundStyle(V3.fnt)
            }
            row("谁可以查看", hint: share.isPublic ? "公开后，拿到链接的人都能打开" : "仅自己登录后可以打开") {
                Picker("访问权限", selection: Binding(get: { share.isPublic }, set: { value in
                    Task { await update(["visibility": .string(value ? "public" : "private")]) }
                })) { Text("公开").tag(true); Text("仅自己").tag(false) }
                    .pickerStyle(.segmented).labelsHidden().frame(width: 150)
            }
            row("链接有效期", hint: "到期后链接自动失效，可以重新生成") {
                Menu("调整为…") {
                    ForEach(Expiry.allCases) { option in
                        Button(option.rawValue) { Task { await update(["expires_at": ResumeShare.encode(option.date())]) } }
                    }
                }.fixedSize()
            }
            row("允许下载 PDF", hint: share.allowDownload ? "关闭后，公开页面不显示下载入口" : "关闭后，任何访问者（包括分享者）均不可下载") {
                Toggle("允许下载 PDF", isOn: Binding(get: { share.allowDownload }, set: { value in
                    Task { await update(["allow_download": .bool(value)]) }
                })).toggleStyle(.switch).labelsHidden()
            }
            HStack(spacing: 16) {
                Button { confirmRegenerate = true } label: { Label("重新生成链接", systemImage: "arrow.clockwise") }.buttonStyle(.link)
                Button("删除链接") { confirmDelete = true }.buttonStyle(.link).foregroundStyle(V3.red)
            }.font(V3.sans(12.5))
        }.disabled(busy)
    }

    private func row<Control: View>(_ title: String, hint: String, @ViewBuilder control: () -> Control) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(V3.sans(13, weight: .medium))
                Text(hint).font(V3.sans(11.5)).foregroundStyle(V3.fnt)
            }
            Spacer(minLength: 8)
            control()
        }
    }

    private func expiryLabel(_ share: ResumeShare) -> String {
        guard let expiresAt = share.expiresAt else { return "永久有效" }
        let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd HH:mm"
        let label = formatter.string(from: expiresAt)
        return share.isExpired() ? "已于 \(label) 过期" : "有效至 \(label)"
    }

    private func copy(_ link: String) {
        NSPasteboard.general.clearContents()
        if NSPasteboard.general.setString(link, forType: .string) {
            copied = true
            Task { try? await Task.sleep(for: .seconds(2)); copied = false }
        } else { error = "复制失败，请手动复制链接。" }
    }

    private func path() -> String { "/api/resumes/\(resume.id)/share" }

    private func load() async {
        loadFailed = false; error = nil
        do {
            let result = try await session.api.careerRequest(path: path(), method: "GET", query: [:], body: nil)
            share = ResumeShare(result["share"]); loaded = true
        } catch is CancellationError {
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            loadFailed = true
        }
    }

    private func run(_ method: String, body: JSONValue?, failure: String) async {
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            let result = try await session.api.careerRequest(path: path(), method: method, query: [:], body: body)
            share = method == "DELETE" ? nil : ResumeShare(result["share"])
        } catch is CancellationError {
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            self.error = ResumeRequest.errorMessage(error, fallback: failure)
            if case APIError.server(404, "SHARE_LINK_UNAVAILABLE") = error { share = nil }
        }
    }

    private func create() async {
        await run("POST", body: .object([
            "visibility": .string(createPublic ? "public" : "private"),
            "expires_at": ResumeShare.encode(createExpiry.date()),
            "allow_download": .bool(createAllowDownload),
        ]), failure: "生成分享链接失败，请稍后重试。")
    }

    private func regenerate() async {
        guard let share else { return }
        await run("POST", body: .object([
            "visibility": .string(share.isPublic ? "public" : "private"),
            "expires_at": ResumeShare.encode(share.regeneratedExpiry()),
            "allow_download": .bool(share.allowDownload),
        ]), failure: "重新生成分享链接失败，请稍后重试。")
    }

    private func update(_ fields: [String: JSONValue]) async {
        await run("PATCH", body: .object(fields), failure: "更新链接配置失败，请稍后重试。")
    }

    private func deleteShare() async {
        await run("DELETE", body: nil, failure: "删除分享链接失败，请稍后重试。")
    }
}
