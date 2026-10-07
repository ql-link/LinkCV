import Foundation

/// 编辑中的实时纸面：后端 `domain/resume/layout.py` 的 `compile_layout_plan` 在 Swift 的移植。
/// 只为未保存内容生成本地预览用的版式计划；保存后仍以后端返回的 layout_plan 为准。
/// 规则相同：identity 在前，各模块按存储顺序；每个节点选唯一的显式槽位，否则落到通用兜底槽位。
public enum ResumeLayout {
    public static func compile(data: JSONValue, style: JSONValue, contentHash: String) -> JSONValue? {
        let template = style["template_snapshot"] ?? .null
        let regions = template["regions"]?.items ?? []
        let slots = (template["slots"]?.items ?? []).sorted {
            (number($0["order"]), $0.text("slot_id")) < (number($1["order"]), $1.text("slot_id"))
        }
        guard !regions.isEmpty, !slots.isEmpty, let identity = data["identity"]?.text("node_id"), !identity.isEmpty else { return nil }
        var top: [(id: String, kind: String)] = [(identity, "identity")]
        top += (data["sections"]?.items ?? []).map { ($0.text("node_id"), $0.text("semantic_kind")) }
        var assigned: [String: [JSONValue]] = [:]
        for node in top {
            guard let slot = select(node.kind, slots) else { return nil }
            assigned[slot.text("region_id"), default: []].append(.object([
                "node_id": .string(node.id), "semantic_kind": .string(node.kind), "slot_id": .string(slot.text("slot_id")),
            ]))
        }
        let ordered = regions.sorted { (number($0["order"]), $0.text("region_id")) < (number($1["order"]), $1.text("region_id")) }
        return .object([
            "schema_version": .string("layout-plan.v1"),
            "content_sha256": .string(contentHash),
            "template_key": .string(template.text("template_key")),
            "regions": .array(ordered.map { region in
                .object(["region_id": .string(region.text("region_id")), "order": region["order"] ?? .number(0),
                         "nodes": .array(assigned[region.text("region_id")] ?? [])])
            }),
        ])
    }

    static func select(_ kind: String, _ slots: [JSONValue]) -> JSONValue? {
        func accepts(_ slot: JSONValue) -> Bool { (slot["accepts"]?.items ?? []).contains(.string(kind)) }
        let explicit = slots.filter { $0["universal_fallback"] != .bool(true) && accepts($0) }
        if explicit.count == 1 { return explicit[0] }
        guard explicit.isEmpty else { return nil }
        let fallback = slots.filter { $0["universal_fallback"] == .bool(true) }
        return fallback.count == 1 && accepts(fallback[0]) ? fallback[0] : nil
    }

    /// 双栏模板中每个模块所在的栏（侧栏/主栏），用于排序面板分组；单栏模板返回空。
    public static func columns(data: JSONValue, style: JSONValue) -> [String: String] {
        let template = style["template_snapshot"] ?? .null
        let regions = template["regions"]?.items ?? []
        guard regions.contains(where: { $0.text("region_kind") == "sidebar" }),
              let plan = compile(data: data, style: style, contentHash: "") else { return [:] }
        var kinds: [String: String] = [:]
        for region in regions { kinds[region.text("region_id")] = region.text("region_kind") }
        var result: [String: String] = [:]
        for region in plan["regions"]?.items ?? [] {
            for node in region["nodes"]?.items ?? [] { result[node.text("node_id")] = kinds[region.text("region_id")] ?? "main" }
        }
        return result
    }

    static func number(_ value: JSONValue?) -> Double { value?.numberValue ?? 0 }
}

/// Web `styleToEditorSettings` / `editorSettingsToStyle`（canonical 分支）的移植：字体、字号、行距、边距与智能一页。
public struct ResumeTypeSettings: Equatable, Sendable {
    public static let serifStack = "\"Source Han Serif SC\", \"Songti SC\", STSong, SimSun, serif"
    public static let fonts: [(label: String, value: String)] = [
        ("思源宋体", serifStack),
        ("霞鹜文楷", "\"LXGW WenKai\", KaiTi, STKaiti, \"Songti SC\", serif"),
        ("系统黑体", "\"LinkResume Noto Sans SC\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif"),
    ]
    public static let fontSizeRange = (min: 8.0, max: 16.0, step: 0.5)
    public static let lineHeightRange = (min: 1.1, max: 1.8, step: 0.05)
    public static let verticalMarginRange = (min: 6.0, max: 30.0, step: 2.0)
    public static let horizontalMarginRange = (min: 10.0, max: 30.0, step: 2.0)

    public var fontFamily: String
    public var fontSize: Double
    public var lineHeight: Double
    public var pageMargin: Double
    public var verticalPageMargin: Double
    public var smartOnePage: Bool

    public init(fontFamily: String, fontSize: Double, lineHeight: Double, pageMargin: Double, verticalPageMargin: Double, smartOnePage: Bool) {
        self.fontFamily = fontFamily; self.fontSize = fontSize; self.lineHeight = lineHeight
        self.pageMargin = pageMargin; self.verticalPageMargin = verticalPageMargin; self.smartOnePage = smartOnePage
    }

    public static func read(_ style: JSONValue) -> ResumeTypeSettings? {
        guard style.text("schema_version") == "resume-presentation.v1", let tokens = style["template_snapshot"]?["tokens"] else { return nil }
        let key = style["template_snapshot"]?.text("template_key") ?? ""
        let scoped = style["template_scoped"]?[key] ?? .null
        let portable = style["portable"] ?? .null
        func pick(_ field: String) -> Double? { scoped[field]?.numberValue ?? portable[field]?.numberValue }
        let base = tokens["font_size_pt"]?.numberValue ?? 10
        let scale = pick("font_scale") ?? 1
        let margin = tokens["page_margin_mm"]?.numberValue ?? 16
        let horizontal = pick("page_margin_mm") ?? margin
        let vertical = pick("vertical_page_margin_mm") ?? tokens["vertical_page_margin_mm"]?.numberValue ?? margin
        let persisted = scoped["font_family"]?.stringValue ?? portable["font_family"]?.stringValue ?? tokens.text("font_family")
        var font = persisted == "source-han-serif" ? serifStack : persisted
        if font.range(of: "PingFang SC|Microsoft YaHei|system-ui", options: .regularExpression) != nil { font = fonts[2].value }
        return ResumeTypeSettings(
            fontFamily: font,
            fontSize: (base * scale * 1e10).rounded() / 1e10,
            lineHeight: pick("line_height") ?? tokens["line_height"]?.numberValue ?? 1.5,
            pageMargin: pick("page_margin_left_mm") ?? tokens["page_margin_left_mm"]?.numberValue ?? horizontal,
            verticalPageMargin: pick("page_margin_top_mm") ?? tokens["page_margin_top_mm"]?.numberValue ?? vertical,
            smartOnePage: portable["smart_one_page"] == .bool(true))
    }

    /// 写回 presentation；与 Web 相同，只在边距真正改变时写四边覆盖值。
    public func apply(to style: JSONValue) -> JSONValue {
        guard let previous = ResumeTypeSettings.read(style), case .object(var root) = style else { return style }
        let key = style["template_snapshot"]?.text("template_key") ?? ""
        let base = style["template_snapshot"]?["tokens"]?["font_size_pt"]?.numberValue ?? 0
        var portable: [String: JSONValue] = { if case .object(let value) = style["portable"] ?? .null { return value }; return [:] }()
        portable["smart_one_page"] = .bool(smartOnePage)
        portable["line_height"] = .number(lineHeight)
        portable["page_margin_mm"] = .number(pageMargin)
        portable["vertical_page_margin_mm"] = .number(verticalPageMargin)
        var allScoped: [String: JSONValue] = { if case .object(let value) = style["template_scoped"] ?? .null { return value }; return [:] }()
        var scoped: [String: JSONValue] = { if case .object(let value) = allScoped[key] ?? .null { return value }; return [:] }()
        if pageMargin != previous.pageMargin { scoped["page_margin_left_mm"] = .number(pageMargin); scoped["page_margin_right_mm"] = .number(pageMargin) }
        if verticalPageMargin != previous.verticalPageMargin { scoped["page_margin_top_mm"] = .number(verticalPageMargin); scoped["page_margin_bottom_mm"] = .number(verticalPageMargin) }
        scoped["font_family"] = .string(fontFamily.contains("Source Han Serif") ? "source-han-serif" : fontFamily)
        let scale = base > 0 ? fontSize / base : (scoped["font_scale"]?.numberValue ?? 1)
        scoped["font_scale"] = .number(min(1.5, max(0.75, scale.isFinite ? scale : 1)))
        scoped["line_height"] = .number(lineHeight)
        scoped["page_margin_mm"] = .number(pageMargin)
        scoped["vertical_page_margin_mm"] = .number(verticalPageMargin)
        allScoped[key] = .object(scoped)
        root["portable"] = .object(portable)
        root["template_scoped"] = .object(allScoped)
        return .object(root)
    }

    /// 步进并吸附到步长（Web `steppedSettingValue`）。
    public static func step(_ value: Double, by direction: Double, min lower: Double, max upper: Double, step: Double) -> Double {
        let next = ((value + direction * step) / step).rounded() * step
        return Swift.min(upper, Swift.max(lower, (next * 100).rounded() / 100))
    }
}

/// 板块顺序（Web `resumeSectionOrder.ts`）：个人信息固定在最前，其余按 canonical 顺序可拖动；
/// “恢复默认”按后端的语义顺序稳定排序。
public enum ResumeSectionOrder {
    public static let canonical = ["profile", "work", "project", "education", "skills", "activity", "interests", "certificates", "awards", "languages", "custom"]

    public static func restoreDefault(_ sections: [JSONValue]) -> [JSONValue] {
        sections.enumerated().sorted { left, right in
            let l = canonical.firstIndex(of: left.element.text("semantic_kind")) ?? canonical.count
            let r = canonical.firstIndex(of: right.element.text("semantic_kind")) ?? canonical.count
            return l == r ? left.offset < right.offset : l < r
        }.map(\.element)
    }
}
