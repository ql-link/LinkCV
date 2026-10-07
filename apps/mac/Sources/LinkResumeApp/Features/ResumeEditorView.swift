import AppKit
import LinkResumeCore
import LinkResumeRender
import SwiftUI
import UniformTypeIdentifiers

/// 原生结构化简历编辑（Web `ResumeWorkbench` 的对应页）：左侧编辑基本信息、头像、联系方式、模块、条目、
/// 段落/列表/分栏行/图片，文字支持加粗、斜体、下划线、删除线、代码、字号、颜色、背景色、链接与图标；
/// 顶部可切换模板、调整版式（字体、字号、行距、边距、智能一页）、调整板块顺序与按大纲跳转。
/// 右侧纸面按本地编译的版式计划实时预览未保存内容，保存后以后端返回的 layout_plan 为准。
/// 保存提交 `PUT /api/resumes/{id}` 的 data、style 与 base_lock_version；冲突时提示重新载入，不覆盖他处的修改。
struct ResumeEditorView: View {
    @Environment(SessionStore.self) private var session
    let resumeID: String
    let close: () -> Void

    @State private var record: JSONValue?
    @State private var saved: JSONValue = .null
    @State private var doc: JSONValue = .null
    @State private var savedStyle: JSONValue = .null
    @State private var style: JSONValue = .null
    @State private var title = ""
    @State private var loading = true
    @State private var error: String?
    @State private var notice: String?
    @State private var saving = false
    @State private var conflict = false
    @State private var confirmLeave = false
    @State private var paper: ResumeRenderRequest?
    @State private var paperHeight: CGFloat = 1123
    @State private var paperNote: String?
    @State private var renderTask: Task<Void, Never>?
    @State private var completeness: ResumeCompleteness?
    @State private var rich = RichTextController()
    @State private var showTemplates = false
    @State private var showType = false
    @State private var showOrder = false
    @State private var zoom = 0.6
    @State private var uploading = false
    @State private var jump: String?

    private var dirty: Bool { record != nil && (doc != saved || style != savedStyle || title != (record?.text("title") ?? "")) }
    private var sections: [JSONValue] { doc["sections"]?.items ?? [] }
    private var templateKey: String { style["template_snapshot"]?.text("template_key") ?? "" }
    private var busy: Bool { saving || uploading }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
            Divider()
            if loading && record == nil { ProgressView("正在读取简历…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if record == nil {
                VStack(spacing: 10) {
                    Text(error ?? "简历读取失败。").font(V3.sans(13)).foregroundStyle(V3.red)
                    Button("重试") { Task { await load() } }.buttonStyle(V3ButtonStyle(kind: .ghost))
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HSplitView {
                    VStack(spacing: 0) {
                        RichTextToolbar(controller: rich).padding(.horizontal, 16).frame(height: 38).frame(maxWidth: .infinity, alignment: .leading)
                        Divider()
                        ScrollViewReader { proxy in
                            ScrollView { form.padding(24) }
                                .onChange(of: jump) { _, target in
                                    guard let target else { return }
                                    withAnimation { proxy.scrollTo(target, anchor: .top) }
                                    jump = nil
                                }
                        }
                    }.frame(minWidth: 480, idealWidth: 580)
                    preview.frame(minWidth: 360)
                }
            }
        }
        .task { await load() }
        .onChange(of: doc) { _, _ in schedulePreview() }
        .onChange(of: style) { _, _ in schedulePreview() }
        .onDisappear { renderTask?.cancel() }
        .confirmationDialog("放弃未保存的修改？", isPresented: $confirmLeave) {
            Button("放弃修改", role: .destructive, action: close)
            Button("继续编辑", role: .cancel) {}
        }
        .sheet(isPresented: $showTemplates) {
            TemplateSwitchSheet(currentKey: templateKey, apply: applyTemplate, close: { showTemplates = false })
        }
        .sheet(isPresented: $showOrder) {
            SectionOrderSheet(sections: sections, columns: ResumeLayout.columns(data: doc, style: style),
                              apply: { doc = doc.setting([.key("sections")], to: .array($0)) }, close: { showOrder = false })
        }
    }

    // MARK: Toolbar & preview

    private var toolbar: some View {
        HStack(spacing: 10) {
            Button { if dirty { confirmLeave = true } else { close() } } label: { Label("返回我的简历", systemImage: "chevron.left") }.buttonStyle(.plain)
            TextField("简历名称", text: $title).textFieldStyle(.roundedBorder).frame(maxWidth: 240)
            if let completeness { Text("完整度 \(completeness.score)%").font(V3.number(12, weight: .medium)).foregroundStyle(completeness.score >= 90 ? V3.green : V3.orange).help(completeness.missing.map { "待完善：\($0)" } ?? "主要信息已完整") }
            Spacer()
            if let notice { Text(notice).font(V3.sans(12)).foregroundStyle(V3.green) }
            if let error, record != nil { Text(error).font(V3.sans(12)).foregroundStyle(V3.red).lineLimit(2) }
            if conflict { Button("重新载入") { Task { await load() } }.buttonStyle(V3ButtonStyle(kind: .ghost)) }
            if record != nil {
                Menu {
                    Button("个人信息") { jump = "identity" }
                    ForEach(sections, id: \.nodeKey) { section in
                        Button(sectionLabel(section)) { jump = section.nodeKey }
                    }
                } label: { Label("大纲", systemImage: "list.bullet.indent") }.fixedSize().help("跳转到模块")
                Button { showOrder = true } label: { Label("顺序", systemImage: "arrow.up.arrow.down") }.help("调整板块顺序").disabled(sections.count < 2)
                Button { showType = true } label: { Label("版式", systemImage: "textformat") }.help("字体、字号、行距与页边距")
                    .disabled(ResumeTypeSettings.read(style) == nil)
                    .popover(isPresented: $showType, arrowEdge: .bottom) { TypeSettingsPanel(settings: typeBinding, disabled: busy) }
                Button { showTemplates = true } label: { Label("模板", systemImage: "rectangle.on.rectangle") }.help("切换简历模板").disabled(busy || conflict)
            }
            Button(saving ? "保存中…" : dirty ? "保存" : "已保存") { Task { await save() } }
                .buttonStyle(V3ButtonStyle(kind: .dark)).disabled(!dirty || busy || conflict).keyboardShortcut("s", modifiers: .command)
        }.buttonStyle(.borderless).padding(.horizontal, 20).frame(height: 54)
    }

    private var typeBinding: Binding<ResumeTypeSettings> {
        Binding(get: { ResumeTypeSettings.read(style) ?? ResumeTypeSettings(fontFamily: ResumeTypeSettings.serifStack, fontSize: 10, lineHeight: 1.5, pageMargin: 16, verticalPageMargin: 14, smartOnePage: false) },
                set: { style = $0.apply(to: style) })
    }

    private var preview: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text(paperNote ?? (dirty ? "实时预览 · 尚未保存" : "最终排版以 PDF 为准")).font(V3.sans(11.5)).foregroundStyle(paperNote == nil ? V3.fnt : V3.orange).lineLimit(1)
                Spacer()
                Button { zoom = max(0.4, zoom - 0.1) } label: { Image(systemName: "minus.magnifyingglass") }.disabled(zoom <= 0.4).help("缩小")
                Button("\(Int((zoom * 100).rounded()))%") { zoom = 0.6 }.font(V3.number(11.5, weight: .regular)).help("恢复默认缩放")
                Button { zoom = min(1.2, zoom + 0.1) } label: { Image(systemName: "plus.magnifyingglass") }.disabled(zoom >= 1.2).help("放大")
            }.buttonStyle(.borderless).padding(.horizontal, 12).frame(height: 32)
            ScrollView([.vertical, .horizontal]) {
                if let paper {
                    ResumePaperView(request: paper, onRendered: { paperHeight = max(1123, $0) }, onError: { paperNote = $0 })
                        .frame(width: 794, height: paperHeight).scaleEffect(zoom, anchor: .topLeading)
                        .frame(width: 794 * zoom + 24, height: paperHeight * zoom + 24, alignment: .topLeading).padding(12)
                } else { ProgressView().padding(40) }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Tokens.Color.stage)
        }
    }

    private func sectionLabel(_ section: JSONValue) -> String {
        let title = ResumeDocument.value(section["title"])
        return title.isEmpty ? (ResumeDocument.sectionKinds.first { $0.key == section.text("semantic_kind") }?.label ?? "模块") : title
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 22) {
            group("基本信息") {
                textValueField("姓名", path: [.key("identity"), .key("name")])
                textValueField("一句话介绍", path: [.key("identity"), .key("headline")])
                avatarRow
                Text("联系方式").font(V3.sans(12, weight: .medium)).foregroundStyle(V3.sub).padding(.top, 4)
                ForEach(Array((doc["identity"]?["contacts"]?.items ?? []).enumerated()), id: \.offset) { index, contact in contactRow(index, contact) }
                Button { doc = doc.appending([.key("identity"), .key("contacts")], ResumeDocument.newContact(kind: "phone", value: "")) } label: { Label("添加联系方式", systemImage: "plus") }
                    .buttonStyle(.link).font(V3.sans(12.5)).disabled((doc["identity"]?["contacts"]?.items.count ?? 0) >= 32)
            }.id("identity")
            ForEach(Array(sections.enumerated()), id: \.element.nodeKey) { index, section in sectionEditor(index, section).id(section.nodeKey) }
            Menu {
                ForEach(ResumeDocument.sectionKinds, id: \.key) { kind in
                    Button(kind.label) { doc = doc.appending([.key("sections")], ResumeDocument.newSection(kind: kind.key, title: kind.label)) }
                }
            } label: { Label("添加模块", systemImage: "plus.rectangle.on.rectangle") }.fixedSize().disabled(sections.count >= 100)
        }
    }

    private func group<Content: View>(_ title: String, trailing: AnyView? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack { Text(title).font(V3.sans(15, weight: .medium)); Spacer(); trailing }
            content()
        }.padding(16).frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(V3.cl))
    }

    private func fieldFrame<Content: View>(_ content: Content) -> some View {
        content.background(.white, in: RoundedRectangle(cornerRadius: 6)).overlay(RoundedRectangle(cornerRadius: 6).stroke(V3.cl))
    }

    /// textValue 字段：单行富文本；清空时置 null（identity/标题）或删除键（条目字段）。
    private func textValueField(_ label: String, path: [JSONPathPart], removeWhenEmpty: Bool = false) -> some View {
        let binding = Binding<[JSONValue]>(get: { ResumeDocument.textRuns(doc[path: path]) }, set: { runs in
            doc = doc.setting(path, to: ResumeDocument.setTextRuns(doc[path: path], runs) ?? (removeWhenEmpty ? nil : .null))
        })
        return HStack(alignment: .firstTextBaseline) {
            Text(label).font(V3.sans(12)).foregroundStyle(V3.sub).frame(width: 76, alignment: .leading)
            fieldFrame(RichTextField(runs: binding, placeholder: label, singleLine: true, controller: rich))
        }
    }

    private var avatarRow: some View {
        let avatar = doc["identity"]?["avatar"] ?? .null
        let path: [JSONPathPart] = [.key("identity"), .key("avatar")]
        return HStack(spacing: 10) {
            Text("头像").font(V3.sans(12)).foregroundStyle(V3.sub).frame(width: 76, alignment: .leading)
            if avatar == .null {
                Text("未设置，模板可能显示默认头像").font(V3.sans(12.5)).foregroundStyle(V3.fnt)
                Spacer()
                Button(uploading ? "上传中…" : "上传头像") { Task { if let url = await uploadImage() { doc = doc.setting(path, to: ResumeDocument.avatar(nil, src: url)) } } }.disabled(busy)
            } else {
                Label("已设置", systemImage: "person.crop.circle.fill").font(V3.sans(12.5)).foregroundStyle(V3.green)
                Text("尺寸").font(V3.sans(12)).foregroundStyle(V3.sub)
                Slider(value: Binding(get: { avatar["width"]?.numberValue ?? 96 }, set: { doc = doc.setting(path + [.key("width")], to: .number($0.rounded())) }),
                       in: ResumeDocument.avatarSizeRange.min...ResumeDocument.avatarSizeRange.max).frame(maxWidth: 140)
                Text("\(Int(avatar["width"]?.numberValue ?? 96))px").font(V3.number(11.5, weight: .regular)).foregroundStyle(V3.fnt)
                Spacer()
                Button("更换") { Task { if let url = await uploadImage() { doc = doc.setting(path, to: ResumeDocument.avatar(avatar, src: url)) } } }.disabled(busy)
                Button("移除", role: .destructive) { doc = doc.setting(path, to: .null) }
            }
        }.buttonStyle(.link).font(V3.sans(12.5))
    }

    private func contactRow(_ index: Int, _ contact: JSONValue) -> some View {
        let base: [JSONPathPart] = [.key("identity"), .key("contacts"), .index(index)]
        let binding = Binding<[JSONValue]>(get: { ResumeDocument.textRuns(doc[path: base]) }, set: { runs in
            if let next = ResumeDocument.setTextRuns(doc[path: base], runs, limit: 2048) { doc = doc.setting(base, to: next) }
            else if case .object(var fields) = doc[path: base] ?? .null {
                fields["value"] = .string(""); fields.removeValue(forKey: "runs")
                doc = doc.setting(base, to: .object(fields))
            }
        })
        return HStack(spacing: 8) {
            Picker("类型", selection: Binding(get: { contact.text("contact_kind") }, set: { doc = doc.setting(base + [.key("contact_kind")], to: .string($0)) })) {
                ForEach(ResumeDocument.contactKinds, id: \.key) { Text($0.label).tag($0.key) }
            }.labelsHidden().frame(width: 100)
            fieldFrame(RichTextField(runs: binding, placeholder: "内容", singleLine: true, controller: rich))
            Button { doc = doc.setting(base, to: nil) } label: { Image(systemName: "minus.circle") }.buttonStyle(.plain).foregroundStyle(V3.fnt).accessibilityLabel("删除联系方式")
        }
    }

    private func sectionEditor(_ index: Int, _ section: JSONValue) -> some View {
        let base: [JSONPathPart] = [.key("sections"), .index(index)]
        let controls = AnyView(HStack(spacing: 10) {
            Picker("类型", selection: Binding(get: { section.text("semantic_kind") }, set: { doc = doc.setting(base + [.key("semantic_kind")], to: .string($0)) })) {
                ForEach(ResumeDocument.sectionKinds, id: \.key) { Text($0.label).tag($0.key) }
            }.labelsHidden().frame(width: 120).help("模块类型决定它在模板中的位置")
            Button { doc = doc.moving([.key("sections")], from: index, to: index - 1) } label: { Image(systemName: "arrow.up") }.disabled(index == 0)
            Button { doc = doc.moving([.key("sections")], from: index, to: index + 1) } label: { Image(systemName: "arrow.down") }.disabled(index == sections.count - 1)
            Button { doc = doc.setting(base, to: nil) } label: { Image(systemName: "trash") }.foregroundStyle(V3.red)
        }.buttonStyle(.plain))
        return group(sectionLabel(section), trailing: controls) {
            textValueField("模块标题", path: base + [.key("title")])
            ForEach(Array((section["entries"]?.items ?? []).enumerated()), id: \.element.nodeKey) { entryIndex, entry in
                entryEditor(base + [.key("entries")], entryIndex, entry, count: section["entries"]?.items.count ?? 0)
            }
            blocksEditor(base + [.key("blocks")])
            HStack(spacing: 16) {
                Button { doc = doc.appending(base + [.key("entries")], ResumeDocument.newEntry()) } label: { Label("添加条目", systemImage: "plus") }
                    .disabled((section["entries"]?.items.count ?? 0) >= 200)
                addBlockMenu(base + [.key("blocks")])
            }.buttonStyle(.link).font(V3.sans(12.5))
        }
    }

    private func entryEditor(_ listPath: [JSONPathPart], _ index: Int, _ entry: JSONValue, count: Int) -> some View {
        let base = listPath + [.index(index)]
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("条目 \(index + 1)").font(V3.sans(12.5, weight: .medium))
                Spacer()
                Button { doc = doc.moving(listPath, from: index, to: index - 1) } label: { Image(systemName: "arrow.up") }.disabled(index == 0)
                Button { doc = doc.moving(listPath, from: index, to: index + 1) } label: { Image(systemName: "arrow.down") }.disabled(index == count - 1)
                Button { doc = doc.setting(base, to: nil) } label: { Image(systemName: "trash") }.foregroundStyle(V3.red)
            }.buttonStyle(.plain)
            ForEach(ResumeDocument.entryFields, id: \.key) { field in
                textValueField(field.label, path: base + [.key("fields"), .key(field.key)], removeWhenEmpty: true)
            }
            blocksEditor(base + [.key("blocks")])
            addBlockMenu(base + [.key("blocks")]).buttonStyle(.link).font(V3.sans(12.5))
        }.padding(12).background(V3.stage.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
    }

    private func addBlockMenu(_ path: [JSONPathPart]) -> some View {
        Menu {
            Button("段落") { doc = doc.appending(path, ResumeDocument.newParagraph()) }
            Button("项目符号列表") { doc = doc.appending(path, ResumeDocument.newList(ordered: false)) }
            Button("编号列表") { doc = doc.appending(path, ResumeDocument.newList(ordered: true)) }
            Divider()
            Button("两栏") { doc = doc.appending(path, ResumeDocument.newRow(kind: "pair")) }
            Button("三栏") { doc = doc.appending(path, ResumeDocument.newRow(kind: "trio")) }
            Button("四栏信息行") { doc = doc.appending(path, ResumeDocument.newRow(kind: "meta")) }
            Divider()
            Button("图片…") { Task { if let url = await uploadImage() { doc = doc.appending(path, ResumeDocument.newImage(src: url, alt: nil)) } } }.disabled(busy)
        } label: { Label("添加内容", systemImage: "text.badge.plus") }.fixedSize().disabled((doc[path: path]?.items.count ?? 0) >= 500)
    }

    @ViewBuilder
    private func blocksEditor(_ path: [JSONPathPart]) -> some View {
        let blocks = doc[path: path]?.items ?? []
        ForEach(Array(blocks.enumerated()), id: \.element.nodeKey) { index, block in
            let base = path + [.index(index)]
            HStack(alignment: .top, spacing: 6) {
                VStack(alignment: .leading, spacing: 6) { blockEditor(base, block) }
                VStack(spacing: 6) {
                    Button { doc = doc.moving(path, from: index, to: index - 1) } label: { Image(systemName: "arrow.up") }.disabled(index == 0)
                    Button { doc = doc.moving(path, from: index, to: index + 1) } label: { Image(systemName: "arrow.down") }.disabled(index == blocks.count - 1)
                    Button { doc = doc.setting(base, to: nil) } label: { Image(systemName: "trash") }.foregroundStyle(V3.red)
                }.buttonStyle(.plain).font(.system(size: 11))
            }
        }
    }

    private func runsBinding(_ path: [JSONPathPart]) -> Binding<[JSONValue]> {
        Binding(get: { doc[path: path]?["runs"]?.items ?? [] }, set: { doc = doc.setting(path, to: ResumeDocument.setBlockRuns(doc[path: path] ?? .null, $0)) })
    }

    @ViewBuilder
    private func blockEditor(_ base: [JSONPathPart], _ block: JSONValue) -> some View {
        switch block.text("block_type") {
        case "paragraph":
            HStack(alignment: .top, spacing: 6) {
                fieldFrame(RichTextField(runs: runsBinding(base), placeholder: "输入内容，输入 / 插入其他内容", allowsInline: true, minHeight: 52, controller: rich))
                alignMenu(base, block)
            }
            if ResumeDocument.runsText(block["runs"]) == "/" { slashMenu(base) }
        case "bullet_list", "ordered_list":
            let ordered = block.text("block_type") == "ordered_list"
            let items = block["items"]?.items ?? []
            ForEach(Array(items.enumerated()), id: \.element.nodeKey) { itemIndex, item in
                let itemPath = base + [.key("items"), .index(itemIndex)]
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(ordered ? "\(itemIndex + Int(block["start"]?.numberValue ?? 1))." : "•").font(V3.sans(13)).foregroundStyle(V3.fnt).frame(width: 22)
                    fieldFrame(RichTextField(runs: runsBinding(itemPath), placeholder: "列表项", singleLine: true, allowsInline: true,
                                             onReturn: { insertListItem(base, after: itemIndex) }, controller: rich))
                    Button { doc = items.count > 1 ? doc.setting(itemPath, to: nil) : doc.setting(base, to: nil) } label: { Image(systemName: "minus.circle") }
                        .buttonStyle(.plain).foregroundStyle(V3.fnt)
                }
            }
            HStack(spacing: 14) {
                Button { doc = doc.appending(base + [.key("items")], ResumeDocument.newListItem()) } label: { Label("添加一项", systemImage: "plus") }.disabled(items.count >= 500)
                Button(ordered ? "改为项目符号" : "改为编号") { toggleListKind(base, block) }
            }.buttonStyle(.link).font(V3.sans(12))
        case "row":
            rowEditor(base, block)
        case "media":
            mediaEditor(base, block)
        default:
            Text("暂不支持的内容，保存时原样保留").font(V3.sans(12)).foregroundStyle(V3.fnt)
        }
    }

    private func alignMenu(_ base: [JSONPathPart], _ block: JSONValue) -> some View {
        let current = block["align"]?.stringValue
        let symbol = ["center": "text.aligncenter", "right": "text.alignright"][current ?? ""] ?? "text.alignleft"
        return Menu {
            Button("左对齐") { doc = doc.setting(base, to: ResumeDocument.setAlign(doc[path: base] ?? .null, nil)) }
            Button("居中对齐") { doc = doc.setting(base, to: ResumeDocument.setAlign(doc[path: base] ?? .null, "center")) }
            Button("右对齐") { doc = doc.setting(base, to: ResumeDocument.setAlign(doc[path: base] ?? .null, "right")) }
        } label: { Image(systemName: symbol) }.menuIndicator(.hidden).fixedSize().help("对齐方式")
    }

    /// Web 斜杠命令：段落里只输入“/”时，在下方列出可转换的内容类型。
    private func slashMenu(_ base: [JSONPathPart]) -> some View {
        HStack(spacing: 6) {
            Text("插入").font(V3.sans(11.5)).foregroundStyle(V3.fnt)
            ForEach([("项目符号列表", "list"), ("编号列表", "ordered"), ("两栏", "pair"), ("三栏", "trio"), ("四栏信息行", "meta"), ("图片", "image")], id: \.1) { label, kind in
                Button(label) { Task { await convertSlash(base, kind) } }.buttonStyle(V3ButtonStyle(kind: .ghost)).controlSize(.small)
            }
            Button("取消") { doc = doc.setting(base, to: ResumeDocument.setBlockRuns(doc[path: base] ?? .null, [])) }.buttonStyle(.link).font(V3.sans(11.5))
        }
    }

    private func convertSlash(_ base: [JSONPathPart], _ kind: String) async {
        let next: JSONValue?
        switch kind {
        case "list": next = ResumeDocument.newList(ordered: false)
        case "ordered": next = ResumeDocument.newList(ordered: true)
        case "image": next = await uploadImage().map { ResumeDocument.newImage(src: $0, alt: nil) }
        default: next = ResumeDocument.newRow(kind: kind)
        }
        if let next { doc = doc.setting(base, to: next) }
    }

    private func insertListItem(_ base: [JSONPathPart], after index: Int) {
        var items = doc[path: base + [.key("items")]]?.items ?? []
        guard items.count < 500 else { return }
        items.insert(ResumeDocument.newListItem(), at: min(items.count, index + 1))
        doc = doc.setting(base + [.key("items")], to: .array(items))
    }

    private func toggleListKind(_ base: [JSONPathPart], _ block: JSONValue) {
        let ordered = block.text("block_type") == "ordered_list"
        doc = doc.setting(base + [.key("block_type")], to: .string(ordered ? "bullet_list" : "ordered_list"))
            .setting(base + [.key("start")], to: ordered ? .null : .number(1))
    }

    private func rowEditor(_ base: [JSONPathPart], _ block: JSONValue) -> some View {
        let cells = block["cells"]?.items ?? []
        let kind = block.text("row_kind")
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(["pair": "两栏", "trio": "三栏", "meta": "四栏信息行", "equal": "等分栏"][kind] ?? "分栏").font(V3.sans(11.5)).foregroundStyle(V3.fnt)
                if kind == "pair" {
                    Spacer()
                    Text("左栏宽度").font(V3.sans(11.5)).foregroundStyle(V3.fnt)
                    Slider(value: Binding(get: { block["left_width_percent"]?.numberValue ?? 50 }, set: { doc = doc.setting(base + [.key("left_width_percent")], to: .number($0.rounded())) }),
                           in: 30...80).frame(maxWidth: 140)
                    Text("\(Int(block["left_width_percent"]?.numberValue ?? 50))%").font(V3.number(11.5, weight: .regular)).foregroundStyle(V3.fnt)
                }
            }
            HStack(alignment: .top, spacing: 6) {
                ForEach(Array(cells.enumerated()), id: \.element.nodeKey) { cellIndex, _ in
                    fieldFrame(RichTextField(runs: runsBinding(base + [.key("cells"), .index(cellIndex), .key("blocks"), .index(0)]),
                                             placeholder: "第 \(cellIndex + 1) 栏", allowsInline: true, controller: rich))
                }
            }
        }.padding(8).background(V3.stage.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }

    private func mediaEditor(_ base: [JSONPathPart], _ block: JSONValue) -> some View {
        let percent = block["width_unit"]?.stringValue == "%"
        let width = block["width"]?.numberValue ?? 100
        let shown = percent ? width : min(100, width / 7.94)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("图片", systemImage: "photo").font(V3.sans(12.5, weight: .medium))
                Spacer()
                Button(uploading ? "上传中…" : "更换图片") { Task { if let url = await uploadImage() { doc = doc.setting(base + [.key("src")], to: .string(url)) } } }
                    .buttonStyle(.link).font(V3.sans(12)).disabled(busy)
            }
            HStack {
                Text("说明").font(V3.sans(12)).foregroundStyle(V3.sub).frame(width: 40, alignment: .leading)
                TextField("图片说明（可选）", text: Binding(get: { block.text("alt") }, set: {
                    doc = doc.setting(base + [.key("alt")], to: $0.isEmpty ? .null : .string(String($0.prefix(300))))
                })).textFieldStyle(.roundedBorder)
            }
            HStack {
                Text("宽度").font(V3.sans(12)).foregroundStyle(V3.sub).frame(width: 40, alignment: .leading)
                Slider(value: Binding(get: { shown }, set: {
                    doc = doc.setting(base + [.key("width")], to: .number($0.rounded())).setting(base + [.key("width_unit")], to: .string("%"))
                }), in: 10...100)
                Text("\(Int(shown))%").font(V3.number(11.5, weight: .regular)).foregroundStyle(V3.fnt).frame(width: 40)
                Picker("对齐", selection: Binding(get: { block["align"]?.stringValue ?? "center" }, set: { doc = doc.setting(base + [.key("align")], to: .string($0)) })) {
                    Text("左").tag("left"); Text("中").tag("center"); Text("右").tag("right"); Text("通栏").tag("full")
                }.pickerStyle(.segmented).frame(width: 180).labelsHidden()
            }
        }.padding(10).background(V3.stage.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }

    // MARK: Actions

    private func apply(_ resume: JSONValue) async {
        record = resume
        saved = resume["data"] ?? .null
        doc = saved
        savedStyle = resume["style"] ?? .null
        style = savedStyle
        title = resume.text("title")
        paperNote = nil
        completeness = ResumeCompleteness.evaluate(saved)
        let request = ResumeRenderRequest(title: resume.text("title"), data: saved, style: savedStyle, layoutPlan: resume["layout_plan"])
        renderTask?.cancel()
        paper = (try? await session.api.preparePaper(request))?.request ?? request
    }

    /// 未保存内容的实时纸面：停顿 0.4 秒后用本地编译的版式计划重新渲染。
    private func schedulePreview() {
        guard record != nil, doc != saved || style != savedStyle else { return }
        renderTask?.cancel()
        let data = ResumeDocument.prepareForSave(doc, previous: saved)
        let style = style, title = title
        let hash = record?["layout_plan"]?.text("content_sha256") ?? ""
        renderTask = Task {
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            guard let plan = ResumeLayout.compile(data: data, style: style, contentHash: hash) else {
                paperNote = "当前模板放不下某个模块类型，请调整模块类型或换一个模板"
                return
            }
            let request = ResumeRenderRequest(title: title, data: data, style: style, layoutPlan: plan)
            let prepared = (try? await session.api.preparePaper(request))?.request ?? request
            guard !Task.isCancelled else { return }
            paperNote = nil
            paper = prepared
        }
    }

    private func load() async {
        loading = true; error = nil; conflict = false
        defer { loading = false }
        do {
            let result = try await session.api.careerRequest(path: "/api/resumes/\(resumeID)", method: "GET", query: [:], body: nil)
            guard let resume = result["resume"] else { throw APIError.invalidResponse }
            await apply(resume)
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            self.error = ResumeRequest.errorMessage(error, fallback: "简历读取失败，请稍后重试。")
        }
    }

    private func save() async {
        guard let record, dirty, !saving else { return }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { error = "简历名称不能为空。"; return }
        saving = true; error = nil; notice = nil
        defer { saving = false }
        var body: [String: JSONValue] = ["base_lock_version": record["lock_version"] ?? .number(1)]
        if doc != saved { body["data"] = ResumeDocument.prepareForSave(doc, previous: saved) }
        if style != savedStyle { body["style"] = style }
        if name != record.text("title") { body["title"] = .string(name) }
        do {
            let result = try await session.api.careerRequest(path: "/api/resumes/\(resumeID)", method: "PUT", query: [:], body: .object(body))
            guard let resume = result["resume"] else { throw APIError.invalidResponse }
            await apply(resume)
            notice = "已保存"
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            if case APIError.server(409, "RESUME_EDIT_CONFLICT") = error { conflict = true }
            self.error = ResumeDocument.saveError(error)
        }
    }

    /// Web `applyTemplate`：随请求提交当前正文与名称；未保存的版式设置在新模板上重新套用，留待保存。
    private func applyTemplate(_ template: ResumeTemplate) async -> String? {
        guard let record, !busy else { return nil }
        saving = true; error = nil; notice = nil
        defer { saving = false }
        let pendingType = style != savedStyle ? ResumeTypeSettings.read(style) : nil
        var body: [String: JSONValue] = ["template_id": .string(template.id), "base_lock_version": record["lock_version"] ?? .number(1)]
        if doc != saved { body["data"] = ResumeDocument.prepareForSave(doc, previous: saved) }
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty, name != record.text("title") { body["title"] = .string(name) }
        do {
            let result = try await session.api.careerRequest(path: "/api/resumes/\(resumeID)/apply-template", method: "POST", query: [:], body: .object(body))
            guard let resume = result["resume"] else { throw APIError.invalidResponse }
            await apply(resume)
            if let pendingType { style = pendingType.apply(to: style) }
            notice = "已切换为「\(template.name)」"
            return nil
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            if case APIError.server(409, "RESUME_EDIT_CONFLICT") = error { conflict = true; showTemplates = false }
            let message = ResumeDocument.saveError(error)
            self.error = message
            return message
        }
    }

    /// 选择 PNG/JPEG（≤10 MB）上传到 `POST /api/resumes/{id}/assets`，返回可写入简历的地址。
    private func uploadImage() async -> String? {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else { return nil }
        guard let data = try? Data(contentsOf: url) else { error = "图片读取失败，请重新选择。"; return nil }
        guard data.count <= 10 * 1024 * 1024 else { error = "图片不能超过 10 MB。"; return nil }
        let type = url.pathExtension.lowercased() == "png" ? "image/png" : "image/jpeg"
        uploading = true; error = nil
        defer { uploading = false }
        do {
            let result = try await session.api.careerRequest(path: "/api/resumes/\(resumeID)/assets", method: "POST", query: [:], body: .object([
                "file_name": .string(String(url.lastPathComponent.prefix(120))),
                "data_url": .string("data:\(type);base64,\(data.base64EncodedString())"),
            ]))
            guard let src = result["asset"]?["url"]?.stringValue, ResumeDocument.validImageSource(src) else { throw APIError.invalidResponse }
            return src
        } catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            self.error = ResumeRequest.errorMessage(error, fallback: "图片上传失败，请稍后重试。")
            return nil
        }
    }
}
