import Foundation
import Testing
@testable import DrawOfferCore

private func json(_ source: String) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: Data(source.utf8))
}

private let twoColumnStyle = """
{"schema_version":"resume-presentation.v1","portable":{"smart_one_page":false},"template_scoped":{},
 "template_snapshot":{"template_key":"fixture-two","regions":[{"region_id":"side","region_kind":"sidebar","order":1},{"region_id":"main","region_kind":"main","order":2}],
  "slots":[{"slot_id":"s-identity","region_id":"side","accepts":["identity","skills"],"universal_fallback":false,"order":1},
           {"slot_id":"s-rest","region_id":"main","accepts":["identity","profile","work","education","project","skills","activity","interests","certificates","awards","languages","custom"],"universal_fallback":true,"order":2}],
  "tokens":{"font_family":"source-han-serif","font_size_pt":10,"line_height":1.5,"accent_color":"#2F4858","page_margin_mm":16}}}
"""

private let document = """
{"identity":{"node_id":"node_identity"},"sections":[
 {"node_id":"node_work","semantic_kind":"work"},{"node_id":"node_skills","semantic_kind":"skills"},{"node_id":"node_profile","semantic_kind":"profile"}]}
"""

@Test func localLayoutPlanRoutesEachTopLevelNodeOnce() throws {
    let plan = try #require(ResumeLayout.compile(data: try json(document), style: try json(twoColumnStyle), contentHash: "sha256:x"))
    let regions = plan["regions"]?.items ?? []
    #expect(regions.map { $0.text("region_id") } == ["side", "main"])
    #expect(regions[0]["nodes"]?.items.map { $0.text("node_id") } == ["node_identity", "node_skills"])
    #expect(regions[1]["nodes"]?.items.map { $0.text("node_id") } == ["node_work", "node_profile"])
    #expect(ResumeLayout.columns(data: try json(document), style: try json(twoColumnStyle))["node_skills"] == "sidebar")
}

@Test func typeSettingsRoundTripThroughPresentation() throws {
    let style = try json(twoColumnStyle)
    var settings = try #require(ResumeTypeSettings.read(style))
    #expect(settings.fontSize == 10 && settings.pageMargin == 16 && settings.fontFamily == ResumeTypeSettings.serifStack)
    settings.fontSize = 11; settings.pageMargin = 20; settings.smartOnePage = true
    let next = settings.apply(to: style)
    #expect(next["template_scoped"]?["fixture-two"]?["font_scale"]?.numberValue == 1.1)
    #expect(next["template_scoped"]?["fixture-two"]?["page_margin_left_mm"]?.numberValue == 20)
    #expect(next["template_scoped"]?["fixture-two"]?["page_margin_top_mm"] == nil)
    #expect(next["template_scoped"]?["fixture-two"]?["font_family"]?.stringValue == "source-han-serif")
    #expect(ResumeTypeSettings.read(next) == settings)
    #expect(ResumeTypeSettings.step(1.5, by: 1, min: 1.1, max: 1.8, step: 0.05) == 1.55)
}

@Test func textRunsKeepValueInSyncAndDropPlainRuns() throws {
    let bold = ResumeDocument.textRun("张", marks: ["bold"])
    let plain = ResumeDocument.textRun("三")
    let value = try #require(ResumeDocument.setTextRuns(nil, [bold, plain, ResumeDocument.textRun("")]))
    #expect(value.text("value") == "张三")
    #expect(value["runs"]?.items.count == 2)
    let flattened = try #require(ResumeDocument.setTextRuns(value, [ResumeDocument.textRun("张"), ResumeDocument.textRun("三")]))
    #expect(flattened.text("value") == "张三" && flattened["runs"] == nil && flattened.text("node_id") == value.text("node_id"))
    #expect(ResumeDocument.setTextRuns(value, []) == nil)
    let merged = ResumeDocument.normalizeRuns([plain, plain, .object(["inline_type": .string("icon"), "name": .string("Mail")]), plain])
    #expect(merged.count == 3 && merged[0].text("text") == "三三")
}

@Test func sectionOrderRestoresCanonicalKinds() throws {
    let sections = try json(document)["sections"]?.items ?? []
    #expect(ResumeSectionOrder.restoreDefault(sections).map { $0.text("node_id") } == ["node_profile", "node_work", "node_skills"])
}

@Test func newBlocksMatchCanonicalShapes() {
    let pair = ResumeDocument.newRow(kind: "pair")
    #expect(pair["cells"]?.items.count == 2 && pair["left_width_percent"]?.numberValue == 50)
    #expect(ResumeDocument.newRow(kind: "meta")["left_width_percent"] == .null)
    #expect(ResumeDocument.newImage(src: "/api/resumes/1/assets/a.png", alt: nil)["width_unit"]?.stringValue == "%")
    #expect(ResumeDocument.validImageSource("/api/resumes/1/assets/a.png"))
    #expect(!ResumeDocument.validImageSource("file:///tmp/a.png"))
    let avatar = ResumeDocument.avatar(nil, src: "/api/resumes/1/assets/a.png")
    #expect(avatar["width"]?.numberValue == 96 && avatar["align"] == .null && avatar.text("media_kind") == "avatar")
}
