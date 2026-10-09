import Foundation
import PDFKit

let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [[String: Any]]
for item in cases {
    let path = item["path"] as! String
    guard let document = PDFDocument(url: URL(fileURLWithPath: path)), document.pageCount > 0 else { fatalError("Invalid PDF: \(path)") }
    let text = (document.string ?? "").filter { !$0.isWhitespace }
    for phrase in item["phrases"] as! [String] {
        guard text.contains(phrase.filter { !$0.isWhitespace }) else { fatalError("PDF missing content: \(phrase)") }
    }
    if item["long"] as? Bool == true && document.pageCount < 2 { fatalError("Long document did not paginate") }
    print("PDF \(URL(fileURLWithPath: path).lastPathComponent): text preserved, \(document.pageCount) pages")
}
