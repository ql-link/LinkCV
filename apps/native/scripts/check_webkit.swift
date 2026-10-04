import AppKit
import Foundation
import WebKit

// Run the packaged HTML in the real macOS engine, using the same requests as Chromium.
@MainActor
final class PaperCheck: NSObject, WKScriptMessageHandler {
    let cases: [[String: Any]]
    let webView: WKWebView
    let window: NSWindow
    var index = 0
    var finished = false
    var failed = false
    let snapshot = """
    (() => {
      const root = document.querySelector('[data-resume-print-document]');
      return {text: root.textContent, theme: root.className,
        headings: Array.from(root.querySelectorAll('h1,h2,h3'), el => el.textContent),
        anchors: Array.from(root.querySelectorAll('[data-resume-block-id]'), el => el.dataset.resumeBlockId),
        colors: Array.from(root.querySelectorAll('h1,h2,.resume-print-content'), el => {
          const style = getComputedStyle(el); return [style.color, style.backgroundColor, style.display];
        }),
        imagesReady: Array.from(root.querySelectorAll('img')).every(image => image.complete && image.naturalWidth > 0),
        height: root.getBoundingClientRect().height};
    })()
    """

    init(cases: [[String: Any]], url: URL) {
        self.cases = cases
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 794, height: 1123), configuration: configuration)
        window = NSWindow(contentRect: webView.frame, styleMask: [], backing: .buffered, defer: false)
        super.init()
        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        configuration.userContentController.add(self, name: "linkresume")
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    func fail(_ message: String) {
        print("FAIL: \(message)")
        failed = true
        finished = true
    }

    func next() {
        guard index < cases.count else { finished = true; return }
        do {
            let data = try JSONSerialization.data(withJSONObject: cases[index]["request"]!)
            let json = String(decoding: data, as: UTF8.self)
            webView.evaluateJavaScript("window.linkresume.render(\(json))") { _, error in
                if let error { self.fail(error.localizedDescription) }
            }
        } catch { fail(error.localizedDescription) }
    }

    nonisolated func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        MainActor.assumeIsolated {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            if type == "ready" { next() }
            if type == "error" { fail("renderer rejected case \(index)") }
            if type == "rendered" {
                webView.evaluateJavaScript(snapshot) { value, error in
                    guard error == nil, let actual = value as? [String: Any], let expected = self.cases[self.index]["expected"] as? [String: Any] else {
                        self.fail("WebKit snapshot unavailable"); return
                    }
                    for key in ["text", "theme", "headings", "anchors", "colors"] {
                        guard let lhs = actual[key] as? NSObject, let rhs = expected[key] as? NSObject, lhs.isEqual(rhs) else {
                            self.fail("case \(self.index): \(key) differs from shared Chromium document"); return
                        }
                    }
                    guard actual["imagesReady"] as? Bool == true else { self.fail("missing image"); return }
                    if let request = self.cases[self.index]["request"] as? [String: Any], request["title"] as? String == "长正文滚动边界" {
                        guard (actual["height"] as? Double ?? 0) > 1123 else { self.fail("long content clipped"); return }
                    }
                    print("WebKit case \(self.index + 1): content, order, theme, colors, images passed")
                    self.index += 1
                    self.next()
                }
            }
        }
    }
}

@main
struct CheckWebKit {
    @MainActor static func main() throws {
        _ = NSApplication.shared
        NSApplication.shared.setActivationPolicy(.accessory)
        NSApplication.shared.finishLaunching()
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        let cases = try JSONSerialization.jsonObject(with: data) as! [[String: Any]]
        let runner = PaperCheck(cases: cases, url: URL(fileURLWithPath: CommandLine.arguments[2]))
        let deadline = Date().addingTimeInterval(60)
        while !runner.finished && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.05)) }
        if !runner.finished { runner.fail("WebKit timed out") }
        runner.webView.configuration.userContentController.removeScriptMessageHandler(forName: "linkresume")
        runner.window.close()
        exit(runner.failed ? 1 : 0)
    }
}
