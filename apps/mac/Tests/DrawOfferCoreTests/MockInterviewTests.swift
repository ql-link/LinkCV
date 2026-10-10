import Foundation
import Testing
@testable import DrawOfferCore

@Test func textInterviewSurfaceRejectsSpeechTraversalAndDatasetWrites() {
    let base = "/api/mock-interviews/01234567-89ab-4cde-8fab-0123456789ab"
    for command in ["answers", "skip", "reply:retry", "finish", "abandon", "retry", "repeat"] {
        #expect(CareerRequest.allowed(path: base + "/" + command, method: "POST"))
    }
    #expect(CareerRequest.allowed(path: base, method: "DELETE"))
    for path in [base + "/speech", base + "/transcripts", base + "/../repeat", base + "/", base.uppercased(), "/api/mock-interviews/speech-capability"] {
        #expect(!CareerRequest.allowed(path: path, method: "POST"))
    }
    #expect(CareerRequest.allowed(path: "/api/datasets", method: "GET"))
    // Voice interview surface.
    #expect(MockInterviewRequest.allowed(path: "/api/mock-interviews/speech-capability", method: "GET"))
    #expect(MockInterviewRequest.audio(path: base + "/speech/playback", method: "POST"))
    #expect(MockInterviewRequest.audio(path: base + "/questions/12/recording", method: "GET"))
    #expect(MockInterviewRequest.allowed(path: base + "/questions/12/transcript", method: "PUT"))
    #expect(MockInterviewRequest.allowed(path: base + "/recordings", method: "DELETE"))
    #expect(!MockInterviewRequest.allowed(path: base + "/questions/x/recording", method: "GET"))
    #expect(!MockInterviewRequest.allowed(path: base + "/questions/12/recording", method: "DELETE"))
    #expect(!MockInterviewRequest.allowed(path: "/api/datasets", method: "POST"))
    #expect(!MockInterviewRequest.allowed(path: "/api/datasets/1", method: "GET"))
}
@Test func interviewEventsHandleReplayMultilineAndFailure() throws {
    let replay = Data("event: answer.accepted\r\ndata: {\r\ndata: \"question_id\":\"1\"}\r\n\r\n".utf8)
    let result = try MockInterviewRequest.decodeEvents(replay)
    #expect(result["events"]?.items.first?["data"]?.text("question_id") == "1")
    #expect(throws: APIError.server(status: 502, code: "TURN_FAILED")) {
        try MockInterviewRequest.decodeEvents(Data("event: interviewer.failed\ndata: {\"error\":\"TURN_FAILED\"}\n\n".utf8))
    }
    #expect(throws: (any Error).self) { try MockInterviewRequest.decodeEvents(Data(": heartbeat\n\n".utf8)) }
    #expect(throws: (any Error).self) { try MockInterviewRequest.decodeEvents(Data(repeating: 32, count: MockInterviewRequest.maximumTurnBytes + 1)) }
    #expect(throws: (any Error).self) { try MockInterviewRequest.decodeEvents(Data([0xff])) }
}
@Test func currentQuestionRequiresPendingAndStatusIsDurable() {
    let item = MockInterview(.object(["current_question_id":.string("2"),"status":.string("evaluation_failed"),"questions":.array([.object(["id":.string("2"),"answer_status":.string("answered")])])]))
    #expect(item.current == nil)
    #expect(!item.active)
    #expect(item.label == "评估失败")
}
