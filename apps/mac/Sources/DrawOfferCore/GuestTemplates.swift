import Foundation

/// Public, fictional examples bundled with the client. Never reads a session or calls HTTP.
public enum GuestTemplates {
    public static func load() throws -> [ResumeTemplate] {
        guard let url = Bundle.module.url(forResource: "resume-templates", withExtension: "json") else {
            throw APIError.invalidResponse
        }
        struct Envelope: Decodable { let templates: [ResumeTemplate] }
        return try JSONDecoder().decode(Envelope.self, from: Data(contentsOf: url)).templates
    }

    public static func prepare(_ template: ResumeTemplate) async throws -> PaperPreparation {
        try await PaperAssets.prepare(template.renderRequest(), account: "") { _, _ in
            throw APIError.invalidResponse
        }
    }
}
