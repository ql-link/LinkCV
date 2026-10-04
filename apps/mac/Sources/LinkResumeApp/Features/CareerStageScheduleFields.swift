import SwiftUI

/// Schedule part of Web `AddNextStageDialog` (`.cd3-time-*`, `.cd3-mode-*`, `.cd3-stage-field`).
/// Interview and HR 面 use one fixed slot with a duration; assessment is always a window;
/// written tests choose between a slot and a window; AI 面试 only takes a slot.
struct CareerStageScheduleFields: View {
    let stage: String
    let isHR: Bool
    @Binding var window: Bool
    @Binding var startSet: Bool
    @Binding var start: Date
    @Binding var endSet: Bool
    @Binding var end: Date
    @Binding var duration: Int
    @Binding var planSet: Bool
    @Binding var planStart: Date
    @Binding var planDuration: Int
    @Binding var mode: String
    @Binding var link: String
    @Binding var interviewer: String
    @Binding var note: String
    @Binding var allowConflict: Bool
    let hasError: Bool
    @State private var editing = ""
    @State private var noteOpen = false
    @State private var deadlineDays: Int?

    private var interviewForm: Bool { stage == "interview" }
    private var isWindow: Bool { stage == "assessment" || (stage == "written_test" && window) }
    private var stageName: String { isHR ? "HR 面" : CareerStage.label(stage) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !interviewForm {
                Text("时间安排").font(V3.sans(12, weight: .medium)).foregroundStyle(V3.txt).frame(height: 14).padding(.top, 28).padding(.bottom, 8)
                HStack(spacing: 8) {
                    timeChoice(false, title: "按时参加", subtitle: "准点开始，有时长", icon: "clock", disabled: stage == "assessment")
                    timeChoice(true, title: "截止前完成", subtitle: stage == "ai_interview" ? "AI 面试仅支持按时参加" : "期间自己选时间", icon: "flag", disabled: stage == "ai_interview")
                }
            }
            HStack(alignment: .top, spacing: 16) {
                if isWindow {
                    field("截止时间", required: true) { dateButton(key: "end", value: endSet ? end : nil, placeholder: "选择截止时间") }
                    field("开放时间", hint: "不填从现在开始") { dateButton(key: "start", value: startSet ? start : nil, placeholder: "收到通知就开放") }
                } else {
                    field(isHR ? "沟通时间" : "开始时间", required: true) { dateButton(key: "start", value: startSet ? start : nil, placeholder: "选择开始时间") }
                    field("时长") {
                        Picker("", selection: $duration) {
                            ForEach(Array(Set([30, 60, 90, 120, 180, duration])).sorted(), id: \.self) { Text("\($0) 分钟").tag($0) }
                        }.labelsHidden().frame(height: 40)
                    }
                }
            }.padding(.top, 22)
            if isWindow {
                if stage == "assessment" {
                    HStack(spacing: 6) {
                        ForEach([1, 3, 7], id: \.self) { days in
                            let chosen = deadlineDays == days && endSet
                            Button(days == 1 ? "24 小时" : "\(days) 天后") {
                                end = Date().addingTimeInterval(Double(days) * 86400); endSet = true; deadlineDays = days
                            }
                            .buttonStyle(.plain).font(V3.sans(11)).foregroundStyle(chosen ? V3.txt : V3.sub)
                            .padding(.horizontal, 9).frame(height: 24)
                            .background(chosen ? V3.stage : .white, in: Capsule()).overlay(Capsule().stroke(chosen ? V3.txt : V3.cl))
                        }
                    }.padding(.top, 8)
                }
                field("我的作答计划", hint: "可选 · 只提醒自己，不改官方时间") {
                    Button {
                        if !planSet { planStart = max(startSet ? start : Date(), Date()); planDuration = 60 }
                        editing = "plan"
                    } label: {
                        input("clock", planSet ? stamp(planStart, "MM月dd日 HH:mm") + " · \(planDuration) 分钟" : "选一段打算作答的时间", placeholder: !planSet)
                    }.buttonStyle(.plain).popover(isPresented: presented("plan")) {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("我的作答计划").font(V3.sans(13, weight: .medium))
                            DatePicker("开始时间", selection: $planStart, in: (startSet ? start : Date())...max(startSet ? start : Date(), endSet ? end : Date().addingTimeInterval(86400 * 365)))
                            Picker("时长", selection: $planDuration) { ForEach([30, 60, 90, 120, 180], id: \.self) { Text("\($0) 分钟").tag($0) } }
                            HStack { Button("清除") { planSet = false; editing = "" }; Spacer(); Button("完成") { planSet = true; editing = "" }.keyboardShortcut(.defaultAction) }
                        }.padding(20).frame(width: 300)
                    }
                }.padding(.top, 22)
            }
            if interviewForm {
                HStack(alignment: .top, spacing: 16) {
                    field(isHR ? "沟通方式" : "面试方式") { modeSegmented([("video", "视频"), ("onsite", "现场"), ("phone", "电话")]).padding(.top, 10) }
                    field(isHR ? "联系人" : "面试官") { textInput(isHR ? "例如：陈老师 · 招聘 HR" : "例如：李老师 · 技术负责人", text: $interviewer) }
                }.padding(.top, 22)
                field(mode == "onsite" ? "面试地点" : "会议链接", hint: "可选") { textInput(mode == "onsite" ? "填写地点" : "粘贴会议链接", text: $link, icon: "link") }.padding(.top, 26)
                field(isHR ? "沟通准备" : "准备提醒", hint: "可选 · 只提醒自己") {
                    textInput(isHR ? "例如：确认薪酬期望、到岗时间与工作地点" : "例如：整理两个项目案例", text: $note, icon: "clock")
                }.padding(.top, 22)
            } else {
                if stage == "written_test" && !isWindow {
                    field("方式") { modeSegmented([("video", "在线"), ("onsite", "线下")]).padding(.top, 10) }.padding(.top, 22)
                    field(mode == "onsite" ? "笔试地点" : "笔试链接", hint: "可选") { textInput("粘贴链接或填写地点", text: $link, icon: "link") }.padding(.top, 26)
                } else {
                    field(stage == "assessment" ? "测评链接" : stage == "written_test" ? "笔试链接" : "面试链接", hint: "可选") { textInput("粘贴链接", text: $link, icon: "link") }.padding(.top, 22)
                }
                Button { noteOpen.toggle() } label: {
                    HStack(spacing: 6) {
                        Image(systemName: noteOpen ? "chevron.up" : "plus").font(.system(size: 10))
                        Text("添加准备备注").font(V3.sans(12)).foregroundStyle(V3.sub)
                        Text("要带的材料、注意事项").font(V3.sans(11)).foregroundStyle(V3.fnt)
                    }.contentShape(Rectangle())
                }.buttonStyle(.plain).foregroundStyle(V3.sub).padding(.top, 22)
                if noteOpen || !note.isEmpty {
                    TextEditor(text: $note).font(V3.sans(13)).scrollContentBackground(.hidden).padding(6).frame(height: 70)
                        .background(.white, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(V3.cl)).padding(.top, 10)
                        .accessibilityLabel("备注（选填）")
                }
            }
            if hasError { Toggle("确认仍保存有时间冲突的安排", isOn: $allowConflict).font(V3.sans(12)).padding(.top, 14) }
        }
        .onChange(of: stage) { _, value in
            if value == "assessment" { window = true }
            if value == "ai_interview" || value == "interview" { window = false }
        }
    }

    private func timeChoice(_ value: Bool, title: String, subtitle: String, icon: String, disabled: Bool) -> some View {
        let active = isWindow == value
        return Button { window = value } label: {
            HStack(spacing: 12) {
                CareerIcon(name: icon, size: 14, template: true).foregroundStyle(active ? .white : V3.sub)
                    .frame(width: 30, height: 30).background(active ? V3.txt : V3.field, in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 5) {
                    Text(title).font(V3.sans(13, weight: .medium)).foregroundStyle(disabled ? V3.fnt : V3.txt)
                    Text(subtitle).font(V3.sans(11)).foregroundStyle(V3.fnt)
                }.lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).frame(maxWidth: .infinity).frame(height: 64)
            .background(.white, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(active ? V3.txt : V3.cl, lineWidth: active ? 1.5 : 1))
            .overlay(alignment: .topTrailing) { if active { checkBadge.padding(6) } }
            .contentShape(Rectangle())
        }.buttonStyle(.plain).disabled(disabled)
    }
    private var checkBadge: some View {
        Image(systemName: "checkmark").font(.system(size: 7, weight: .bold)).foregroundStyle(.white).frame(width: 14, height: 14).background(V3.txt, in: Circle())
    }
    private func modeSegmented(_ options: [(String, String)]) -> some View {
        HStack(spacing: 0) {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                Button { mode = option.0 } label: {
                    Text(option.1).font(V3.sans(11.5)).foregroundStyle(mode == option.0 ? V3.txt : V3.fnt)
                        .frame(maxWidth: .infinity).frame(height: 24)
                        .background { if mode == option.0 { RoundedRectangle(cornerRadius: 5).fill(.white).shadow(color: .black.opacity(0.07), radius: 2, y: 1) } }
                        .contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
        }
        .padding(3).frame(width: options.count == 3 ? 102 : 72, height: 30)
        .background(V3.field, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(V3.cl))
    }
    private func field<Content: View>(_ title: String, required: Bool = false, hint: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 2) {
                Text(title).font(V3.sans(11)).foregroundStyle(V3.sub)
                if required { Text("*").font(V3.sans(11)).foregroundStyle(V3.red) }
                Spacer(minLength: 4)
                if let hint { Text(hint).font(V3.sans(10.5)).foregroundStyle(V3.fnt).lineLimit(1) }
            }.frame(height: 13)
            content()
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
    private func input(_ icon: String, _ text: String, placeholder: Bool = false) -> some View {
        HStack(spacing: 8) {
            CareerIcon(name: icon, size: 14, template: true).foregroundStyle(V3.sub)
            Text(text).font(V3.sans(13)).foregroundStyle(placeholder ? V3.fnt2 : V3.txt).lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12).frame(height: 40).frame(maxWidth: .infinity)
        .background(.white, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(V3.cl))
        .contentShape(Rectangle())
    }
    private func textInput(_ placeholder: String, text: Binding<String>, icon: String? = nil) -> some View {
        HStack(spacing: 8) {
            if let icon { CareerIcon(name: icon, size: 14, template: true).foregroundStyle(V3.fnt) }
            TextField("", text: text, prompt: Text(placeholder).foregroundStyle(V3.fnt2)).textFieldStyle(.plain).font(V3.sans(13)).foregroundStyle(V3.txt)
        }
        .padding(.horizontal, 12).frame(height: 40)
        .background(.white, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(V3.cl))
    }
    private func dateButton(key: String, value: Date?, placeholder: String) -> some View {
        Button { if value == nil { seed(key) }; editing = key } label: {
            input("calendar", value.map { stamp($0, "MM月dd日 EEE HH:mm") } ?? placeholder, placeholder: value == nil)
        }
        .buttonStyle(.plain)
        .popover(isPresented: presented(key)) {
            VStack(alignment: .leading, spacing: 14) {
                DatePicker(key == "end" ? "截止时间" : isHR ? "沟通时间" : "开始时间", selection: key == "end" ? $end : $start)
                    .datePickerStyle(.graphical).labelsHidden()
                DatePicker("", selection: key == "end" ? $end : $start, displayedComponents: .hourAndMinute).labelsHidden()
                HStack {
                    if key == "start" && isWindow { Button("从现在开始") { startSet = false; editing = "" } }
                    Spacer()
                    Button("完成") { if key == "end" { endSet = true; deadlineDays = nil } else { startSet = true }; editing = "" }.keyboardShortcut(.defaultAction)
                }
            }.padding(18).frame(width: 300)
        }
    }
    /// A first pick starts from the next half hour, like Web `defaultInterviewStartAt`.
    private func seed(_ key: String) {
        let calendar = Calendar.current
        let base = Date().addingTimeInterval(key == "end" ? 3 * 86400 : 86400)
        var parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: base)
        let minute = parts.minute ?? 0
        parts.minute = 0
        let hour = calendar.date(from: parts) ?? base
        let date = hour.addingTimeInterval(minute < 30 ? 30 * 60 : 3600)
        if key == "end" { end = date } else { start = date }
    }
    private func presented(_ key: String) -> Binding<Bool> { Binding(get: { editing == key }, set: { if !$0 { editing = "" } }) }
    private func stamp(_ date: Date, _ format: String) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN"); f.dateFormat = format; return f.string(from: date) }
}
