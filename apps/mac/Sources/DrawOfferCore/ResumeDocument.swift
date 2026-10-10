import Foundation

/// 原生结构化编辑 canonical-resume.v1（`contracts/resume/canonical-resume.schema.json`）的辅助函数。
/// 文本以 runs 编辑（加粗/斜体/下划线/删除线/代码、链接、颜色、高亮、字号）；图标与行内图片原样保留。
/// 分栏行、图片块与头像可编辑。保存前按 Web `canonicalV1SourceDispositions` 重算来源处置，删除的节点不留悬空引用。
public enum ResumeDocument {
    public static let entryFields: [(key: String, label: String)] = [
        ("name", "名称"), ("organization", "单位"), ("role", "角色/职位"), ("degree", "学位"), ("major", "专业"),
        ("location", "地点"), ("start_date", "开始时间"), ("end_date", "结束时间"), ("url", "链接"),
    ]
    public static let sectionKinds: [(key: String, label: String)] = [
        ("profile", "个人简介"), ("work", "工作经历"), ("education", "教育经历"), ("project", "项目经历"), ("skills", "专业技能"),
        ("activity", "校园/社会活动"), ("interests", "兴趣爱好"), ("certificates", "证书"), ("awards", "荣誉奖项"), ("languages", "语言能力"), ("custom", "自定义"),
    ]
    public static let contactKinds: [(key: String, label: String)] = [
        ("phone", "电话"), ("email", "邮箱"), ("website", "网站"), ("location", "所在地"), ("github", "GitHub"), ("linkedin", "LinkedIn"), ("other", "其他"),
    ]

    public static func newNodeID() -> String {
        "node_" + UUID().uuidString.lowercased().replacingOccurrences(of: "-", with: "").prefix(24)
    }

    // MARK: Text values

    static let plainStyle: JSONValue = .object(["color": .null, "font_size_pt": .null, "highlight_color": .null])

    /// 文本 run 是否为无格式纯文本。
    static func isPlainRun(_ run: JSONValue) -> Bool {
        guard run.text("inline_type") == "text" else { return false }
        let marks = run["marks"]?.items ?? []
        let href = run["href"] ?? .null
        let style = run["style"] ?? .null
        let styleEmpty = style == .null || ["color", "font_size_pt", "highlight_color"].allSatisfy { (style[$0] ?? .null) == .null }
        return marks.isEmpty && href == .null && styleEmpty
    }

    /// textValue 可编辑：没有 runs，或 runs 全是纯文本。
    public static func editable(_ textValue: JSONValue?) -> Bool {
        guard let textValue, textValue != .null else { return true }
        guard let runs = textValue["runs"], runs != .null else { return true }
        return runs.items.allSatisfy(isPlainRun)
    }

    public static func value(_ textValue: JSONValue?) -> String { textValue?["value"]?.stringValue ?? "" }

    /// textValue 的 runs；没有 runs 时由 value 生成一段纯文本。
    public static func textRuns(_ textValue: JSONValue?) -> [JSONValue] {
        if let runs = textValue?["runs"], runs != .null { return runs.items }
        return plainRuns(value(textValue)).items
    }

    /// 以 runs 写入 textValue（只接受文字 run）；value 与 runs 拼接一致，全是纯文本时去掉 runs。空时返回 nil。
    public static func setTextRuns(_ textValue: JSONValue?, _ runs: [JSONValue], limit: Int = 20_000) -> JSONValue? {
        let textOnly = normalizeRuns(runs.filter { $0.text("inline_type") == "text" })
        let text = textOnly.map { $0.text("text") }.joined()
        guard !text.isEmpty, text.count <= limit else { return text.isEmpty ? nil : textValue }
        var fields: [String: JSONValue]
        if let textValue, case .object(let existing) = textValue { fields = existing }
        else { fields = ["node_id": .string(newNodeID()), "source_refs": .array([])] }
        fields["value"] = .string(text)
        if textOnly.allSatisfy(isPlainRun) { fields.removeValue(forKey: "runs") } else { fields["runs"] = .array(textOnly) }
        return .object(fields)
    }

    /// 合并相邻同格式文字 run、去掉空 run（schema 要求 text 至少 1 个字符）。
    public static func normalizeRuns(_ runs: [JSONValue]) -> [JSONValue] {
        var result: [JSONValue] = []
        for run in runs {
            if run.text("inline_type") == "text" {
                guard !run.text("text").isEmpty else { continue }
                if let last = result.last, last.text("inline_type") == "text", sameFormat(last, run), case .object(var merged) = last {
                    merged["text"] = .string(last.text("text") + run.text("text"))
                    result[result.count - 1] = .object(merged)
                    continue
                }
            }
            result.append(run)
        }
        return result
    }

    static func sameFormat(_ left: JSONValue, _ right: JSONValue) -> Bool {
        Set((left["marks"]?.items ?? []).compactMap(\.stringValue)) == Set((right["marks"]?.items ?? []).compactMap(\.stringValue))
            && (left["href"] ?? .null) == (right["href"] ?? .null) && (left["style"] ?? plainStyle) == (right["style"] ?? plainStyle)
    }

    /// 构造一个文字 run。
    public static func textRun(_ text: String, marks: [String] = [], href: String? = nil, color: String? = nil, highlight: String? = nil, size: Double? = nil) -> JSONValue {
        let order = ["bold", "italic", "underline", "strike", "code"]
        return .object([
            "inline_type": .string("text"), "text": .string(text),
            "marks": .array(order.filter(marks.contains).map(JSONValue.string)),
            "href": href.map(JSONValue.string) ?? .null,
            "style": .object(["color": color.map(JSONValue.string) ?? .null, "font_size_pt": size.map(JSONValue.number) ?? .null,
                              "highlight_color": highlight.map(JSONValue.string) ?? .null]),
        ])
    }

    public static let iconNames = ["Mail", "Phone", "MapPin", "Globe", "Github", "Linkedin", "GraduationCap", "Briefcase", "Award", "Star", "Calendar", "Code2"]

    /// 写入 textValue；空串时返回 nil（由调用方决定置空或删除字段）。保留 node_id、source_refs、prefix_runs 与 align。
    public static func setValue(_ textValue: JSONValue?, _ text: String) -> JSONValue? {
        guard !text.isEmpty else { return nil }
        var fields: [String: JSONValue]
        if let textValue, case .object(let existing) = textValue { fields = existing }
        else { fields = ["node_id": .string(newNodeID()), "source_refs": .array([])] }
        fields["value"] = .string(String(text.prefix(20_000)))
        fields.removeValue(forKey: "runs")
        return .object(fields)
    }

    // MARK: Paragraph & list item runs

    public static func runsEditable(_ runs: JSONValue?) -> Bool { (runs?.items ?? []).allSatisfy(isPlainRun) }

    public static func runsText(_ runs: JSONValue?) -> String {
        (runs?.items ?? []).map { run in
            switch run.text("inline_type") {
            case "text": run.text("text")
            case "icon": "[\(run.text("name"))]"
            default: "[图片]"
            }
        }.joined()
    }

    public static func plainRuns(_ text: String) -> JSONValue {
        text.isEmpty ? .array([]) : .array([.object([
            "inline_type": .string("text"), "text": .string(String(text.prefix(20_000))), "marks": .array([]), "href": .null, "style": plainStyle,
        ])])
    }

    public static func newParagraph(_ text: String = "") -> JSONValue {
        .object(["node_id": .string(newNodeID()), "block_type": .string("paragraph"), "runs": plainRuns(text), "source_refs": .array([])])
    }

    public static func newList(ordered: Bool) -> JSONValue {
        .object(["node_id": .string(newNodeID()), "block_type": .string(ordered ? "ordered_list" : "bullet_list"),
                 "start": ordered ? .number(1) : .null, "items": .array([newListItem()])])
    }

    public static func newListItem(_ text: String = "") -> JSONValue {
        .object(["node_id": .string(newNodeID()), "runs": plainRuns(text), "source_refs": .array([])])
    }

    public static func newEntry() -> JSONValue {
        .object(["node_id": .string(newNodeID()), "fields": .object([:]), "blocks": .array([]), "source_refs": .array([])])
    }

    public static func newSection(kind: String, title: String) -> JSONValue {
        .object(["node_id": .string(newNodeID()), "semantic_kind": .string(kind), "title": setValue(nil, title) ?? .null,
                 "entries": .array([]), "blocks": .array([]), "source_refs": .array([])])
    }

    public static func newContact(kind: String, value: String) -> JSONValue {
        .object(["node_id": .string(newNodeID()), "contact_kind": .string(kind), "value": .string(value), "source_refs": .array([])])
    }

    /// 段落或列表项写入 runs（文字、图标与行内图片）。
    public static func setBlockRuns(_ node: JSONValue, _ runs: [JSONValue]) -> JSONValue {
        guard case .object(var fields) = node else { return node }
        fields["runs"] = .array(Array(normalizeRuns(runs).prefix(2000)))
        return .object(fields)
    }

    public static func setAlign(_ node: JSONValue, _ align: String?) -> JSONValue {
        guard case .object(var fields) = node else { return node }
        fields["align"] = align.map(JSONValue.string) ?? .null
        return .object(fields)
    }

    /// 分栏行：pair 两栏（左栏 30–80%），trio 三栏，meta 四栏。
    public static func newRow(kind: String) -> JSONValue {
        let count = ["pair": 2, "trio": 3, "meta": 4][kind] ?? 2
        let cells = (0..<count).map { _ in
            JSONValue.object(["node_id": .string(newNodeID()), "source_refs": .array([]), "blocks": .array([newParagraph()])])
        }
        return .object(["node_id": .string(newNodeID()), "source_refs": .array([]), "block_type": .string("row"), "row_kind": .string(kind),
                        "cells": .array(cells), "left_width_percent": kind == "pair" ? .number(50) : .null, "column_widths_percent": .null])
    }

    public static func newImage(src: String, alt: String?) -> JSONValue {
        .object(["node_id": .string(newNodeID()), "source_refs": .array([]), "block_type": .string("media"), "media_kind": .string("resume_image"),
                 "src": .string(src), "alt": alt.map(JSONValue.string) ?? .null, "width": .number(100), "width_unit": .string("%"),
                 "height_px": .null, "align": .string("center"), "system_fallback": .bool(false)])
    }

    public static let avatarSizeRange = (min: 56.0, max: 220.0)

    /// 头像：保留原 node_id 与来源引用，只替换图片地址。
    public static func avatar(_ previous: JSONValue?, src: String, width: Double = 96) -> JSONValue {
        var fields: [String: JSONValue] = ["node_id": .string(newNodeID()), "source_refs": .array([])]
        if let previous, case .object(let existing) = previous { fields = existing }
        fields["media_kind"] = .string("avatar"); fields["src"] = .string(src); fields["alt"] = fields["alt"] ?? .null
        fields["width"] = fields["width"].flatMap { $0 == .null ? nil : $0 } ?? .number(width); fields["width_unit"] = .string("px")
        fields["height_px"] = .null; fields["align"] = .null; fields["system_fallback"] = .bool(false)
        return .object(fields)
    }

    /// 简历图片地址只接受 http(s) 或站内 `/api/assets`、`/api/resumes`、`/templates` 路径（schema `src` pattern）。
    public static func validImageSource(_ src: String) -> Bool {
        src.range(of: #"^(?:https?://[^\s]{1,2040}|/(?:api/assets|api/resumes|templates)/[^\s]{1,2020})$"#, options: .regularExpression) != nil
    }

    /// 段落或列表项写入纯文本（只在 runsEditable 时调用）。
    public static func setRuns(_ node: JSONValue, _ text: String) -> JSONValue {
        guard case .object(var fields) = node else { return node }
        fields["runs"] = plainRuns(text)
        return .object(fields)
    }

    // MARK: Validation & dispositions

    /// 提交前清理：空的列表项与列表移除；联系方式值不能为空；重算来源处置。
    public static func prepareForSave(_ document: JSONValue, previous: JSONValue) -> JSONValue {
        guard case .object(var fields) = document else { return document }
        if case .object(var identity) = fields["identity"] ?? .null {
            identity["contacts"] = .array((identity["contacts"]?.items ?? []).filter { !$0.text("value").trimmingCharacters(in: .whitespaces).isEmpty })
            fields["identity"] = .object(identity)
        }
        fields["sections"] = .array((fields["sections"]?.items ?? []).map(cleanSection))
        var next = JSONValue.object(fields)
        fields["source_dispositions"] = .array(sourceDispositions(previous: previous, next: next))
        next = .object(fields)
        return next
    }

    static func cleanBlocks(_ blocks: JSONValue?) -> JSONValue {
        .array((blocks?.items ?? []).compactMap { block in
            let type = block.text("block_type")
            guard type == "bullet_list" || type == "ordered_list", case .object(var list) = block else { return block }
            let items = (list["items"]?.items ?? []).filter { !runsText($0["runs"]).trimmingCharacters(in: .whitespaces).isEmpty || !runsEditable($0["runs"]) }
            guard !items.isEmpty else { return nil }
            list["items"] = .array(items)
            return .object(list)
        })
    }

    static func cleanSection(_ section: JSONValue) -> JSONValue {
        guard case .object(var fields) = section else { return section }
        fields["blocks"] = cleanBlocks(fields["blocks"])
        fields["entries"] = .array((fields["entries"]?.items ?? []).map { entry in
            guard case .object(var entryFields) = entry else { return entry }
            entryFields["blocks"] = cleanBlocks(entryFields["blocks"])
            return .object(entryFields)
        })
        return .object(fields)
    }

    /// Web `canonicalV1SourceDispositions`：按新文档里仍引用来源的节点重写目标；不再被引用的非 dropped 来源改为 `user_removed`。
    public static func sourceDispositions(previous: JSONValue, next: JSONValue) -> [JSONValue] {
        var targets: [String: [String]] = [:]
        func visit(_ value: JSONValue, key: String?) {
            switch value {
            case .array(let items): items.forEach { visit($0, key: key) }
            case .object(let object):
                if let id = object["node_id"]?.stringValue, id.hasPrefix("node_"), let refs = object["source_refs"]?.items {
                    for source in refs.compactMap(\.stringValue) where !(targets[source]?.contains(id) ?? false) { targets[source, default: []].append(id) }
                }
                for (childKey, child) in object where childKey != "source_dispositions" { visit(child, key: childKey) }
            default: break
            }
        }
        visit(next, key: nil)
        return (previous["source_dispositions"]?.items ?? []).map { disposition in
            guard case .object(var fields) = disposition else { return disposition }
            let outcome = disposition.text("outcome")
            if let found = targets[disposition.text("source_id")], !found.isEmpty {
                fields["outcome"] = .string(outcome == "transformed" ? "transformed" : "mapped")
                fields["target_node_ids"] = .array(found.map(JSONValue.string))
                fields["reason_code"] = outcome == "transformed" ? (disposition["reason_code"] ?? .null) : .null
                return .object(fields)
            }
            if outcome == "dropped" { return disposition }
            fields["outcome"] = .string("dropped"); fields["target_node_ids"] = .array([]); fields["reason_code"] = .string("user_removed")
            return .object(fields)
        }
    }

    public static func saveError(_ error: Error) -> String {
        if case APIError.unauthorized = error { return "登录已失效，请重新登录。修改尚未保存。" }
        guard case APIError.server(let status, let code) = error else { return "网络中断，修改可能尚未保存。请重试保存。" }
        return [
            "RESUME_EDIT_CONFLICT": "简历已在其他地方更新。请重新载入后再修改，当前未保存的内容会丢失。",
            "RESUME_SCHEMA_INVALID": "简历内容不符合格式要求，请检查后重试。",
            "TEMPLATE_COMPOSITION_INVALID": "当前模板无法容纳这些内容，请换一个模板或调整模块。",
            "TEMPLATE_INACTIVE": "这个模板已下线，请换一个模板。",
            "INVALID_RESUME_STYLE": "版式设置超出范围，请调整后重试。",
            "RESUME_WRITE_PENDING": "简历正在被 AI 修改，请稍后再试。",
            "INVALID_RESUME_TITLE": "名称无效，请输入 1–255 个字符且不含换行。",
            "RESUME_TITLE_CONFLICT": "已有同名简历，请换一个名称。",
            "DESKTOP_ROUTE_FORBIDDEN": "当前服务尚未开放桌面端编辑，请更新服务端后重试。",
        ][code] ?? (status == 422 ? "内容有字段超出限制，请检查长度后重试。" : "保存失败（\(code)），请稍后重试。")
    }
}

/// JSON 路径：对象键或数组下标。
public enum JSONPathPart: Hashable, Sendable { case key(String), index(Int) }

extension JSONValue {
    public subscript(path path: [JSONPathPart]) -> JSONValue? {
        var current: JSONValue? = self
        for part in path {
            switch part {
            case .key(let key): current = current?[key]
            case .index(let index):
                guard case .array(let items) = current ?? .null, items.indices.contains(index) else { return nil }
                current = items[index]
            }
        }
        return current
    }

    /// 返回在 path 处写入（nil 表示删除对象键或数组元素）后的新值；中间缺失的对象会被创建。
    public func setting(_ path: [JSONPathPart], to value: JSONValue?) -> JSONValue {
        guard let first = path.first else { return value ?? .null }
        let rest = Array(path.dropFirst())
        switch first {
        case .key(let key):
            var object: [String: JSONValue]
            if case .object(let existing) = self { object = existing } else { object = [:] }
            if rest.isEmpty {
                if let value { object[key] = value } else { object.removeValue(forKey: key) }
            } else {
                object[key] = (object[key] ?? .object([:])).setting(rest, to: value)
            }
            return .object(object)
        case .index(let index):
            guard case .array(var items) = self, items.indices.contains(index) else { return self }
            if rest.isEmpty {
                if let value { items[index] = value } else { items.remove(at: index) }
            } else { items[index] = items[index].setting(rest, to: value) }
            return .array(items)
        }
    }

    /// 在数组 path 末尾追加；path 指向的不是数组时新建数组。
    public func appending(_ path: [JSONPathPart], _ value: JSONValue) -> JSONValue {
        var items = self[path: path]?.items ?? []
        items.append(value)
        return setting(path, to: .array(items))
    }

    /// 交换数组 path 中两个元素。
    public func moving(_ path: [JSONPathPart], from: Int, to: Int) -> JSONValue {
        var items = self[path: path]?.items ?? []
        guard items.indices.contains(from), items.indices.contains(to) else { return self }
        items.swapAt(from, to)
        return setting(path, to: .array(items))
    }
}
