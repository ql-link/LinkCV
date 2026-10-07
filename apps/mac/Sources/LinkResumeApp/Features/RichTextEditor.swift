import AppKit
import LinkResumeCore
import SwiftUI

/// 简历正文的原生富文本编辑：NSTextView 与 canonical runs 双向转换。
/// 格式的“真值”存放在自定义属性里（marks、链接、颜色、高亮、字号），显示属性每次由它们重新计算；
/// 图标与行内图片以附件字符保留原始 JSON，往返不丢失。粘贴一律按纯文本，避免带入无法保存的样式。
extension NSAttributedString.Key {
    static let lrMarks = NSAttributedString.Key("linkresume.marks")
    static let lrHref = NSAttributedString.Key("linkresume.href")
    static let lrColor = NSAttributedString.Key("linkresume.color")
    static let lrHighlight = NSAttributedString.Key("linkresume.highlight")
    static let lrSize = NSAttributedString.Key("linkresume.size")
    static let lrInline = NSAttributedString.Key("linkresume.inline")
}

@MainActor
enum RichRuns {
    static let baseSize: CGFloat = 13
    static let semanticKeys: [NSAttributedString.Key] = [.lrMarks, .lrHref, .lrColor, .lrHighlight, .lrSize]
    static let markOrder = ["bold", "italic", "underline", "strike", "code"]

    static func marks(_ value: Any?) -> Set<String> {
        Set(((value as? String) ?? "").split(separator: ",").map(String.init).filter { !$0.isEmpty })
    }

    static func encode(_ marks: Set<String>) -> String? {
        let ordered = markOrder.filter(marks.contains)
        return ordered.isEmpty ? nil : ordered.joined(separator: ",")
    }

    /// 由语义属性计算显示属性。
    static func display(_ attributes: [NSAttributedString.Key: Any]) -> [NSAttributedString.Key: Any] {
        let marks = marks(attributes[.lrMarks])
        let size = (attributes[.lrSize] as? NSNumber).map { min(40, max(9, CGFloat($0.doubleValue) * 1.25)) } ?? baseSize
        var font = marks.contains("code") ? NSFont.monospacedSystemFont(ofSize: size, weight: .regular) : NSFont.systemFont(ofSize: size)
        if marks.contains("bold") { font = NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) }
        if marks.contains("italic") { font = NSFontManager.shared.convert(font, toHaveTrait: .italicFontMask) }
        var result: [NSAttributedString.Key: Any] = [.font: font]
        result[.foregroundColor] = (attributes[.lrColor] as? String).flatMap(NSColor.init(hex:)) ?? (attributes[.lrHref] != nil ? NSColor.linkColor : NSColor.labelColor)
        if let highlight = (attributes[.lrHighlight] as? String).flatMap(NSColor.init(hex:)) { result[.backgroundColor] = highlight }
        if marks.contains("underline") || attributes[.lrHref] != nil { result[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        if marks.contains("strike") { result[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        if marks.contains("code") { result[.backgroundColor] = result[.backgroundColor] ?? NSColor.quaternaryLabelColor }
        return result
    }

    static func attributed(_ runs: [JSONValue]) -> NSAttributedString {
        let result = NSMutableAttributedString()
        for run in runs {
            switch run.text("inline_type") {
            case "text":
                var semantic: [NSAttributedString.Key: Any] = [:]
                let marks = Set((run["marks"]?.items ?? []).compactMap(\.stringValue))
                if let encoded = encode(marks) { semantic[.lrMarks] = encoded }
                if let href = run["href"]?.stringValue { semantic[.lrHref] = href }
                if let color = run["style"]?["color"]?.stringValue { semantic[.lrColor] = color }
                if let highlight = run["style"]?["highlight_color"]?.stringValue { semantic[.lrHighlight] = highlight }
                if let size = run["style"]?["font_size_pt"]?.numberValue { semantic[.lrSize] = NSNumber(value: size) }
                result.append(NSAttributedString(string: run.text("text"), attributes: semantic.merging(display(semantic)) { $1 }))
            default:
                result.append(inlineAttachment(run))
            }
        }
        return result
    }

    static func inlineAttachment(_ run: JSONValue) -> NSAttributedString {
        let attachment = NSTextAttachment()
        let symbol = run.text("inline_type") == "icon" ? iconSymbol(run.text("name")) : "photo"
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: run.text("name"))?
            .withSymbolConfiguration(.init(pointSize: baseSize - 1, weight: .regular))
        attachment.image = image
        if let size = image?.size { attachment.bounds = CGRect(x: 0, y: -2, width: size.width, height: size.height) }
        let string = NSMutableAttributedString(attachment: attachment)
        let json = (try? JSONEncoder().encode(run)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        string.addAttributes([.lrInline: json, .font: NSFont.systemFont(ofSize: baseSize), .foregroundColor: NSColor.secondaryLabelColor],
                             range: NSRange(location: 0, length: string.length))
        return string
    }

    static func iconSymbol(_ name: String) -> String {
        [
            "Mail": "envelope", "Phone": "phone", "MapPin": "mappin.and.ellipse", "Globe": "globe",
            "Github": "chevron.left.forwardslash.chevron.right", "Linkedin": "person.crop.square", "GraduationCap": "graduationcap",
            "Briefcase": "briefcase", "Award": "rosette", "Star": "star", "Calendar": "calendar", "Code2": "curlybraces",
        ][name] ?? "questionmark.square"
    }

    static func runs(_ string: NSAttributedString) -> [JSONValue] {
        var result: [JSONValue] = []
        let full = NSRange(location: 0, length: string.length)
        let text = string.string as NSString
        string.enumerateAttributes(in: full) { attributes, range, _ in
            if let json = attributes[.lrInline] as? String, attributes[.attachment] != nil {
                if let data = json.data(using: .utf8), let run = try? JSONDecoder().decode(JSONValue.self, from: data) {
                    for _ in 0..<range.length { result.append(run) }
                }
                return
            }
            let piece = text.substring(with: range).replacingOccurrences(of: "\u{FFFC}", with: "")
            guard !piece.isEmpty else { return }
            result.append(ResumeDocument.textRun(
                piece, marks: markOrder.filter(marks(attributes[.lrMarks]).contains),
                href: attributes[.lrHref] as? String, color: attributes[.lrColor] as? String,
                highlight: attributes[.lrHighlight] as? String, size: (attributes[.lrSize] as? NSNumber)?.doubleValue))
        }
        return ResumeDocument.normalizeRuns(result)
    }
}

extension NSColor {
    convenience init?(hex: String) {
        guard hex.count == 7, hex.hasPrefix("#"), let value = Int(hex.dropFirst(), radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255, blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }
}

// MARK: - Controller shared by the toolbar and every field

/// 当前获得焦点的富文本框与选区格式。格式工具条通过它作用于选区（无选区时作用于接下来输入的文字）。
@MainActor @Observable
final class RichTextController {
    struct Selection: Equatable {
        var marks: Set<String> = []
        var href: String?
        var color: String?
        var highlight: String?
        var size: Double?
        var hasRange = false
        var allowsInline = false
    }

    static let textColors = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#3478f6", "#af52de", "#8a8a8e"]
    static let highlightColors = ["#fff3c4", "#d1f5db", "#dbe8ff", "#ffe0d1", "#f3e3ff", "#f0f0f0", "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#3478f6", "#af52de", "#8a8a8e"]
    static let sizeRange = (min: 6.0, max: 48.0, step: 0.5)

    @ObservationIgnored weak var textView: RichNSTextView?
    private(set) var active = false
    private(set) var selection = Selection()

    func focus(_ view: RichNSTextView) { textView = view; active = true; refresh() }

    /// 失焦后仍以最后编辑的文本框为目标：点工具条、打开链接弹层都会让文本框暂时失焦，选区仍保留。
    func blur(_ view: RichNSTextView) {
        guard textView === view else { return }
        active = view.window != nil
    }

    func detach(_ view: RichNSTextView) {
        guard textView === view else { return }
        textView = nil; active = false; selection = Selection()
    }

    func refresh() {
        guard let view = textView else { selection = Selection(); return }
        let range = view.selectedRange()
        var attributes = view.typingAttributes
        if range.length > 0, let storage = view.textStorage, range.location < storage.length {
            attributes = storage.attributes(at: range.location, effectiveRange: nil)
        }
        selection = Selection(
            marks: RichRuns.marks(attributes[.lrMarks]), href: attributes[.lrHref] as? String,
            color: attributes[.lrColor] as? String, highlight: attributes[.lrHighlight] as? String,
            size: (attributes[.lrSize] as? NSNumber)?.doubleValue, hasRange: range.length > 0, allowsInline: view.allowsInline)
    }

    func toggle(_ mark: String) {
        let enable = !selection.marks.contains(mark)
        edit { attributes in
            var marks = RichRuns.marks(attributes[.lrMarks])
            if enable { marks.insert(mark) } else { marks.remove(mark) }
            attributes[.lrMarks] = RichRuns.encode(marks)
        }
    }

    func setLink(_ href: String?) { edit { $0[.lrHref] = href } }
    func setColor(_ color: String?) { edit { $0[.lrColor] = color } }
    func setHighlight(_ color: String?) { edit { $0[.lrHighlight] = color } }

    func adjustSize(_ direction: Double) {
        let current = selection.size ?? 12
        let next = min(Self.sizeRange.max, max(Self.sizeRange.min, ((current + direction * Self.sizeRange.step) * 2).rounded() / 2))
        edit { $0[.lrSize] = NSNumber(value: next) }
    }

    func clearSize() { edit { $0[.lrSize] = nil } }

    func clearFormatting() { edit { attributes in RichRuns.semanticKeys.forEach { attributes[$0] = nil } } }

    func insertIcon(_ name: String) {
        guard let view = textView, view.allowsInline else { return }
        let icon: JSONValue = .object(["inline_type": .string("icon"), "name": .string(name)])
        view.insertText(RichRuns.inlineAttachment(icon), replacementRange: view.selectedRange())
        view.window?.makeFirstResponder(view)
    }

    /// 改写选区内每段文字的语义属性；无选区时改写输入属性。
    private func edit(_ change: (inout [NSAttributedString.Key: Any]) -> Void) {
        guard let view = textView, let storage = view.textStorage else { return }
        let range = view.selectedRange()
        func apply(_ attributes: [NSAttributedString.Key: Any]) -> [NSAttributedString.Key: Any] {
            var semantic: [NSAttributedString.Key: Any] = [:]
            for key in RichRuns.semanticKeys { if let value = attributes[key] { semantic[key] = value } }
            change(&semantic)
            return semantic.merging(RichRuns.display(semantic)) { $1 }
        }
        if range.length == 0 {
            view.typingAttributes = apply(view.typingAttributes)
            refresh()
            return
        }
        guard view.shouldChangeText(in: range, replacementString: nil) else { return }
        storage.beginEditing()
        storage.enumerateAttributes(in: range) { attributes, subrange, _ in
            guard attributes[.lrInline] == nil else { return }
            storage.setAttributes(apply(attributes), range: subrange)
        }
        storage.endEditing()
        view.didChangeText()
        view.window?.makeFirstResponder(view)
        refresh()
    }
}

// MARK: - NSTextView

final class RichNSTextView: NSTextView {
    var placeholder = ""
    var singleLine = false
    var allowsInline = false
    var onReturn: (() -> Void)?
    weak var controller: RichTextController?

    override func paste(_ sender: Any?) { pasteAsPlainText(sender) }

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted { controller?.focus(self) }
        return accepted
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned { controller?.blur(self) }
        return resigned
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty, !placeholder.isEmpty else { return }
        let origin = NSPoint(x: textContainerInset.width + (textContainer?.lineFragmentPadding ?? 0), y: textContainerInset.height)
        (placeholder as NSString).draw(at: origin, withAttributes: [.font: NSFont.systemFont(ofSize: RichRuns.baseSize), .foregroundColor: NSColor.placeholderTextColor])
    }
}

/// SwiftUI 包装：`runs` 是 canonical inline 数组；高度随内容增长。
struct RichTextField: NSViewRepresentable {
    @Binding var runs: [JSONValue]
    var placeholder = ""
    var singleLine = false
    /// 段落与列表项允许图标、行内图片；textValue 字段只允许文字。
    var allowsInline = false
    var minHeight: CGFloat = 26
    var onReturn: (() -> Void)?
    let controller: RichTextController

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> RichNSTextView {
        let view = RichNSTextView(usingTextLayoutManager: false)
        view.delegate = context.coordinator
        view.isRichText = true
        view.importsGraphics = false
        view.allowsUndo = true
        view.usesFontPanel = false
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticTextReplacementEnabled = false
        view.drawsBackground = false
        view.textContainerInset = NSSize(width: 4, height: 5)
        view.isVerticallyResizable = true
        view.isHorizontallyResizable = false
        view.textContainer?.widthTracksTextView = true
        view.typingAttributes = RichRuns.display([:])
        configure(view, context: context)
        view.textStorage?.setAttributedString(RichRuns.attributed(runs))
        context.coordinator.last = runs
        return view
    }

    func updateNSView(_ view: RichNSTextView, context: Context) {
        context.coordinator.parent = self
        configure(view, context: context)
        guard runs != context.coordinator.last else { return }
        let selection = view.selectedRange()
        view.textStorage?.setAttributedString(RichRuns.attributed(runs))
        context.coordinator.last = runs
        let length = view.textStorage?.length ?? 0
        view.setSelectedRange(NSRange(location: min(selection.location, length), length: 0))
    }

    private func configure(_ view: RichNSTextView, context: Context) {
        view.placeholder = placeholder
        view.singleLine = singleLine
        view.allowsInline = allowsInline
        view.onReturn = onReturn
        view.controller = controller
    }

    static func dismantleNSView(_ view: RichNSTextView, coordinator: Coordinator) {
        view.controller?.detach(view)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView view: RichNSTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 320
        guard let container = view.textContainer, let layout = view.layoutManager else { return CGSize(width: width, height: minHeight) }
        container.containerSize = NSSize(width: max(40, width - view.textContainerInset.width * 2), height: .greatestFiniteMagnitude)
        layout.ensureLayout(for: container)
        let height = layout.usedRect(for: container).height + view.textContainerInset.height * 2
        return CGSize(width: width, height: max(minHeight, ceil(height)))
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: RichTextField
        var last: [JSONValue] = []

        init(_ parent: RichTextField) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? RichNSTextView, let storage = view.textStorage else { return }
            let next = RichRuns.runs(storage)
            last = next
            parent.runs = next
            view.invalidateIntrinsicContentSize()
            parent.controller.refresh()
        }

        func textViewDidChangeSelection(_ notification: Notification) {
            guard let view = notification.object as? RichNSTextView else { return }
            // 附件属性不能沿用到新输入的文字上
            view.typingAttributes[.lrInline] = nil
            view.typingAttributes[.attachment] = nil
            if parent.controller.textView === view { parent.controller.refresh() }
        }

        func textView(_ textView: NSTextView, shouldChangeTextIn range: NSRange, replacementString: String?) -> Bool {
            guard let view = textView as? RichNSTextView, view.singleLine, let replacementString, replacementString.contains(where: \.isNewline) else { return true }
            let flattened = replacementString.components(separatedBy: .newlines).joined(separator: " ")
            view.insertText(flattened, replacementRange: range)
            return false
        }

        func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            guard let view = textView as? RichNSTextView else { return false }
            if selector == #selector(NSResponder.insertNewline(_:)) {
                if let onReturn = view.onReturn { onReturn(); return true }
                return view.singleLine
            }
            return false
        }
    }
}

// MARK: - Toolbar

/// 选区格式工具条（Web `WorkbenchToolbar` 的选区工具）：加粗、斜体、下划线、删除线、代码、
/// 字号、文字颜色、背景色、链接、图标与清除格式。
struct RichTextToolbar: View {
    let controller: RichTextController
    @State private var linkDraft = ""
    @State private var editingLink = false

    var body: some View {
        let selection = controller.selection
        HStack(spacing: 4) {
            markButton("bold", "bold", "加粗", key: "b")
            markButton("italic", "italic", "斜体", key: "i")
            markButton("underline", "underline", "下划线", key: "u")
            markButton("strike", "strikethrough", "删除线")
            markButton("code", "chevron.left.forwardslash.chevron.right", "代码")
            Divider().frame(height: 16)
            Button { controller.adjustSize(-1) } label: { Image(systemName: "textformat.size.smaller") }.help("减小字号").disabled(!selection.hasRange)
            Text(selection.size.map { "\(String(format: $0.truncatingRemainder(dividingBy: 1) == 0 ? "%.0f" : "%.1f", $0))pt" } ?? "默认")
                .font(V3.number(11.5)).foregroundStyle(V3.sub).frame(minWidth: 40)
                .contextMenu { Button("恢复默认字号") { controller.clearSize() } }
            Button { controller.adjustSize(1) } label: { Image(systemName: "textformat.size.larger") }.help("增大字号").disabled(!selection.hasRange)
            Divider().frame(height: 16)
            colorMenu("文字颜色", systemImage: "character", colors: RichTextController.textColors, current: selection.color) { controller.setColor($0) }
            colorMenu("背景颜色", systemImage: "highlighter", colors: RichTextController.highlightColors, current: selection.highlight) { controller.setHighlight($0) }
            Button { linkDraft = selection.href ?? "https://"; editingLink = true } label: { Image(systemName: "link") }
                .help(selection.href == nil ? "添加链接" : "编辑链接").foregroundStyle(selection.href == nil ? V3.txt : V3.blue)
                .popover(isPresented: $editingLink) { linkEditor }
            Menu {
                ForEach(ResumeDocument.iconNames, id: \.self) { name in
                    Button { controller.insertIcon(name) } label: { Label(name, systemImage: RichRuns.iconSymbol(name)) }
                }
            } label: { Image(systemName: "star.square") }.menuIndicator(.hidden).fixedSize().help("插入图标").disabled(!selection.allowsInline)
            Button { controller.clearFormatting() } label: { Image(systemName: "eraser") }.help("清除格式")
        }
        .buttonStyle(.borderless).font(.system(size: 13)).disabled(!controller.active)
        .opacity(controller.active ? 1 : 0.45)
    }

    private func markButton(_ mark: String, _ symbol: String, _ label: String, key: KeyEquivalent? = nil) -> some View {
        let on = controller.selection.marks.contains(mark)
        let button = Button { controller.toggle(mark) } label: {
            Image(systemName: symbol).frame(width: 22, height: 22)
                .background(on ? V3.blue.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 5))
        }.help(label).accessibilityLabel(label).accessibilityAddTraits(on ? .isSelected : [])
        return Group { if let key { button.keyboardShortcut(key, modifiers: .command) } else { button } }
    }

    private func colorMenu(_ title: String, systemImage: String, colors: [String], current: String?, set: @escaping (String?) -> Void) -> some View {
        Menu {
            Button("无") { set(nil) }
            ForEach(colors, id: \.self) { hex in
                Button { set(hex) } label: {
                    Label { Text(hex) } icon: { Image(nsImage: swatch(hex)) }
                }
            }
        } label: {
            Image(systemName: systemImage).foregroundStyle(current.flatMap(NSColor.init(hex:)).map(Color.init(nsColor:)) ?? V3.txt)
        }.menuIndicator(.hidden).fixedSize().help(title)
    }

    private func swatch(_ hex: String) -> NSImage {
        NSImage(size: NSSize(width: 12, height: 12), flipped: false) { rect in
            (NSColor(hex: hex) ?? .clear).setFill()
            NSBezierPath(roundedRect: rect, xRadius: 3, yRadius: 3).fill()
            return true
        }
    }

    private var linkEditor: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("链接地址").font(V3.sans(12.5, weight: .medium))
            TextField("https://", text: $linkDraft).textFieldStyle(.roundedBorder).frame(width: 260)
            let valid = linkDraft.range(of: #"^https?://\S{1,2040}$"#, options: .regularExpression) != nil
            HStack {
                if controller.selection.href != nil { Button("移除链接", role: .destructive) { controller.setLink(nil); editingLink = false } }
                Spacer()
                Button("取消") { editingLink = false }
                Button("应用") { controller.setLink(linkDraft); editingLink = false }.disabled(!valid).keyboardShortcut(.defaultAction)
            }
            if !valid && !linkDraft.isEmpty { Text("只支持 http:// 或 https:// 开头的地址").font(V3.sans(11)).foregroundStyle(V3.red) }
        }.padding(14)
    }
}
