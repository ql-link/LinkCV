import DrawOfferCore
import SwiftUI

/// 编辑器的三个面板，对应 Web 的 `WorkbenchTemplatePanel`、`WorkbenchTypePanel` 与 `WorkbenchSectionOrderControl`。

// MARK: - 切换模板

struct TemplateSwitchSheet: View {
    @Environment(SessionStore.self) private var session
    let currentKey: String
    let apply: (ResumeTemplate) async -> String?
    let close: () -> Void

    @State private var templates: [ResumeTemplate] = []
    @State private var loading = true
    @State private var failed = false
    @State private var applying: String?
    @State private var error: String?
    @State private var style = ""
    @State private var useCase = ""

    private var filtered: [ResumeTemplate] {
        templates.filter { (style.isEmpty || $0.styleCategories.contains(style)) && (useCase.isEmpty || $0.useCases.contains(useCase)) }
    }

    static func key(_ template: ResumeTemplate) -> String { template.style["template_key"]?.stringValue ?? template.key }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("简历模板").font(V3.sans(16, weight: .medium))
                    Text("点击模板即可应用到当前简历，内容不会丢失").font(V3.sans(12)).foregroundStyle(V3.sub)
                }
                Spacer()
                Button("完成", action: close).buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(applying != nil)
            }.padding(20)
            if !loading && !failed && !templates.isEmpty {
                HStack(spacing: 10) {
                    Text("\(filtered.count) 套模板").font(V3.sans(12.5)).foregroundStyle(V3.sub)
                    Spacer()
                    Picker("风格", selection: $style) {
                        Text("全部风格").tag("")
                        ForEach(Array(Set(templates.flatMap(\.styleCategories))).sorted(), id: \.self) { Text($0).tag($0) }
                    }.labelsHidden().frame(width: 130)
                    Picker("场景", selection: $useCase) {
                        Text("全部场景").tag("")
                        ForEach(Array(Set(templates.flatMap(\.useCases))).sorted(), id: \.self) { Text($0).tag($0) }
                    }.labelsHidden().frame(width: 130)
                }.padding(.horizontal, 20).padding(.bottom, 10)
            }
            if let error { Text(error).font(V3.sans(12)).foregroundStyle(V3.red).padding(.horizontal, 20).padding(.bottom, 8) }
            Divider()
            if loading { ProgressView("正在加载简历模板…").frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if failed {
                VStack(spacing: 8) {
                    Text("模板暂时无法加载").font(V3.sans(14, weight: .medium))
                    Text("请检查网络后重试，当前简历不会受到影响。").font(V3.sans(12.5)).foregroundStyle(V3.sub)
                    Button("重新加载") { Task { await load() } }.buttonStyle(V3ButtonStyle(kind: .ghost))
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if templates.isEmpty {
                Text("当前没有可用模板").font(V3.sans(13)).foregroundStyle(V3.sub).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 16)], spacing: 20) {
                        ForEach(filtered) { template in card(template) }
                    }.padding(20)
                }
            }
        }.frame(width: 760, height: 620).task { await load() }
    }

    private func card(_ template: ResumeTemplate) -> some View {
        let current = Self.key(template) == currentKey
        return Button { Task { await choose(template) } } label: {
            VStack(alignment: .leading, spacing: 8) {
                TemplateThumbnail(template: template, guest: false)
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(current ? V3.blue : .clear, lineWidth: 2))
                    .overlay { if applying == template.id { ProgressView().controlSize(.small).padding(8).background(.white, in: Capsule()) } }
                HStack {
                    Text(template.name).font(V3.sans(12.5, weight: .medium)).lineLimit(1)
                    Spacer(minLength: 4)
                    if current { Text("当前").font(V3.sans(11)).foregroundStyle(V3.blue) }
                }
            }
        }.buttonStyle(.plain).disabled(current || applying != nil).accessibilityLabel(current ? "当前模板：\(template.name)" : "应用模板：\(template.name)")
    }

    private func choose(_ template: ResumeTemplate) async {
        applying = template.id; error = nil
        error = await apply(template)
        applying = nil
    }

    private func load() async {
        loading = true; failed = false
        defer { loading = false }
        do { templates = try await session.api.listResumeTemplates().filter { !ResumeRequest.retiredTemplateKeys.contains($0.key) } }
        catch {
            if case APIError.unauthorized = error { session.reportAuthenticationFailure() }
            failed = true
        }
    }
}

// MARK: - 版式设置

struct TypeSettingsPanel: View {
    @Binding var settings: ResumeTypeSettings
    let disabled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("设置").font(V3.sans(15, weight: .medium))
            Toggle("智能一页", isOn: $settings.smartOnePage).toggleStyle(.switch).font(V3.sans(13))
                .help("内容略多时自动收紧间距，尽量排在一页内")
            Divider()
            section("页边距", "分别调整上下和左右留白，单位为毫米。")
            stepper("上下边距", unit: "mm", value: $settings.verticalPageMargin, range: ResumeTypeSettings.verticalMarginRange)
            stepper("左右边距", unit: "mm", value: $settings.pageMargin, range: ResumeTypeSettings.horizontalMarginRange)
            Divider()
            section("排版", "统一调整简历正文的字体、字号和行距。")
            HStack {
                Text("字体").font(V3.sans(13))
                Spacer()
                Picker("字体", selection: $settings.fontFamily) {
                    ForEach(ResumeTypeSettings.fonts, id: \.value) { Text($0.label).tag($0.value) }
                    if !ResumeTypeSettings.fonts.contains(where: { $0.value == settings.fontFamily }) { Text("模板默认").tag(settings.fontFamily) }
                }.labelsHidden().frame(width: 140)
            }
            stepper("正文字号", unit: "pt", value: $settings.fontSize, range: ResumeTypeSettings.fontSizeRange)
            stepper("正文行距", unit: "", value: $settings.lineHeight, range: ResumeTypeSettings.lineHeightRange)
        }.padding(18).frame(width: 300).disabled(disabled)
    }

    private func section(_ title: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(V3.sans(13, weight: .medium))
            Text(detail).font(V3.sans(11.5)).foregroundStyle(V3.fnt)
        }
    }

    private func stepper(_ label: String, unit: String, value: Binding<Double>, range: (min: Double, max: Double, step: Double)) -> some View {
        HStack {
            Text(label).font(V3.sans(13))
            Spacer()
            Button { value.wrappedValue = ResumeTypeSettings.step(value.wrappedValue, by: -1, min: range.min, max: range.max, step: range.step) } label: { Image(systemName: "minus") }
                .disabled(value.wrappedValue <= range.min).accessibilityLabel("减小\(label)")
            Text("\(String(format: "%g", (value.wrappedValue * 100).rounded() / 100))\(unit.isEmpty ? "" : " \(unit)")")
                .font(V3.number(12.5)).frame(minWidth: 56)
            Button { value.wrappedValue = ResumeTypeSettings.step(value.wrappedValue, by: 1, min: range.min, max: range.max, step: range.step) } label: { Image(systemName: "plus") }
                .disabled(value.wrappedValue >= range.max).accessibilityLabel("增大\(label)")
        }.buttonStyle(.borderless)
    }
}

// MARK: - 板块顺序

struct SectionOrderSheet: View {
    let sections: [JSONValue]
    /// node_id → "sidebar" / "main"；单栏模板为空。
    let columns: [String: String]
    let apply: ([JSONValue]) -> Void
    let close: () -> Void
    @State private var order: [JSONValue] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("调整板块顺序").font(V3.sans(16, weight: .medium))
                    Text(columns.isEmpty ? "拖动排序，个人信息固定在最前" : "拖动排序；双栏模板中各栏分别排序，个人信息固定在最前").font(V3.sans(12)).foregroundStyle(V3.sub)
                }
                Spacer()
            }.padding(20)
            List {
                Label("个人信息", systemImage: "lock").foregroundStyle(V3.fnt)
                if columns.isEmpty {
                    ForEach(order, id: \.nodeKey) { row($0) }
                        .onMove { order.move(fromOffsets: $0, toOffset: $1) }
                } else {
                    ForEach(["sidebar", "main"], id: \.self) { side in
                        let group = order.filter { (columns[$0.text("node_id")] ?? "main") == side }
                        if !group.isEmpty {
                            Section(side == "sidebar" ? "侧栏" : "主栏") {
                                ForEach(group, id: \.nodeKey) { row($0) }
                                    .onMove { move(side, from: $0, to: $1) }
                            }
                        }
                    }
                }
            }.frame(minHeight: 300)
            HStack {
                Button("恢复默认顺序") { order = ResumeSectionOrder.restoreDefault(order) }.buttonStyle(.link)
                Spacer()
                Button("取消", action: close).buttonStyle(V3ButtonStyle(kind: .ghost))
                Button("应用") { apply(order); close() }.buttonStyle(V3ButtonStyle(kind: .dark)).keyboardShortcut(.defaultAction)
            }.padding(20)
        }.frame(width: 440, height: 520).onAppear { order = sections }
    }

    private func row(_ section: JSONValue) -> some View {
        let kind = ResumeDocument.sectionKinds.first { $0.key == section.text("semantic_kind") }?.label ?? "模块"
        let title = ResumeDocument.value(section["title"])
        return HStack {
            Image(systemName: "line.3.horizontal").foregroundStyle(V3.fnt)
            Text(title.isEmpty ? kind : title).font(V3.sans(13))
            Spacer()
            if !title.isEmpty && title != kind { Text(kind).font(V3.sans(11)).foregroundStyle(V3.fnt) }
        }
    }

    /// 只在同一栏内移动：把该栏的新顺序写回它原来占据的位置。
    private func move(_ side: String, from: IndexSet, to: Int) {
        let positions = order.indices.filter { (columns[order[$0].text("node_id")] ?? "main") == side }
        var group = positions.map { order[$0] }
        group.move(fromOffsets: from, toOffset: to)
        for (position, section) in zip(positions, group) { order[position] = section }
    }
}

extension JSONValue {
    /// 列表标识：canonical 节点的 node_id。
    var nodeKey: String { text("node_id") }
}
