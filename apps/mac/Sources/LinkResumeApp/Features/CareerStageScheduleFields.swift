import SwiftUI

/// Native controls use the V4 form geometry; date editing stays in popovers.
struct CareerStageScheduleFields: View {
    let stage: String
    @Binding var scheduled: Bool
    let canSkipSchedule: Bool
    @Binding var window: Bool
    @Binding var start: Date
    @Binding var end: Date
    @Binding var openingSet: Bool
    @Binding var planSet: Bool
    @Binding var planStart: Date
    @Binding var planEnd: Date
    @Binding var meeting: String
    @Binding var location: String
    @Binding var interviewMode: String
    @Binding var allowConflict: Bool
    let hasError: Bool
    @State private var editing = ""
    private let ink = Color(hex: 0x1D1D1B)
    private let muted = Color(hex: 0x96968F)
    private var supportsWindow: Bool { ["assessment", "written_test"].contains(stage) }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            if supportsWindow {
                VStack(alignment: .leading, spacing: 8) {
                    caption("时间安排")
                    HStack(spacing: 8) {
                        card(false, title: "按时参加", subtitle: "准点开始，有时长", icon: "clock")
                        card(true, title: "截止前完成", subtitle: "期间自己选时间", icon: "flag")
                    }
                }
            }
            if !scheduled && !supportsWindow {
                Button("安排时间") { scheduled = true }.buttonStyle(CareerButtonStyle(radius: 8, height: 40))
            }
            if scheduled {
            HStack(spacing: 16) {
                dateField(window && supportsWindow ? "截止时间" : "开始时间", hint: "必填", key: window && supportsWindow ? "end" : "start")
                dateField(window && supportsWindow ? "开放时间" : "结束时间", hint: window && supportsWindow ? "不填从现在开始" : "必填", key: window && supportsWindow ? "start" : "end")
            }
            if window && supportsWindow {
                VStack(alignment: .leading, spacing: 8) {
                    caption("我的作答计划", hint: "可选 · 只提醒自己")
                    Button { if !planSet { planStart = start; planEnd = min(end, start.addingTimeInterval(3600)) }; editing = "plan" } label: {
                        input("clock", text: planSet ? stamp(planStart, "MM-dd HH:mm") + " – " + stamp(planEnd, "HH:mm") + "，周视图按普通日程显示" : "选择作答时间，只提醒自己", placeholder: !planSet)
                    }.buttonStyle(.plain).popover(isPresented: presented("plan")) {
                        VStack(alignment: .leading, spacing: 16) {
                            Text("我的作答计划").font(.headline)
                            DatePicker("开始时间", selection: $planStart, in: start...max(start, end))
                            DatePicker("结束时间", selection: $planEnd, in: start...max(start, end))
                            HStack { Button("清除") { planSet = false; editing = "" }; Spacer(); Button("完成") { planSet = true; editing = "" }.disabled(planEnd <= planStart || planStart < start || planEnd > end) }
                        }.padding(20)
                    }
                }
            }
            if stage == "interview" {
                VStack(alignment: .leading, spacing: 8) {
                    caption("面试方式")
                    Picker("面试方式", selection: $interviewMode) { Text("视频").tag("video"); Text("现场").tag("onsite"); Text("电话").tag("phone"); Text("其他").tag("other") }.pickerStyle(.segmented).labelsHidden()
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                caption(stage == "interview" ? "会议链接" : "测评链接", hint: "可选")
                HStack(spacing: 8) { CareerIcon(name: "link", size: 14); TextField("添加链接", text: $meeting).textFieldStyle(.plain) }
                    .padding(.horizontal, 12).frame(height: 40).background(.white, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0xE4E4E0)))
            }
            if stage == "interview" && interviewMode == "onsite" {
                VStack(alignment: .leading, spacing: 8) { caption("面试地点", hint: "可选"); TextField("填写地点", text: $location).textFieldStyle(.roundedBorder) }
            }
            }
            if hasError { Toggle("确认仍保存有时间冲突的安排", isOn: $allowConflict).font(LibraryTypography.sans(12)) }
        }.font(LibraryTypography.sans(13)).foregroundStyle(ink).contextMenu { if canSkipSchedule { Button("稍后安排时间") { scheduled = false; planSet = false } } }
    }
    private func caption(_ title: String, hint: String = "") -> some View {
        HStack { Text(title).font(LibraryTypography.sans(12, weight: .medium)); Spacer(); Text(hint).font(LibraryTypography.sans(10.5)).foregroundStyle(muted) }.frame(height: 16)
    }
    private func card(_ value: Bool, title: String, subtitle: String, icon: String) -> some View {
        Button { window = value; scheduled = true } label: {
            HStack(spacing: 12) {
                CareerIcon(name: icon, size: 14, template: true).foregroundStyle(scheduled && window == value ? .white : muted).frame(width: 30, height: 30).background(scheduled && window == value ? ink : Color(hex: 0xF4F4F2), in: RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading, spacing: 4) { Text(title).font(LibraryTypography.sans(13, weight: .medium)); Text(subtitle).font(LibraryTypography.sans(11)).foregroundStyle(muted) }
                Spacer(minLength: 0)
            }.padding(.horizontal, 14).frame(maxWidth: .infinity).frame(height: 64)
                .background(scheduled && window == value ? Color(hex: 0xFAFAF9) : .white, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(scheduled && window == value ? ink : Color(hex: 0xE4E4E0), lineWidth: scheduled && window == value ? 1.5 : 1))
                .overlay(alignment: .topTrailing) { if scheduled && window == value { Image(systemName: "checkmark.circle.fill").font(.system(size: 14)).padding(6) } }
        }.buttonStyle(.plain).contextMenu { if canSkipSchedule { Button("稍后安排时间") { scheduled = false; planSet = false } } }
    }
    private func input(_ icon: String, text: String, placeholder: Bool = false) -> some View {
        HStack(spacing: 8) { CareerIcon(name: icon, size: 14); Text(text).foregroundStyle(placeholder ? muted : ink).lineLimit(1); Spacer(minLength: 0) }
            .padding(.horizontal, 12).frame(height: 40).background(.white, in: RoundedRectangle(cornerRadius: 8)).overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0xE4E4E0)))
    }
    private func dateField(_ title: String, hint: String, key: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            caption(title, hint: hint)
            Button { editing = key } label: { input("calendar", text: key == "start" && supportsWindow && window && !openingSet ? "从现在开始" : stamp(key == "start" ? start : end, "MM-dd EEE HH:mm")) }
                .buttonStyle(.plain).popover(isPresented: presented(key)) {
                    VStack(spacing: 16) {
                        DatePicker(title, selection: key == "start" ? $start : $end)
                        HStack { if key == "start" && supportsWindow && window { Button("从现在开始") { openingSet = false; start = Date(); editing = "" } }; Spacer(); Button("完成") { if key == "start" { openingSet = true }; editing = "" } }
                    }.padding(20)
                }
        }.frame(maxWidth: .infinity)
    }
    private func presented(_ key: String) -> Binding<Bool> { Binding(get: { editing == key }, set: { if !$0 { editing = "" } }) }
    private func stamp(_ date: Date, _ format: String) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "zh_CN"); f.dateFormat = format; return f.string(from: date) }
}
