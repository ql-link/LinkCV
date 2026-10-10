import AppKit
import DrawOfferCore
import SwiftUI
import UniformTypeIdentifiers

/// 账号设置（Web `features/account/AccountPage.tsx` + `UserProfilePanel.tsx`）：
/// 头像、昵称、联系邮箱、求职资料画像、偏好与退出登录。桌面端不提供注销账号、密码与微信绑定。
struct AccountView: View {
    @Environment(SessionStore.self) private var session
    @State private var profile: JSONValue?
    @State private var form = UserProfileForm()
    @State private var savedForm = UserProfileForm()
    @State private var preferences: JSONValue?
    @State private var loading = true
    @State private var loadError: String?
    @State private var reload = UUID()
    @State private var nickname = ""
    @State private var email = ""
    @State private var busy: String?
    @State private var notice: (text: String, failed: Bool)?
    @State private var avatar: NSImage?

    private var account: String { if case .signedIn(let user) = session.phase { return user.id }; return "" }
    private var user: JSONValue { profile?["user"] ?? .null }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                V3PageHead(eyebrow: ["ACCOUNT"], title: "账号设置", subtitle: "管理个人资料、求职资料和偏好。") {
                    Button("退出登录") { Task { await session.signOut() } }.buttonStyle(V3ButtonStyle(kind: .ghost))
                }
                if let notice {
                    Text(notice.text).font(V3.sans(12.5)).foregroundStyle(notice.failed ? V3.red : V3.sub)
                }
                if loading && profile == nil { ProgressView("正在读取账号…").font(V3.sans(13)).frame(maxWidth: .infinity, minHeight: 200) }
                else if let loadError, profile == nil {
                    VStack(spacing: 10) {
                        Text("账号信息没能加载出来").font(V3.serif(18))
                        Text(loadError).font(V3.sans(13)).foregroundStyle(V3.sub)
                        Button("重新加载") { reload = UUID() }.buttonStyle(V3ButtonStyle(kind: .ghost))
                    }.frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    profileCard
                    jobProfileCard
                    preferencesCard
                }
            }.frame(maxWidth: 860, alignment: .leading).padding(.horizontal, 52).padding(.vertical, 20).frame(maxWidth: .infinity)
        }
        .task(id: "\(account)|\(reload)") { await load() }
    }

    // MARK: Sections

    private var profileCard: some View {
        card("个人资料", hint: "简历数 \(profile?["resume_count"]?.integer ?? 0) · 当前设备 \(profile?["current_session"]?.text("device_label") ?? "")") {
            row("头像") {
                Group {
                    if let avatar { Image(nsImage: avatar).resizable().scaledToFill() }
                    else { Text(String(nickname.prefix(1))).font(V3.sans(18, weight: .semibold)).foregroundStyle(.white).frame(maxWidth: .infinity, maxHeight: .infinity).background(V3.txt) }
                }.frame(width: 48, height: 48).clipShape(Circle())
                Button(busy == "avatar" ? "上传中…" : "更换头像") { Task { await chooseAvatar() } }.buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(busy != nil)
                if !user.text("avatar_url").isEmpty {
                    Button("移除") { Task { await removeAvatar() } }.buttonStyle(V3ButtonStyle(kind: .text)).disabled(busy != nil)
                }
            }
            row("昵称") {
                TextField("昵称", text: $nickname).textFieldStyle(.roundedBorder).frame(width: 240)
                Button(busy == "nickname" ? "保存中…" : "保存") { Task { await saveNickname() } }.buttonStyle(V3ButtonStyle(kind: .ghost))
                    .disabled(busy != nil || nickname.trimmingCharacters(in: .whitespaces) == user.text("nickname") || nickname.trimmingCharacters(in: .whitespaces).isEmpty)
            }
            row("联系邮箱") {
                TextField("用于接收通知，可留空", text: $email).textFieldStyle(.roundedBorder).frame(width: 240)
                Button(busy == "email" ? "保存中…" : "保存") { Task { await saveEmail() } }.buttonStyle(V3ButtonStyle(kind: .ghost))
                    .disabled(busy != nil || email.trimmingCharacters(in: .whitespaces) == user.text("contact_email"))
            }
        }
    }

    private var jobProfileCard: some View {
        let progress = form.progress
        return card("求职资料", hint: "已填写 \(progress.filled)/\(progress.total) 项，用来推荐岗位和优化简历") {
            Group {
                row("求职类型") { multi(UserProfileForm.employment, $form.employmentTypes) }
                row("身份") { single(UserProfileForm.status, $form.candidateStatus) }
                if form.candidateStatus == "fresh_graduate" { row("毕业年份") { TextField("例如 2026", text: $form.graduationYear).textFieldStyle(.roundedBorder).frame(width: 120) } }
                else if form.candidateStatus == "experienced" { row("工作年限") { TextField("年", text: $form.yearsExperience).textFieldStyle(.roundedBorder).frame(width: 120) } }
                row("意向城市") { TagEditor(tags: $form.cities, placeholder: "输入城市后回车", max: 20) }
                row("期望薪资") {
                    TextField("最低", text: $form.salaryMin).textFieldStyle(.roundedBorder).frame(width: 90)
                    Text("–").foregroundStyle(V3.fnt)
                    TextField("最高", text: $form.salaryMax).textFieldStyle(.roundedBorder).frame(width: 90)
                    TextField("币种", text: $form.salaryCurrency).textFieldStyle(.roundedBorder).frame(width: 70)
                    Picker("周期", selection: $form.salaryPeriod) {
                        Text("未选择").tag("")
                        ForEach(UserProfileForm.period, id: \.0) { Text($0.1).tag($0.0) }
                    }.labelsHidden().frame(width: 100)
                }
            }
            Divider()
            Group {
                row("最高学历") {
                    Picker("学历", selection: $form.educationLevel) {
                        Text("未选择").tag("")
                        ForEach(UserProfileForm.education, id: \.0) { Text($0.1).tag($0.0) }
                    }.labelsHidden().frame(width: 140)
                }
                row("院校") { TextField("就读院校", text: $form.school).textFieldStyle(.roundedBorder).frame(width: 240) }
                row("专业") { TextField("专业", text: $form.major).textFieldStyle(.roundedBorder).frame(width: 240) }
                row("院校层次") { multi(UserProfileForm.tiers, $form.schoolTier) }
            }
            Divider()
            Group {
                row("技能") { TagEditor(tags: $form.skills, placeholder: "输入后回车添加…", max: 100) }
                row("语言") { TagEditor(tags: $form.languages, placeholder: "例如 英语 CET-6", max: 100) }
                row("证书") { TagEditor(tags: $form.certifications, placeholder: "输入后回车添加…", max: 100) }
                row("荣誉") { TagEditor(tags: $form.honors, placeholder: "输入后回车添加…", max: 100) }
                row("校园经历") { TagEditor(tags: $form.campusExperiences, placeholder: "输入后回车添加…", max: 100) }
            }
            HStack {
                Spacer()
                Button("还原") { form = savedForm }.buttonStyle(V3ButtonStyle(kind: .text)).disabled(busy != nil || form == savedForm)
                Button(busy == "profile" ? "保存中…" : "保存求职资料") { Task { await saveProfile() } }
                    .buttonStyle(V3ButtonStyle(kind: .dark)).disabled(busy != nil || form == savedForm)
            }
        }
    }

    private var preferencesCard: some View {
        card("偏好", hint: "界面语言暂以中文显示；面试提醒需服务端通知能力，当前仅保存开关。") {
            row("语言") {
                Picker("语言", selection: Binding(get: { preferences?.text("locale").isEmpty == false ? preferences!.text("locale") : "zh-CN" },
                                                set: { value in Task { await savePreferences(["locale": .string(value)]) } })) {
                    Text("简体中文").tag("zh-CN"); Text("English").tag("en-US")
                }.labelsHidden().frame(width: 140).disabled(busy != nil)
            }
            row("面试提醒") {
                Toggle("面试提醒", isOn: Binding(get: { preferences?["interview_reminder_enabled"]?.bool ?? false },
                                             set: { value in Task { await savePreferences(["interview_reminder_enabled": .bool(value)]) } }))
                    .toggleStyle(.switch).labelsHidden().disabled(busy != nil)
            }
        }
    }

    private func card<Content: View>(_ title: String, hint: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(V3.sans(15, weight: .medium))
                Text(hint).font(V3.sans(12)).foregroundStyle(V3.fnt)
            }
            content()
        }.padding(20).frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(V3.cl))
    }

    private func row<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label).font(V3.sans(13)).foregroundStyle(V3.sub).frame(width: 80, alignment: .leading)
            HStack(spacing: 8) { content() }
            Spacer(minLength: 0)
        }
    }

    private func multi(_ options: [(String, String)], _ selection: Binding<[String]>) -> some View {
        ForEach(options, id: \.0) { option in
            Toggle(option.1, isOn: Binding(get: { selection.wrappedValue.contains(option.0) }, set: { on in
                if on { if !selection.wrappedValue.contains(option.0) { selection.wrappedValue.append(option.0) } }
                else { selection.wrappedValue.removeAll { $0 == option.0 } }
            })).toggleStyle(.checkbox)
        }
    }

    private func single(_ options: [(String, String)], _ selection: Binding<String>) -> some View {
        Picker("", selection: selection) {
            Text("未选择").tag("")
            ForEach(options, id: \.0) { Text($0.1).tag($0.0) }
        }.pickerStyle(.segmented).labelsHidden().frame(width: 240)
    }

    // MARK: Actions

    private func load() async {
        let owner = account
        guard !owner.isEmpty else { return }
        loading = true; loadError = nil
        defer { if owner == account { loading = false } }
        do {
            let api = session.api
            async let profileValue = api.careerRequest(path: "/api/account/profile", method: "GET", query: [:], body: nil)
            async let jobProfile = api.careerRequest(path: "/api/account/user-profile", method: "GET", query: [:], body: nil)
            async let preferenceValue = api.careerRequest(path: "/api/account/preferences", method: "GET", query: [:], body: nil)
            let (loadedProfile, loadedJob, loadedPreferences) = try await (profileValue, jobProfile, preferenceValue)
            guard owner == account else { return }
            profile = loadedProfile; preferences = loadedPreferences
            form = UserProfileForm(loadedJob); savedForm = form
            nickname = loadedProfile["user"]?.text("nickname") ?? ""; email = loadedProfile["user"]?.text("contact_email") ?? ""
            await loadAvatar()
        } catch is CancellationError {
        } catch {
            guard owner == account else { return }
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            loadError = AccountRequest.errorMessage(error, fallback: "网络不稳定或服务暂时不可用，请稍后重试。")
        }
    }

    private func perform(_ key: String, success: String, failure: String, _ operation: () async throws -> Void) async {
        guard busy == nil else { return }
        busy = key; notice = nil
        defer { busy = nil }
        do { try await operation(); notice = (success, false) }
        catch is CancellationError {}
        catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            notice = (AccountRequest.errorMessage(error, fallback: failure), true)
        }
    }

    private func saveNickname() async {
        let value = nickname.trimmingCharacters(in: .whitespacesAndNewlines)
        await perform("nickname", success: "昵称已保存。", failure: "保存昵称失败，请稍后重试。") {
            let result = try await session.api.careerRequest(path: "/api/account/profile", method: "PATCH", query: [:], body: .object(["nickname": .string(value)]))
            if case .object(var fields) = profile ?? .object([:]) { fields["user"] = result; profile = .object(fields) }
            nickname = result.text("nickname").isEmpty ? value : result.text("nickname")
            session.updateNickname(nickname)
        }
    }

    private func saveEmail() async {
        let value = email.trimmingCharacters(in: .whitespacesAndNewlines)
        await perform("email", success: value.isEmpty ? "已清除联系邮箱。" : "联系邮箱已保存。", failure: "保存邮箱失败，请稍后重试。") {
            let result = try await session.api.careerRequest(path: "/api/account/contact-email", method: "PUT", query: [:],
                                                             body: .object(["email": value.isEmpty ? .null : .string(value)]))
            if case .object(var fields) = profile ?? .object([:]), case .object(var userFields) = fields["user"] ?? .object([:]) {
                userFields["contact_email"] = result["contact_email"] ?? .null; fields["user"] = .object(userFields); profile = .object(fields)
            }
            email = result.text("contact_email")
        }
    }

    private func saveProfile() async {
        let payload = form.payload()
        await perform("profile", success: "求职资料已保存。", failure: "保存求职资料失败，请检查后重试。") {
            do {
                let result = try await session.api.careerRequest(path: "/api/account/user-profile", method: "PUT", query: [:], body: payload)
                form = UserProfileForm(result); savedForm = form
            } catch APIError.server(409, "USER_PROFILE_VERSION_CONFLICT") {
                if let latest = try? await session.api.careerRequest(path: "/api/account/user-profile", method: "GET", query: [:], body: nil) {
                    savedForm = UserProfileForm(latest); form.lockVersion = savedForm.lockVersion
                }
                throw APIError.server(status: 409, code: "USER_PROFILE_VERSION_CONFLICT")
            }
        }
    }

    private func loadAvatar() async {
        let path = user.text("avatar_url")
        guard !path.isEmpty, let data = try? await session.api.accountAvatar(path: path) else { avatar = nil; return }
        avatar = NSImage(data: data)
    }

    /// 选图后按 Web 头像规则裁成居中正方形，缩放到 512px 以内并以 JPEG 上传（`PUT /api/account/avatar`）。
    private func chooseAvatar() async {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg]
        guard panel.runModal() == .OK, let url = panel.url, let image = NSImage(contentsOf: url),
              let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
        let side = min(cg.width, cg.height)
        guard side > 0, let square = cg.cropping(to: CGRect(x: (cg.width - side) / 2, y: (cg.height - side) / 2, width: side, height: side)) else { return }
        let target = min(512, side)
        let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: target, pixelsHigh: target, bitsPerSample: 8, samplesPerPixel: 4,
                                   hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)
        guard let rep else { return }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSGraphicsContext.current?.imageInterpolation = .high
        NSImage(cgImage: square, size: NSSize(width: side, height: side)).draw(in: NSRect(x: 0, y: 0, width: target, height: target))
        NSGraphicsContext.restoreGraphicsState()
        guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.88]) else { return }
        await perform("avatar", success: "头像已更新。", failure: "头像上传失败，请稍后重试。") {
            _ = try await session.api.careerRequest(path: "/api/account/avatar", method: "PUT", query: [:],
                body: .object(["fileName": .string("avatar.jpg"), "dataUrl": .string("data:image/jpeg;base64," + jpeg.base64EncodedString())]))
            reload = UUID()
        }
    }

    private func removeAvatar() async {
        await perform("avatar", success: "已移除头像。", failure: "移除头像失败，请稍后重试。") {
            _ = try await session.api.careerRequest(path: "/api/account/avatar", method: "DELETE", query: [:], body: nil)
            avatar = nil; reload = UUID()
        }
    }

    private func savePreferences(_ fields: [String: JSONValue]) async {
        await perform("preferences", success: "偏好已保存。", failure: "保存偏好失败，请稍后重试。") {
            preferences = try await session.api.careerRequest(path: "/api/account/preferences", method: "PATCH", query: [:], body: .object(fields))
        }
    }
}

/// 标签输入：已添加的条目 + 回车添加的输入框（Web `TagInput`）。
struct TagEditor: View {
    @Binding var tags: [String]
    let placeholder: String
    let max: Int
    @State private var draft = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !tags.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(Array(tags.enumerated()), id: \.offset) { index, tag in
                        HStack(spacing: 4) {
                            Text(tag).font(V3.sans(12))
                            Button { tags.remove(at: index) } label: { Image(systemName: "xmark").font(.system(size: 8, weight: .semibold)) }
                                .buttonStyle(.plain).foregroundStyle(V3.fnt).accessibilityLabel("移除 \(tag)")
                        }.padding(.horizontal, 8).frame(height: 24).background(V3.field, in: RoundedRectangle(cornerRadius: 6))
                    }
                }
            }
            TextField(tags.count >= max ? "已达上限" : placeholder, text: $draft).textFieldStyle(.roundedBorder).frame(width: 240)
                .disabled(tags.count >= max)
                .onSubmit {
                    let value = String(draft.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
                    if !value.isEmpty, !tags.contains(value), tags.count < max { tags.append(value) }
                    draft = ""
                }
        }
    }
}
