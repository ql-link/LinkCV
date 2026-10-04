import Foundation
import ImageIO

public struct PaperPreparation: Sendable {
    public let request: ResumeRenderRequest
    public let missingImageCount: Int
}

struct DesktopImage: Sendable {
    let data: Data
    let contentType: String
}

// No global/disk cache. These bytes live only in the current prepared request.
enum PaperAssets {
    static let maximumBytes = 10 * 1024 * 1024
    static let maximumImages = 32
    static let placeholder = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4c+bMfwAIMANkhLK+mwAAAABJRU5ErkJggg=="
    static let bundled = Set(["avatar-administrative.png", "avatar-administrative.svg", "avatar-campus.png", "avatar-campus.svg", "avatar-cat.jpg", "avatar-civic.png", "avatar-civic.svg", "avatar-creative.png", "avatar-creative.svg"].map { "/templates/" + $0 })

    static func sources(_ value: JSONValue) -> Set<String> {
        switch value {
        case .object(let fields):
            var found = Set<String>()
            if fields["media_kind"]?.stringValue != nil, let source = fields["src"]?.stringValue { found.insert(source) }
            for field in fields.values { found.formUnion(sources(field)) }
            return found
        case .array(let values): return values.reduce(into: Set<String>()) { $0.formUnion(sources($1)) }
        default: return []
        }
    }

    static func path(_ source: String, account: String) throws -> String {
        guard source.count <= 2048, !source.contains("?"), !source.contains("#"),
              let decoded = source.removingPercentEncoding, !decoded.contains("%"), !decoded.contains("\\"), !decoded.contains("..") else { throw APIError.invalidResponse }
        let parts = decoded.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        let file: String
        if parts.count == 6, parts[0] == "", parts[1] == "api", parts[2] == "resumes", parts[4] == "assets",
           parts[3].allSatisfy({ $0.isASCII && $0.isNumber }), !parts[3].isEmpty { file = parts[5] }
        else if parts.count == 7, parts[0] == "", parts[1] == "api", parts[2] == "assets", parts[3] == "users", parts[4] == account, parts[5] == "assets" { file = parts[6] }
        else if parts.count == 8, parts[0] == "", parts[1] == "api", parts[2] == "assets", parts[3] == "users", parts[4] == account, parts[5] == "assets", parts[6] == "avatar" { file = parts[7] }
        else { throw APIError.invalidResponse }
        guard !file.isEmpty, file.count <= 240, file.unicodeScalars.allSatisfy({ CharacterSet.alphanumerics.contains($0) || "._-".unicodeScalars.contains($0) }),
              ["png", "jpg", "jpeg"].contains((file as NSString).pathExtension.lowercased()) else { throw APIError.invalidResponse }
        return decoded
    }

    static func dataURL(_ image: DesktopImage, limit: Int) throws -> String {
        guard !image.data.isEmpty, image.data.count <= limit, ["image/png", "image/jpeg"].contains(image.contentType),
              let source = CGImageSourceCreateWithData(image.data as CFData, nil),
              let type = CGImageSourceGetType(source) as String?,
              type == (image.contentType == "image/png" ? "public.png" : "public.jpeg"),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
              let width = properties[kCGImagePropertyPixelWidth as String] as? Int,
              let height = properties[kCGImagePropertyPixelHeight as String] as? Int,
              width > 0, height > 0, width <= 40_000_000 / height else { throw APIError.invalidResponse }
        return "data:\(image.contentType);base64,\(image.data.base64EncodedString())"
    }

    static func prepare(_ request: ResumeRenderRequest, account: String,
                        download: @Sendable (String, Int) async throws -> DesktopImage) async throws -> PaperPreparation {
        let sources = sources(request.data).sorted()
        var assets = [String: String]()
        var remaining = maximumBytes
        var failures = 0
        var downloads = 0
        for source in sources where !bundled.contains(source) {
            try Task.checkCancellation()
            do {
                guard downloads < maximumImages, remaining > 0 else { throw APIError.invalidResponse }
                let path = try path(source, account: account)
                downloads += 1
                let image = try await download(path, remaining)
                assets[source] = try dataURL(image, limit: remaining)
                remaining -= image.data.count
            } catch is CancellationError { throw CancellationError() }
            catch APIError.unauthorized { throw APIError.unauthorized }
            catch { assets[source] = placeholder; failures += 1 }
        }
        return PaperPreparation(request: ResumeRenderRequest(title: request.title, data: request.data, style: request.style, layoutPlan: request.layoutPlan, assets: assets), missingImageCount: failures)
    }
}
