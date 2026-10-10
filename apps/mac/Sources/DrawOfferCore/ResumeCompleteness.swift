import Foundation

/// 简历完整度（Web `features/workbench/resumeCompleteness.ts` 与 `resumeContract.ts` 的
/// `canonicalDocumentToMarkdown`）：把 canonical 正文投影为 Markdown，再按同一组 12 项检查与示例上限计分。
/// 规则只读正文，不经过 AI；Web 改动规则时需要同步这里。
public struct ResumeCompleteness: Equatable, Sendable {
    public struct Check: Equatable, Sendable {
        public let id: String
        public let label: String
        public let earned: Int
        public let max: Int
        public var passed: Bool { earned == max }
    }
    public let score: Int
    public let checks: [Check]
    /// 第一项未满分的检查，首页“待完善”使用。
    public var missing: String? { checks.first { !$0.passed }?.label }

    // MARK: Markdown projection

    public static func markdown(_ document: JSONValue) -> String {
        var lines: [String] = []
        let identity = document["identity"] ?? .null
        let name = identity["name"]?.text("value") ?? ""
        if !name.isEmpty { lines.append("# " + name) }
        let headline = identity["headline"]?.text("value") ?? ""
        if !headline.isEmpty { lines += ["", headline] }
        let contacts = identity["contacts"]?.items ?? []
        if !contacts.isEmpty {
            lines += ["", contacts.map { ($0.text("label").isEmpty ? "" : $0.text("label") + "：") + $0.text("value") }.joined(separator: " ｜ ")]
        }
        for section in document["sections"]?.items ?? [] {
            let title = section["title"]?.text("value") ?? ""
            if !title.isEmpty { lines += ["", "## " + title] }
            for entry in section["entries"]?.items ?? [] {
                let fields = entry["fields"] ?? .null
                let heading = ["name", "organization", "role"].lazy.compactMap { fields[$0] }.first
                let headingValue = heading?.text("value") ?? ""
                if !headingValue.isEmpty { lines += ["", "### " + headingValue] }
                for key in ["organization", "role", "location", "start_date", "end_date", "degree", "major", "url"] {
                    let value = fields[key]?.text("value") ?? ""
                    if !value.isEmpty && value != headingValue { lines.append(value) }
                }
                for block in entry["blocks"]?.items ?? [] { let text = blockMarkdown(block); if !text.isEmpty { lines += ["", text] } }
            }
            for block in section["blocks"]?.items ?? [] { let text = blockMarkdown(block); if !text.isEmpty { lines += ["", text] } }
        }
        var text = lines.joined(separator: "\n")
        while text.contains("\n\n\n") { text = text.replacingOccurrences(of: "\n\n\n", with: "\n\n") }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func runs(_ value: JSONValue?) -> String {
        (value?.items ?? []).filter { $0.text("inline_type") == "text" }.map { $0.text("text") }.joined()
    }

    static func blockMarkdown(_ block: JSONValue) -> String {
        switch block.text("block_type") {
        case "paragraph": return runs(block["runs"])
        case "bullet_list": return (block["items"]?.items ?? []).map { "- " + runs($0["runs"]) }.joined(separator: "\n")
        case "ordered_list":
            let start = block["start"]?.numberValue.map { Int($0) } ?? 1
            return (block["items"]?.items ?? []).enumerated().map { "\(start + $0.offset). " + runs($0.element["runs"]) }.joined(separator: "\n")
        case "row": return (block["cells"]?.items ?? []).map { runs($0["blocks"]?.items.first?["runs"]) }.joined(separator: " ｜ ")
        default: return ""
        }
    }

    // MARK: Scoring

    public static func evaluate(_ document: JSONValue) -> ResumeCompleteness? {
        guard document["identity"] != nil else { return nil }
        return evaluate(markdown: markdown(document))
    }

    static func regex(_ pattern: String) -> NSRegularExpression { try! NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) }
    static func matches(_ pattern: NSRegularExpression, _ text: String) -> Bool {
        pattern.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }
    static func all(_ pattern: NSRegularExpression, _ text: String) -> [String] {
        pattern.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { Range($0.range, in: text).map { String(text[$0]) } }
    }
    static func replace(_ text: String, _ pattern: String, _ with: String) -> String {
        regex(pattern).stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: with)
    }

    nonisolated(unsafe) static let education = regex("(?:教育|学历|院校|education|academic)")
    nonisolated(unsafe) static let skills = regex("(?:技能|技术栈|技术能力|专业能力|核心能力|能力与专长|专长|skills?|technolog|competenc|expertise)")
    nonisolated(unsafe) static let experience = regex("(?:工作|实习|项目|开源|校园|研究|实践|任职|职业|experience|employment|work|projects?|intern|research)")
    nonisolated(unsafe) static let date = regex("(?:19|20)\\d{2}(?:\\s*[./年-]\\s*(?:0?[1-9]|1[0-2])月?)?|至今|现在|present|current")
    nonisolated(unsafe) static let email = regex("\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b")
    nonisolated(unsafe) static let phone = regex("(?:\\+?\\d[\\d\\s()-]{5,}\\d)")
    nonisolated(unsafe) static let listItem = regex("^\\s*(?:[-*+]\\s+|\\d+[.)、]\\s*)\\S")
    static let listPrefix = "^\\s*(?:[-*+]\\s+|\\d+[.)、]\\s*)"
    nonisolated(unsafe) static let skillPlaceholder = regex("^(?:无|暂无|没有|待补充|待完善|略|技能|专业技能|技术栈|技术能力|核心能力|熟练|精通|掌握|了解)[。.!！]?$")
    nonisolated(unsafe) static let genericSkill = regex("^(?:沟通|学习|执行|抗压|适应|团队协作|责任心|认真负责|吃苦耐劳)(?:能力)?(?:强|良好|优秀)?[。.!！]?$")
    nonisolated(unsafe) static let skillApplication = regex("(?:熟练|精通|掌握|了解|使用|应用|搭建|开发|设计|优化|测试|分析|运营|管理|写作|协作|项目|场景|经验|年|能够|可独立|负责|提升|降低|完成|支持)")
    nonisolated(unsafe) static let latinSkill = regex("\\b[A-Z][A-Z0-9.+#/-]{1,}\\b")
    nonisolated(unsafe) static let multipleConcept = regex("(?:与|及|和|、|/|\\+|，|,|；|;)")

    static func visible(_ value: String) -> String {
        var text = value
        for (pattern, with) in [("<!--.*?-->", " "), ("!\\[[^\\]]*\\]\\([^)]*\\)", " "), ("\\[([^\\]]+)\\]\\([^)]*\\)", "$1"), ("<[^>]+>", " "),
                                (":\\w+\\[[^\\]]*\\]:", " "), (":::[^\\r\\n]*", " "), ("[*_~`>#|]", " "), ("\\s+", " ")] {
            text = replace(text, pattern, with)
        }
        return text.trimmingCharacters(in: .whitespaces)
    }

    static func phones(_ text: String) -> [String] {
        all(phone, text).map { $0.filter(\.isNumber) }.filter { (7...15).contains($0.count) }
    }

    static func meaningfulIdentity(_ body: String) -> Bool {
        body.components(separatedBy: "\n").contains { line in
            let text = visible(line)
            var stripped = replace(text, "(?:19|20)\\d{2}(?:\\s*[./年-]\\s*(?:0?[1-9]|1[0-2])月?)?", " ")
            stripped = replace(stripped, "至今|现在|present|current", " ")
            stripped = replace(stripped, "[\\d\\s./年月日|｜·—–~～-]", "")
            return stripped.count >= 2 && !matches(listItem, line) && !matches(email, text)
                && !matches(regex("^https?://"), text) && !matches(regex("^(?:电话|手机|邮箱|博客|主页|地址|技术架构|工作介绍|项目描述)[:：]?$"), text)
        }
    }

    static func skillEntries(_ body: String) -> [String] {
        let rawLines = body.components(separatedBy: "\n")
        let lines = rawLines.map { visible(replace($0, listPrefix, "")) }.filter { !$0.isEmpty }
        let explicit = rawLines.contains { matches(listItem, $0) }
        let candidates = explicit ? lines : lines.flatMap { $0.components(separatedBy: CharacterSet(charactersIn: "、·，,；;|")).map { $0.trimmingCharacters(in: .whitespaces) } }
        var seen = Set<String>(), result: [String] = []
        for entry in candidates where (2...120).contains(entry.count) && !matches(skillPlaceholder, entry) {
            if seen.insert(entry.lowercased()).inserted { result.append(entry) }
        }
        return result
    }

    static func quality(_ entry: String) -> Bool {
        if matches(genericSkill, entry) { return false }
        if matches(latinSkill, entry) { return true }
        if matches(skillApplication, entry) && entry.count >= 4 { return true }
        return matches(multipleConcept, entry) && entry.count >= 6
    }

    public static func evaluate(markdown source: String) -> ResumeCompleteness {
        let markdown = source
        let lines = markdown.components(separatedBy: "\n")
        var h1: [String] = [], h2: [(index: Int, title: String)] = [], firstH1 = -1
        for (index, line) in lines.enumerated() {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("# ") { h1.append(visible(String(trimmed.dropFirst(2)))); if firstH1 < 0 { firstH1 = index } }
            else if trimmed.hasPrefix("## ") { h2.append((index, visible(String(trimmed.dropFirst(3))))) }
        }
        let sections = h2.enumerated().map { offset, heading in
            (title: heading.title, body: lines[(heading.index + 1)..<(offset + 1 < h2.count ? h2[offset + 1].index : lines.count)].joined(separator: "\n"))
        }
        let firstH2 = h2.first?.index ?? lines.count
        let preamble = lines[(firstH1 >= 0 ? firstH1 + 1 : 0)..<max(firstH1 >= 0 ? firstH1 + 1 : 0, firstH2)].joined(separator: "\n")
        func kind(_ title: String) -> String { matches(education, title) ? "education" : matches(skills, title) ? "skills" : matches(experience, title) ? "experience" : "other" }
        func body(_ type: String) -> (count: Int, text: String) {
            let found = sections.filter { kind($0.title) == type }
            return (found.count, found.map(\.body).joined(separator: "\n"))
        }
        let name = h1.count == 1 ? h1[0] : ""
        let sample = name == "张三"
        let mail = all(email, markdown).first ?? ""
        let phoneNumbers = phones(markdown)
        let work = body("experience"), school = body("education"), skill = body("skills")
        let position = preamble.components(separatedBy: "\n").filter { line in
            let text = visible(line)
            return !text.isEmpty && !matches(email, text) && phones(text).isEmpty
                && !matches(regex("(?:https?://|www\\.|\\b[A-Z0-9.-]+\\.(?:com|cn|net|org)\\b)"), text)
                && !matches(regex("^(?:电话|手机|邮箱|博客|主页|地址|微信)\\s*[:：]"), text)
        }.map(visible).joined()
        let workIdentity = meaningfulIdentity(work.text), workDate = matches(date, visible(work.text))
        let schoolIdentity = meaningfulIdentity(school.text), schoolDate = matches(date, visible(school.text))
        let details = work.text.components(separatedBy: "\n").filter { matches(listItem, $0) }.count
        let entries = skillEntries(skill.text)
        let qualityCount = entries.filter(quality).count
        let tier = { (count: Int) in count >= 3 ? 4 : count == 2 ? 3 : count == 1 ? 2 : 0 }
        let checks = [
            Check(id: "name", label: "姓名", earned: !name.isEmpty && !sample ? 8 : 0, max: 8),
            Check(id: "phone", label: "联系电话", earned: phoneNumbers.contains { $0 != "13800000000" } ? 6 : 0, max: 6),
            Check(id: "email", label: "联系邮箱", earned: !mail.isEmpty && !matches(regex("@example\\.(?:com|org|net)$"), mail) ? 6 : 0, max: 6),
            Check(id: "positioning", label: "职业定位", earned: position.count >= 10 ? 10 : position.isEmpty ? 0 : 5, max: 10),
            Check(id: "experience-section", label: "经历章节", earned: work.count > 0 && !visible(work.text).isEmpty ? 10 : 0, max: 10),
            Check(id: "experience-basics", label: "经历基本信息", earned: workIdentity && workDate ? 10 : workIdentity || workDate ? 5 : 0, max: 10),
            Check(id: "experience-details", label: "经历成果描述", earned: details >= 3 ? 15 : details == 2 ? 10 : details == 1 ? 5 : 0, max: 15),
            Check(id: "education-section", label: "教育章节", earned: school.count > 0 && !visible(school.text).isEmpty ? 8 : 0, max: 8),
            Check(id: "education-basics", label: "教育基本信息", earned: schoolIdentity && schoolDate ? 7 : schoolIdentity || schoolDate ? 3 : 0, max: 7),
            Check(id: "skills-section", label: "技能内容", earned: entries.count >= 2 ? 7 : entries.count == 1 ? 4 : 0, max: 7),
            Check(id: "skills-entries", label: "技能条目质量", earned: tier(entries.count) + tier(qualityCount), max: 8),
            Check(id: "structure", label: "文档结构", earned: (h1.count == 1 && !name.isEmpty ? 2 : 0) + (h2.count >= 3 ? 3 : 0), max: 5),
        ]
        var score = min(100, checks.reduce(0) { $0 + $1.earned })
        if sample { score = min(score, 20) }
        if ["示例大学", "星河云科技有限公司", "青舟数据服务有限公司", "TaskFlow Lite"].contains(where: markdown.contains) { score = min(score, 60) }
        return ResumeCompleteness(score: score, checks: checks)
    }
}
