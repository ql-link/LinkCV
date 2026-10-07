import AppKit
@preconcurrency import AVFoundation
import LinkResumeCore
import SwiftUI

/// 实时语音作答（Web `SpeechRecognition` + `useMicrophone`）：AVAudioEngine 取麦克风，转换为 16 kHz 单声道 PCM16，
/// 约每 100ms 一帧经 `WS /api/mock-interviews/{id}/speech` 发送；停止时发 `{"type":"stop"}`，等待 `final` 取得一次性
/// `session_id`。握手超时 15 秒、停止后 30 秒没有最终稿按识别失败处理，发送积压超过 1 MB 主动放弃。录音不落盘。
@MainActor @Observable
final class VoiceRecorder {
    enum Phase: Equatable { case idle, connecting, recording, finishing, failed(String) }
    struct Final: Sendable { let sessionID: String; let text: String; let durationMs: Int }

    private(set) var phase: Phase = .idle
    private(set) var partial = ""
    private(set) var level: Float = 0
    private var engine: AVAudioEngine?
    private var socket: URLSessionWebSocketTask?
    private var receiver: Task<Void, Never>?
    private var finalWaiter: CheckedContinuation<Final, Error>?
    private var pendingBytes = 0
    private var earlyFinal: Final?

    nonisolated(unsafe) static let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)!

    func start(api: any APIClient, interviewID: String, questionID: String, purpose: String = "voice_answer") async {
        guard phase == .idle || { if case .failed = phase { return true }; return false }() else { return }
        partial = ""; earlyFinal = nil; phase = .connecting
        guard await Self.microphoneAllowed() else { phase = .failed("没有麦克风权限。请在“系统设置 › 隐私与安全性 › 麦克风”中允许 LinkResume。"); return }
        do {
            let socket = try await api.speechSocket(interviewID: interviewID, questionID: questionID, purpose: purpose)
            self.socket = socket
            socket.resume()
            receiver = Task { [weak self] in await self?.receive(socket) }
            try startEngine(socket)
            phase = .recording
        } catch {
            if case APIError.unauthorized = error { phase = .failed("登录已失效，请重新登录。") }
            else { phase = .failed("无法开始录音：\(error.localizedDescription)") }
            teardown()
        }
    }

    /// 停止录音并等待服务端最终识别稿（30 秒超时）。最终稿可能早于等待开始到达，因此先暂存。
    func stop() async throws -> Final {
        guard phase == .recording, let socket else { throw APIError.invalidResponse }
        phase = .finishing
        stopEngine()
        try await socket.send(.string("{\"type\":\"stop\"}"))
        if let early = earlyFinal { earlyFinal = nil; return early }
        let timeout = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled else { return }
            self?.fail("识别超时，请重新录音。")
        }
        defer { timeout.cancel() }
        return try await withCheckedThrowingContinuation { finalWaiter = $0 }
    }

    func cancel() {
        socket?.cancel(with: .goingAway, reason: nil)
        fail(nil)
    }

    private func fail(_ message: String?) {
        if let waiter = finalWaiter { finalWaiter = nil; waiter.resume(throwing: APIError.server(status: 502, code: message ?? "MOCK_INTERVIEW_SPEECH_CANCELLED")) }
        teardown()
        phase = message.map { .failed($0) } ?? .idle
    }

    private func teardown() {
        stopEngine()
        receiver?.cancel(); receiver = nil
        socket = nil; pendingBytes = 0; level = 0
    }

    private func receive(_ socket: URLSessionWebSocketTask) async {
        while !Task.isCancelled {
            let message: URLSessionWebSocketTask.Message
            do { message = try await socket.receive() }
            catch {
                guard finalWaiter != nil || phase == .recording || phase == .connecting else { return }
                let code = socket.closeCode.rawValue
                fail(code == 4401 ? "登录已失效，请重新登录。" : code == 4409 ? "面试状态已变化，请刷新后再作答。" : "语音识别连接中断，请重新录音。")
                return
            }
            guard case .string(let text) = message, let data = text.data(using: .utf8),
                  let event = try? JSONDecoder().decode(JSONValue.self, from: data) else { continue }
            switch event.text("type") {
            case "partial": partial = event.text("text")
            case "final":
                let result = Final(sessionID: event.text("session_id"), text: event.text("text"), durationMs: event["duration_ms"]?.integer ?? 0)
                partial = result.text
                if let waiter = finalWaiter { finalWaiter = nil; waiter.resume(returning: result) } else { earlyFinal = result }
                teardown(); phase = .idle
                return
            case "error":
                let code = event.text("code")
                fail(code == "MOCK_INTERVIEW_SPEECH_UNAVAILABLE" ? "语音识别暂未开放，请联系管理员配置语音线路。" : "语音识别失败（\(code)），请重新录音。")
                return
            default: continue
            }
        }
    }

    private func startEngine(_ socket: URLSessionWebSocketTask) throws {
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, let converter = AVAudioConverter(from: format, to: Self.targetFormat) else { throw APIError.invalidResponse }
        let frames = AVAudioFrameCount(format.sampleRate / 10)
        let deliver: @Sendable (Data, Float) -> Void = { [weak self] data, level in
            Task { @MainActor [weak self] in self?.send(data, level: level, socket: socket) }
        }
        input.installTap(onBus: 0, bufferSize: frames, format: format, block: Self.tap(converter: converter, deliver: deliver))
        engine.prepare()
        try engine.start()
        self.engine = engine
    }

    private func send(_ data: Data, level: Float, socket: URLSessionWebSocketTask) {
        guard phase == .recording, self.socket === socket else { return }
        self.level = level
        guard pendingBytes + data.count <= 1024 * 1024 else { socket.cancel(with: .goingAway, reason: nil); fail("网络太慢，录音没能及时发送，请重新录音。"); return }
        pendingBytes += data.count
        socket.send(.data(data)) { [weak self] error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.pendingBytes = max(0, self.pendingBytes - data.count)
                if error != nil, self.phase == .recording { self.fail("语音识别连接中断，请重新录音。") }
            }
        }
    }

    private func stopEngine() {
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
    }

    /// 麦克风回调在音频线程执行，必须在非隔离上下文中创建，不能继承 MainActor。
    nonisolated static func tap(converter: AVAudioConverter, deliver: @escaping @Sendable (Data, Float) -> Void) -> AVAudioNodeTapBlock {
        { buffer, _ in
            guard let data = convert(buffer, with: converter) else { return }
            deliver(data, rms(buffer))
        }
    }

    nonisolated static func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter) -> Data? {
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let output = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return nil }
        // 输入块同步调用，只交出这一个缓冲；用引用类型承载标记，避免并发捕获可变局部变量。
        final class Once: @unchecked Sendable { var consumed = false }
        let once = Once()
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if once.consumed { status.pointee = .noDataNow; return nil }
            once.consumed = true; status.pointee = .haveData; return buffer
        }
        guard error == nil, output.frameLength > 0, let channel = output.int16ChannelData else { return nil }
        return Data(bytes: channel[0], count: Int(output.frameLength) * MemoryLayout<Int16>.size)
    }

    nonisolated static func rms(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let channel = buffer.floatChannelData, buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for index in 0..<Int(buffer.frameLength) { sum += channel[0][index] * channel[0][index] }
        return min(1, (sum / Float(buffer.frameLength)).squareRoot() * 4)
    }

    static func microphoneAllowed() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: .audio)
        default: return false
        }
    }
}

/// 面试官语音：按 seq 顺序播放回合 SSE 中的 mp3 片段与试听音频；失败只保留字幕，不影响面试。
@MainActor @Observable
final class InterviewerVoice: NSObject, AVAudioPlayerDelegate {
    private(set) var playing = false
    private var queue: [Data] = []
    private var player: AVAudioPlayer?

    func enqueue(events: [JSONValue]) {
        let audio = events.filter { $0.text("event") == "interviewer.audio" }
            .sorted { ($0["data"]?["seq"]?.integer ?? 0) < ($1["data"]?["seq"]?.integer ?? 0) }
            .compactMap { Data(base64Encoded: $0["data"]?.text("data") ?? "") }
        queue += audio
        if !playing { next() }
    }

    func play(_ data: Data) { queue.append(data); if !playing { next() } }

    func stop() { queue.removeAll(); player?.stop(); player = nil; playing = false }

    private func next() {
        guard !queue.isEmpty else { playing = false; player = nil; return }
        let data = queue.removeFirst()
        guard let player = try? AVAudioPlayer(data: data) else { next(); return }
        player.delegate = self
        self.player = player
        playing = player.play()
        if !playing { next() }
    }

    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.next() }
    }
}

/// 设备检测用的麦克风探针（Web `useMicrophone` 的取流 + 电平部分）：只读电平，不连接识别、不保存音频。
/// macOS 的 AVAudioEngine 跟随系统默认输入设备，换麦克风在“系统设置 › 声音 › 输入”中完成。
@MainActor @Observable
final class MicrophoneProbe {
    enum Permission: Equatable { case idle, requesting, granted, denied, unavailable, error }

    private(set) var permission: Permission = .idle
    private(set) var level: Float = 0
    private(set) var deviceName = ""
    private var engine: AVAudioEngine?

    func start() async {
        stop()
        permission = .requesting
        guard await VoiceRecorder.microphoneAllowed() else {
            let status = AVCaptureDevice.authorizationStatus(for: .audio)
            permission = status == .denied || status == .restricted ? .denied : .unavailable
            return
        }
        guard let device = AVCaptureDevice.default(for: .audio) else { permission = .unavailable; return }
        deviceName = device.localizedName
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else { permission = .unavailable; return }
        let deliver: @Sendable (Float) -> Void = { [weak self] level in
            Task { @MainActor [weak self] in self?.level = level }
        }
        input.installTap(onBus: 0, bufferSize: AVAudioFrameCount(format.sampleRate / 10), format: format, block: Self.tap(deliver))
        do {
            engine.prepare()
            try engine.start()
            self.engine = engine
            permission = .granted
        } catch {
            input.removeTap(onBus: 0)
            permission = .error
        }
    }

    func stop() {
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        level = 0
    }

    nonisolated static func tap(_ deliver: @escaping @Sendable (Float) -> Void) -> AVAudioNodeTapBlock {
        { buffer, _ in deliver(VoiceRecorder.rms(buffer)) }
    }
}

/// 07.4 语音面试 · 设备检测（Web `DeviceCheck`）：每次进入未完成的语音场次先检查麦克风与面试官声音。
/// 麦克风授权后才能开始；试听失败不阻塞开始，只提示阅读字幕。“返回修改”“改为文字面试”都会放弃本场，由调用方确认。
struct VoiceDeviceCheck: View {
    let interviewID: String
    let language: String
    let questionCount: Int
    let preparing: Bool
    let busy: Bool
    let api: any APIClient
    let onStart: () -> Void
    let onBack: () -> Void
    let onSwitchToText: () -> Void

    @State private var mic = MicrophoneProbe()
    @State private var speaker = "idle"
    @State private var heardVoice = false
    @State private var quietLong = false
    @State private var player = InterviewerVoice()

    private static let threshold: Float = 0.09
    private static let envelope: [CGFloat] = [4, 6, 9, 12, 15, 18, 16, 13, 17, 14, 11, 9, 12, 8, 6, 5, 4, 5, 7, 9, 11, 13, 12, 10, 8, 7, 9, 11, 8, 6, 5, 4]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("开始前检查一下设备").font(V3.serif(20)).foregroundStyle(V3.txt)
            Text("面试官会用语音提问，你口头作答。").font(V3.sans(12.5)).foregroundStyle(V3.sub).padding(.top, 6)
            HStack(spacing: 8) {
                tip("headphones", "佩戴耳机，避免回声"); tip("speaker.slash", "安静的环境"); tip("clock", "约 \(questionCount * 5) 分钟 · \(questionCount) 道题")
            }.padding(.top, 14)

            VStack(alignment: .leading, spacing: 0) {
                microphoneRow
                Rectangle().fill(V3.line).frame(height: 1).padding(.vertical, 16)
                speakerRow
            }
            .padding(18).background(Color(hex: 0xFAFAF8), in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(V3.line)).padding(.top, 20)

            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.circle").font(.system(size: 13)).foregroundStyle(V3.sub)
                VStack(alignment: .leading, spacing: 4) {
                    Text("每条回答会保存录音与识别文字，报告中可回放和修正后重新评估。")
                    Text(speaker == "unsupported" ? "语音合成或播放失败，请检查系统输出设备后重试；也可以阅读字幕继续。" : "听不到声音时检查系统输出设备；语音合成失败时只显示字幕。")
                }.font(V3.sans(12)).foregroundStyle(V3.sub)
            }.padding(.top, 16)

            HStack(spacing: 12) {
                Button("不方便说话？改为文字面试", action: onSwitchToText).buttonStyle(.plain).font(V3.sans(12.5)).foregroundStyle(V3.sub).disabled(busy)
                Spacer()
                if preparing { Text("面试官正在准备题目…").font(V3.sans(12)).foregroundStyle(V3.fnt) }
                Button("返回修改", action: onBack).buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(busy)
                Button { mic.stop(); player.stop(); onStart() } label: { Label("开始语音面试", systemImage: "mic.fill") }
                    .buttonStyle(V3ButtonStyle(kind: .dark)).disabled(mic.permission != .granted || preparing || busy)
            }.padding(.top, 24)
        }
        .padding(.top, 28).frame(maxWidth: 640, alignment: .leading)
        .task { if mic.permission == .idle { await mic.start() } }
        .onChange(of: mic.level) { _, level in if level > Self.threshold { heardVoice = true; quietLong = false } }
        .task(id: "\(mic.permission == .granted)-\(heardVoice)") {
            guard mic.permission == .granted, !heardVoice else { return }
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled, !heardVoice { quietLong = true }
        }
        .onDisappear { mic.stop(); player.stop() }
    }

    private var microphoneRow: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                iconBox("mic")
                Text("麦克风").font(V3.sans(13.5, weight: .semibold)).foregroundStyle(V3.txt)
                switch mic.permission {
                case .granted: pill("已授权", .ok)
                case .idle, .requesting: pill("等待授权…", .muted)
                case .denied: pill("未授权", .bad)
                default: pill("不可用", .bad)
                }
                Spacer()
                if mic.permission == .granted {
                    Text(mic.deviceName).font(V3.sans(12)).foregroundStyle(V3.sub).lineLimit(1)
                    Button("更换") { openSettings("x-apple.systempreferences:com.apple.Sound-Settings.extension?input") }.buttonStyle(CareerActionStyle(kind: .link))
                } else if mic.permission != .idle && mic.permission != .requesting {
                    Button("重新检测") { heardVoice = false; quietLong = false; Task { await mic.start() } }.buttonStyle(V3ButtonStyle(kind: .ghost))
                }
            }
            if let problem = micProblem {
                VStack(alignment: .leading, spacing: 8) {
                    Text(problem).font(V3.sans(12)).foregroundStyle(V3.red).fixedSize(horizontal: false, vertical: true)
                    if mic.permission == .denied {
                        Button("打开麦克风隐私设置") { openSettings("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") }.buttonStyle(CareerActionStyle(kind: .link))
                    }
                }
            } else {
                HStack(spacing: 10) {
                    Text("说句话试试").font(V3.sans(12)).foregroundStyle(V3.sub)
                    let lit = mic.permission == .granted ? Int((min(1, mic.level * 1.8) * Float(Self.envelope.count)).rounded()) : 0
                    HStack(alignment: .center, spacing: 2) {
                        ForEach(Self.envelope.indices, id: \.self) { index in
                            RoundedRectangle(cornerRadius: 1).fill(index < lit ? V3.txt : V3.line).frame(width: 3, height: index < lit ? Self.envelope[index] : 3)
                        }
                    }.frame(height: 18).animation(.linear(duration: 0.08), value: lit)
                    Spacer()
                    if mic.permission == .granted {
                        if heardVoice || mic.level > Self.threshold { Text("音量正常").font(V3.sans(12)).foregroundStyle(V3.green) }
                        else if quietLong { Text("没有检测到声音").font(V3.sans(12)).foregroundStyle(V3.orange) }
                        else { Text("等待声音…").font(V3.sans(12)).foregroundStyle(V3.fnt) }
                    }
                }
            }
        }
    }

    private var speakerRow: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                iconBox("speaker.wave.2")
                Text("面试官声音").font(V3.sans(13.5, weight: .semibold)).foregroundStyle(V3.txt)
                switch speaker {
                case "played": pill("可以听到", .ok)
                case "unsupported": pill("无法试听", .warn)
                case "playing": pill("播放中…", .muted)
                default: pill("未试听", .muted)
                }
                Spacer()
                Button { Task { await preview() } } label: { Label("试听", systemImage: "play.fill") }.buttonStyle(V3ButtonStyle(kind: .ghost)).disabled(speaker == "playing")
            }
            Text("「\(language == "en" ? "Hello, I am your interviewer today. Let's start with a brief introduction." : "你好，我是今天的面试官，我们先从自我介绍开始。")」")
                .font(V3.sans(12.5)).foregroundStyle(V3.sub).padding(.leading, 42)
        }
    }

    private var micProblem: String? {
        switch mic.permission {
        case .denied: "麦克风权限被拒绝。请在“系统设置 › 隐私与安全性 › 麦克风”中允许 LinkResume，然后点击“重新检测”。"
        case .unavailable: "没有找到可用的麦克风。请连接麦克风后点击“重新检测”，或改为文字面试。"
        case .error: "麦克风暂时无法打开，可能正被其他应用占用。关闭占用的应用后点击“重新检测”。"
        default: nil
        }
    }

    /// 试听：不带 question_id 时后端合成固定问候语。合成或播放失败不阻塞开始。
    private func preview() async {
        player.stop()
        speaker = "playing"
        do {
            let audio = try await api.mockAudio(path: "/api/mock-interviews/\(interviewID)/speech/playback", method: "POST", body: .object([:]))
            player.play(audio)
            try? await Task.sleep(for: .milliseconds(300))
            while player.playing { try? await Task.sleep(for: .milliseconds(200)) }
            speaker = "played"
        } catch {
            speaker = "unsupported"
        }
    }

    private enum Tone { case ok, warn, bad, muted }
    private func pill(_ text: String, _ tone: Tone) -> some View {
        let colors: (Color, Color) = switch tone {
        case .ok: (V3.green, V3.greenSoft)
        case .warn: (V3.orange, V3.orangeSoft)
        case .bad: (V3.red, V3.redSoft)
        case .muted: (V3.sub, V3.stage)
        }
        return Text(text).font(V3.sans(11)).foregroundStyle(colors.0).padding(.horizontal, 7).frame(height: 18).background(colors.1, in: RoundedRectangle(cornerRadius: 5))
    }
    private func iconBox(_ symbol: String) -> some View {
        Image(systemName: symbol).font(.system(size: 14)).foregroundStyle(V3.txt).frame(width: 32, height: 32).background(.white, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(V3.line))
    }
    private func tip(_ symbol: String, _ text: String) -> some View {
        Label(text, systemImage: symbol).font(V3.sans(11.5)).foregroundStyle(V3.sub).padding(.horizontal, 9).frame(height: 24).background(V3.stage, in: RoundedRectangle(cornerRadius: 6))
    }
    private func openSettings(_ url: String) { if let url = URL(string: url) { NSWorkspace.shared.open(url) } }
}
