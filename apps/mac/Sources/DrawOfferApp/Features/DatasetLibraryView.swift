import AppKit
import AVKit
import CoreText
import Foundation
import DrawOfferCore
import SwiftUI
import UniformTypeIdentifiers

private struct LibraryQueued: Identifiable {
    let id = UUID()
    var upload: DatasetUpload
    var status = "selected"
    var message = "等待上传"
}
struct DatasetLibraryView: View {
    @Environment(SessionStore.self) private var session
    let requireAccount: () -> Void
    @State private var datasets: [DatasetRecord] = []
    @State private var folders: [JSONValue] = []
    @State private var limits: JSONValue = .null
    @State private var folder = ""
    @State private var history: [String] = []
    @State private var query = ""
    @State private var filter = "all"
    @State private var selected = Set<String>()
    @State private var inspected = ""
    @State private var loaded = false
    @State private var loading = false
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?
    @State private var refresh = UUID()
    @State private var action: String?
    @State private var target: JSONValue = .null
    @State private var name = ""
    @State private var destination = ""
    @State private var sessions: [JSONValue] = []
    @State private var preview = ""
    @State private var mediaFile: DatasetFile?
    @State private var player: AVPlayer?
    @State private var sheetError: String?
    @State private var queue: [LibraryQueued] = []
    @State private var queueID: UUID?
    @State private var pending = ""
    @State private var active = true
    @State private var loadID = UUID()
    @State private var uploadTask: Task<Void,Never>?
    @State private var batchMode = false
    @State private var hoveredRow: String?
    private var account: String { if case .signedIn(let user) = session.phase { return user.id }; return "" }
    private var folderName: String { folder == "uncategorized" ? "未分类" : folders.first { $0.text("id") == folder }?.text("name") ?? "资料库" }
    private var visible: [DatasetRecord] { datasets.filter { item in (folder.isEmpty || (folder == "uncategorized" ? item.folder.isEmpty : item.folder == folder)) && (query.isEmpty || item.name.localizedCaseInsensitiveContains(query)) && (filter == "all" || filter == "ready" && item.ready || filter == "processing" && item.busy || filter == "failed" && item.status.contains("失败") || filter == item.raw.text("asset_kind")) } }
    private var maximum: Int64 { min(512*1024*1024, Int64(limits["max_media_file_bytes"]?.numberValue ?? 500*1024*1024)) }
    private func request(_ path:String,_ method:String = "GET",_ body:JSONValue? = nil,query:[String:String] = [:]) async throws -> JSONValue {
        let owner = account
        do {
            let result = try await session.api.careerRequest(path:path,method:method,query:query,body:body)
            try Task.checkCancellation(); guard active, !owner.isEmpty, owner == account else { throw CancellationError() }; return result
        } catch { guard active, !owner.isEmpty, owner == account else { throw CancellationError() }; throw error }
    }

    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:0) {
                header
                if loading && !loaded { ProgressView("正在加载资料…").font(V3.sans(13)).frame(maxWidth:.infinity,minHeight:250) }
                else if !account.isEmpty && !loaded { empty("资料加载失败","请稍后重试。资料和文件夹都还在，刷新一下试试。",symbol:"exclamationmark.arrow.triangle.2.circlepath") }
                else if folder.isEmpty { root }
                else { fileList }
                if let error {
                    HStack(spacing:10) { Text(error).font(V3.sans(12.5)).foregroundStyle(V3.red); Spacer(); Button("重新刷新") { refresh = UUID() }.buttonStyle(CareerActionStyle(kind:.link)).disabled(busy) }.padding(.top,16)
                }
                if let notice {
                    HStack(spacing:10) { Text(notice).font(V3.sans(12.5)).foregroundStyle(V3.sub); Spacer(); Button { self.notice = nil } label:{ Image(systemName:"xmark").font(.system(size:10)) }.buttonStyle(.plain).foregroundStyle(V3.fnt) }.padding(.top,16)
                }
                if !queue.isEmpty { uploadQueue.padding(.top,24) }
            }.padding(.horizontal,32).padding(.bottom,72).frame(maxWidth:.infinity,alignment:.top)
        }
        .overlay(alignment:.bottom) { if batchMode && !folder.isEmpty { batchBar } }
        .task(id:account + refresh.uuidString) { active = true; await load(poll:true) }
            .onChange(of:account) { _, id in
                player?.pause(); player = nil; mediaFile?.discard(); mediaFile = nil; uploadTask?.cancel(); queue.forEach { $0.upload.discard() }; queue = []; action = nil; selected = []; inspected = ""; datasets = []; folders = []; loaded = false; limits = .null; preview = ""; error = nil; sheetError = nil; notice = nil; busy = false; folder = ""; history = []; query = ""; sessions = []
                batchMode = false
                if !id.isEmpty && !pending.isEmpty { let next = pending; pending = ""; action = next; name = "" } else { pending = "" }
            }
            .onChange(of:action) { _, value in if value != "media" { player?.pause(); player = nil; mediaFile?.discard(); mediaFile = nil } }
            .onDisappear { active = false; loadID = UUID(); player?.pause(); player = nil; mediaFile?.discard(); mediaFile = nil; uploadTask?.cancel(); queue.forEach { $0.upload.discard() } }
            .sheet(isPresented:Binding(get:{action != nil},set:{if !$0 && !busy { action = nil }})) { sheet }
            .onDrop(of:[UTType.fileURL],isTargeted:nil) { providers in
                guard !busy, DatasetRequest.id(folder), !account.isEmpty else { return false }
                let targetFolder = folder, owner = account
                for provider in providers { _ = provider.loadObject(ofClass:URL.self) { url,_ in if let url { Task { @MainActor in guard owner == account else { return }; await enqueue([url],into:targetFolder) } } } }
                return true
            }
    }
    /// 06.1 / 06.2 page head: eyebrow (with the breadcrumb inside a folder), serif title, subtitle and actions.
    private var header: some View {
        VStack(alignment:.leading,spacing:0) {
            HStack(alignment:.top,spacing:24) {
                VStack(alignment:.leading,spacing:0) {
                    if folder.isEmpty {
                        Text("DATASETS · \(datasets.count) 份").font(V3.sans(12,weight:.medium)).foregroundStyle(V3.fnt).frame(height:13)
                    } else {
                        HStack(spacing:6) {
                            Button("DATASETS") { navigate(""); history = [] }.buttonStyle(.plain).foregroundStyle(V3.sub).accessibilityLabel("返回全部资料").disabled(busy)
                            Text("·").foregroundStyle(V3.fnt)
                            Text(folderName).foregroundStyle(V3.fnt).lineLimit(1)
                        }.font(V3.sans(12,weight:.medium)).frame(height:13)
                    }
                    Text(folder.isEmpty ? "资料库" : folderName).font(V3.serif(28)).foregroundStyle(V3.txt).lineLimit(1).frame(height:36).padding(.top,9)
                    Text(subtitle).font(V3.sans(14)).foregroundStyle(V3.sub).padding(.top,6)
                }.frame(maxWidth:.infinity,alignment:.leading)
                HStack(spacing:10) {
                    V3SearchField(text:$query,placeholder:"搜索资料…",width:folder.isEmpty ? 200 : 180)
                    if folder.isEmpty {
                        Button("新建文件夹") { show("createFolder") }.buttonStyle(V3ButtonStyle(kind:.dark,width:120)).disabled(busy || batchMode)
                    } else {
                        Button(batchMode ? "取消操作" : "批量操作") { batchMode.toggle(); selected = [] }.buttonStyle(V3ButtonStyle(kind:.ghost,width:92)).disabled(busy)
                        Button("上传资料") { pick() }.buttonStyle(V3ButtonStyle(kind:.dark,width:108)).disabled(busy || batchMode || !loaded || !DatasetRequest.id(folder))
                    }
                }.padding(.top,32)
            }
            Rectangle().fill(V3.line).frame(height:1).padding(.top,24)
        }
    }
    private var subtitle: String {
        if !account.isEmpty && !loaded { return loading ? "正在加载…" : "" }
        if folder.isEmpty {
            return datasets.isEmpty && folders.isEmpty ? "把履历、项目记录和参考资料集中在这里，写简历时随时调用。" : "\(datasets.count) 份资料 · \(folders.count) 个文件夹"
        }
        let inside = datasets.filter { folder == "uncategorized" ? $0.folder.isEmpty : $0.folder == folder }
        let linked = inside.filter { !$0.raw.text("interview_label").isEmpty }.count
        return "共 \(inside.count) 份资料" + (linked > 0 ? " · \(linked)份已关联面试" : "")
    }
    private var emptyFolders: some View {
        V3EmptyCard(title:folder.isEmpty ? "还没有文件夹" : "还没有资料",
                    message:folder.isEmpty ? "建议先新建文件夹分类整理，后续写简历时可以快速检索和引用相关资料。" : "建议先上传一份与当前分类相关的资料，后续写简历时可以快速检索和引用。") {
            if let url = Bundle.module.url(forResource:"empty-folders",withExtension:"png",subdirectory:"Library"), let illustration = NSImage(contentsOf:url) {
                Image(nsImage:illustration).resizable().scaledToFit().accessibilityHidden(true)
            }
        } actions: { EmptyView() }
        .frame(maxWidth:.infinity).padding(.top,59)
    }
    private func navigate(_ id:String) { guard !busy else { return }; history.append(folder); folder = id; selected = []; inspected = ""; query = ""; batchMode = false }
    private func relativeDay(_ value:String,withTime:Bool = false) -> String {
        guard let date = CareerApplication.date(value) else { return "" }
        let calendar = Calendar.current
        let days = calendar.dateComponents([.day],from:calendar.startOfDay(for:date),to:calendar.startOfDay(for:Date())).day ?? 0
        let time = self.date(value,format:"HH:mm")
        if days == 0 { return withTime ? "今天 " + time : "今天" }
        if days == 1 { return withTime ? "昨天 " + time : "昨天" }
        return listDate(value)
    }
    private func listDate(_ value:String) -> String {
        guard let date = CareerApplication.date(value) else { return value }
        return self.date(value,format:Calendar.current.component(.year,from:date) == Calendar.current.component(.year,from:Date()) ? "MM-dd" : "yyyy-MM-dd")
    }
    private var root: some View {
        VStack(alignment:.leading,spacing:0) {
            if folders.isEmpty && datasets.isEmpty { emptyFolders }
            else {
                HStack {
                    Text("文件夹").font(V3.sans(15,weight:.semibold)).foregroundStyle(V3.txt)
                    Spacer()
                    Text("按最近更新").font(V3.sans(12)).foregroundStyle(V3.fnt)
                }.frame(height:16).padding(.top,23).padding(.bottom,12)
                LazyVGrid(columns:[GridItem(.adaptive(minimum:273),spacing:20)],spacing:20) {
                    ForEach(sortedFolders.filter { query.isEmpty || $0.text("name").localizedCaseInsensitiveContains(query) },id:\.self) { item in folderCard(item) }
                    if datasets.contains(where:{$0.folder.isEmpty}) { folderCard(.object(["id":.string("uncategorized"),"name":.string("未分类"),"dataset_count":.number(Double(datasets.filter{$0.folder.isEmpty}.count))])) }
                    Button { show("createFolder") } label:{
                        VStack(spacing:0) {
                            LibraryIcon(name:"icon-plus",size:16).frame(width:36,height:36).background(V3.field,in:Circle())
                            Text("新建文件夹").font(V3.sans(13,weight:.medium)).foregroundStyle(V3.txt).padding(.top,12)
                            Text("按求职用途分类，最多 50 个").font(V3.sans(11)).foregroundStyle(V3.fnt).padding(.top,6)
                        }.frame(maxWidth:.infinity).frame(height:172).contentShape(Rectangle())
                        .overlay(RoundedRectangle(cornerRadius:16).stroke(V3.fnt2,style:StrokeStyle(lineWidth:1,dash:[4,3])))
                    }.buttonStyle(.plain).disabled(busy || batchMode)
                }
                let recent = query.isEmpty ? Array(datasets.sorted { $0.raw.text("created_at") > $1.raw.text("created_at") }.prefix(5)) : visible
                if !recent.isEmpty {
                    Text(query.isEmpty ? "最近上传" : "搜索结果").font(V3.sans(15,weight:.semibold)).foregroundStyle(V3.txt).padding(.top,32).padding(.bottom,12)
                    VStack(spacing:0) {
                        ForEach(recent) { item in
                            if item.id != recent.first?.id { Rectangle().fill(V3.line).frame(height:1).padding(.horizontal,17) }
                            recentRow(item)
                        }
                    }
                    .background(.white,in:RoundedRectangle(cornerRadius:16)).clipShape(RoundedRectangle(cornerRadius:16))
                    .overlay(RoundedRectangle(cornerRadius:16).stroke(V3.cl)).shadow(color:.black.opacity(0.04),radius:8,x:0,y:2)
                } else if !query.isEmpty {
                    Text("没有匹配的资料。").font(V3.sans(13)).foregroundStyle(V3.fnt).frame(maxWidth:.infinity).padding(.vertical,40)
                }
                Text("写简历或和 AI 助手对话时，可以通过「添加资料」选择要引用的文件。").font(V3.sans(14)).foregroundStyle(V3.fnt).padding(.top,20)
            }
        }
    }
    private var sortedFolders: [JSONValue] {
        folders.sorted { left, right in
            let l = datasets.filter { $0.folder == left.text("id") }.map { $0.raw.text("created_at") }.max() ?? left.text("updated_at")
            let r = datasets.filter { $0.folder == right.text("id") }.map { $0.raw.text("created_at") }.max() ?? right.text("updated_at")
            return l > r
        }
    }
    private func recentRow(_ item:DatasetRecord) -> some View {
        let folderTitle = item.folder.isEmpty ? "未分类" : folders.first { $0.text("id") == item.folder }?.text("name") ?? "未分类"
        return Button {
            if item.ready { open(item) } else { navigate(item.folder.isEmpty ? "uncategorized" : item.folder) }
        } label:{
            HStack(spacing:12) {
                formatIcon(item,tinted:false)
                Text(item.name).font(V3.sans(13,weight:.medium)).foregroundStyle(V3.txt).lineLimit(1).frame(maxWidth:346,alignment:.leading).fixedSize(horizontal:false,vertical:true)
                HStack(spacing:5) { LibraryIcon(name:"icon-folder",size:13); Text(folderTitle).lineLimit(1) }
                    .font(V3.sans(11.5)).foregroundStyle(V3.sub).padding(.leading,8).padding(.trailing,10).frame(height:22).frame(maxWidth:200).background(V3.field,in:Capsule())
                Spacer(minLength:12)
                Text(relativeDay(item.raw.text("created_at"),withTime:true)).font(V3.number(11.5,weight:.regular)).foregroundStyle(V3.fnt)
            }.padding(.horizontal,17).frame(height:56).contentShape(Rectangle())
        }.buttonStyle(CareerRowStyle()).accessibilityLabel("\(item.name)，位于「\(folderTitle)」").disabled(busy)
    }
    /// `FolderCard`: an art stage with up to three recent sheets, the name, the count line and a ⋯ menu.
    private func folderCard(_ item:JSONValue) -> some View {
        let records = datasets.filter { item.text("id") == "uncategorized" ? $0.folder.isEmpty : $0.folder == item.text("id") }
            .sorted { $0.raw.text("created_at") > $1.raw.text("created_at") }
        let count = item["dataset_count"]?.integer ?? records.count
        let meta = count == 0 ? "空文件夹 · 进入后上传资料" : records.first.map { "\(count) 份资料 · 最近上传 " + relativeDay($0.raw.text("created_at")) } ?? "\(count) 份资料"
        return Button { navigate(item.text("id")) } label:{
            VStack(alignment:.leading,spacing:0) {
                ZStack {
                    V3.stage
                    if count == 0 || records.isEmpty {
                        RoundedRectangle(cornerRadius:4).stroke(V3.fnt2,style:StrokeStyle(lineWidth:1,dash:[3,2])).frame(width:60,height:78)
                    } else {
                        ForEach(Array(records.prefix(3).enumerated().reversed()),id:\.offset) { index,record in
                            folderSheet(record).rotationEffect(.degrees([0,-6,6][index])).offset(x:[0,-46,46][index],y:index == 0 ? 0 : 6)
                        }
                    }
                }
                .frame(maxWidth:.infinity).frame(height:98).clipShape(RoundedRectangle(cornerRadius:11)).padding(7)
                Text(item.text("name")).font(V3.sans(14,weight:.medium)).foregroundStyle(V3.txt).lineLimit(1).padding(.leading,17).padding(.trailing,52).padding(.top,6)
                Text(meta).font(V3.sans(12)).foregroundStyle(V3.fnt).lineLimit(1).padding(.horizontal,17).padding(.top,4)
                Spacer(minLength:0)
            }
            .frame(maxWidth:.infinity).frame(height:172)
            .background(.white,in:RoundedRectangle(cornerRadius:16)).overlay(RoundedRectangle(cornerRadius:16).stroke(V3.cl))
            .shadow(color:.black.opacity(0.04),radius:8,x:0,y:2).contentShape(RoundedRectangle(cornerRadius:16))
        }.buttonStyle(.plain).accessibilityLabel("打开文件夹「\(item.text("name"))」").overlay(alignment:.bottomTrailing) {
            if DatasetRequest.id(item.text("id")) {
                Menu { Button("重命名") { show("renameFolder",item) }; Divider(); Button("删除文件夹",role:.destructive) { show("deleteFolder",item) } } label:{ LibraryIcon(name:"icon-more",size:14).frame(width:28,height:28) }
                    .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().padding(.trailing,12).padding(.bottom,26).disabled(busy)
                    .accessibilityLabel("文件夹「\(item.text("name"))」操作菜单")
            }
        }
    }
    /// `FolderSheet`: 60×78 thumbnail with a title bar, grey lines and the format tag.
    private func folderSheet(_ item:DatasetRecord) -> some View {
        let tone = formatTone(item)
        return ZStack(alignment:.topLeading) {
            RoundedRectangle(cornerRadius:4).fill(.white).overlay(RoundedRectangle(cornerRadius:4).stroke(V3.cl)).shadow(color:.black.opacity(0.07),radius:4,y:3)
            RoundedRectangle(cornerRadius:1).fill(V3.txt).frame(width:25,height:4).offset(x:8,y:11)
            ForEach([23,34,44],id:\.self) { y in RoundedRectangle(cornerRadius:1).fill(V3.line).frame(width:43,height:3).offset(x:8,y:CGFloat(y)) }
            Text(tone.label).font(V3.number(7,weight:.bold)).foregroundStyle(.white).padding(.horizontal,4).frame(height:12).background(tone.color,in:RoundedRectangle(cornerRadius:3)).offset(x:8,y:55)
        }.frame(width:60,height:78)
    }
    /// `datasetFormatTone`: PDF red, MD green, DOCX blue, TXT grey, audio/video orange.
    private func formatTone(_ item:DatasetRecord) -> (label:String,color:Color,tint:Color) {
        let label = String((item.format.isEmpty ? "FILE" : item.format).prefix(4))
        if item.media { return (label,V3.orange,Color(hex:0xFBF1E6)) }
        switch label {
        case "PDF": return (label,V3.red,Color(hex:0xFBEEEE))
        case "MD": return (label,V3.green,Color(hex:0xECF5EF))
        case "DOCX": return (label,V3.blue,Color(hex:0xEDF2FC))
        default: return (label,V3.sub,V3.field)
        }
    }
    private func formatIcon(_ item:DatasetRecord,tinted:Bool = true) -> some View {
        let tone = formatTone(item)
        return Text(tone.label).font(V3.number(tone.label.count > 3 ? 7 : 8,weight:.bold)).foregroundStyle(tone.color)
            .frame(width:32,height:32).background(tinted ? tone.tint : V3.field,in:RoundedRectangle(cornerRadius:8)).accessibilityHidden(true)
    }
    private func empty(_ title:String,_ subtitle:String,symbol:String) -> some View {
        V3EmptyCard(title:title,message:subtitle,stageHeight:112) { Image(systemName:symbol).font(.system(size:36,weight:.ultraLight)).foregroundStyle(V3.fnt2) } actions: {
            Button { refresh = UUID() } label:{ Image(systemName:"arrow.clockwise").font(.system(size:11)); Text("重新加载") }.buttonStyle(V3ButtonStyle(kind:.ghost,height:34,width:96)).disabled(busy)
        }.frame(maxWidth:.infinity).padding(.top,115)
    }
    /// 06.2 folder table: format / name + status / 关联 / 大小 / 上传日期 (or 重试) / ⋯ or a checkbox in batch mode.
    private var fileList: some View {
        let inside = datasets.filter { folder == "uncategorized" ? $0.folder.isEmpty : $0.folder == folder }
        return VStack(alignment:.leading,spacing:0) {
            if inside.isEmpty { emptyFolders }
            else {
                HStack(spacing:0) {
                    Text("名称").frame(maxWidth:.infinity,alignment:.leading)
                    Text("关联").frame(width:190,alignment:.leading)
                    Text("大小").frame(width:66,alignment:.trailing)
                    Text("上传日期").frame(width:144,alignment:.trailing)
                    Group {
                        if batchMode {
                            Toggle("全选当前列表",isOn:Binding(get:{!visible.isEmpty && visible.allSatisfy{selected.contains($0.id)}},set:{if $0 { selected.formUnion(visible.map(\.id)) } else { selected.subtract(visible.map(\.id)) }}))
                                .labelsHidden().toggleStyle(.checkbox).disabled(visible.isEmpty || busy)
                        } else { Color.clear }
                    }.frame(width:42,alignment:.trailing)
                }
                .font(V3.sans(12)).foregroundStyle(V3.fnt).padding(.leading,12).padding(.trailing,10).padding(.top,22).frame(height:46,alignment:.top)
                .overlay(alignment:.bottom) { Rectangle().fill(V3.line).frame(height:1) }
                if visible.isEmpty { Text("没有匹配的资料。").font(V3.sans(13)).foregroundStyle(V3.fnt).frame(maxWidth:.infinity).padding(.vertical,40) }
                else {
                    VStack(spacing:6) { ForEach(visible) { item in fileRow(item) } }.padding(.top,5)
                }
                if DatasetRequest.id(folder) {
                    Button { pick() } label:{
                        VStack(spacing:4) {
                            HStack(spacing:8) { Image(systemName:"arrow.up.doc").font(.system(size:13)); Text("拖入文件，或点击上传到「\(folderName)」") }.font(V3.sans(12.5,weight:.medium)).foregroundStyle(V3.txt)
                            Text("PDF、DOCX、Markdown、TXT 最大 \(ByteCountFormatter.string(fromByteCount:Int64(limits["max_file_bytes"]?.numberValue ?? 20*1024*1024),countStyle:.file))；音视频最大 \(ByteCountFormatter.string(fromByteCount:maximum,countStyle:.file))")
                                .font(V3.sans(10.5)).foregroundStyle(V3.fnt)
                        }.frame(maxWidth:.infinity).frame(height:52).contentShape(Rectangle())
                        .overlay(RoundedRectangle(cornerRadius:10).stroke(V3.fnt2,style:StrokeStyle(lineWidth:1,dash:[4,3])))
                    }.buttonStyle(.plain).padding(.top,16).disabled(busy || batchMode || !loaded)
                }
            }
        }
    }
    /// `datasetRowMeta`: format name when ready, otherwise the status (blue while processing, red when failed).
    private func rowMeta(_ item:DatasetRecord) -> (String,Color) {
        if item.media {
            if item.raw.text("upload_status") == "failed" { return ("上传失败",V3.red) }
            if item.raw.text("upload_status") == "uploading" { return ("正在上传…",V3.blue) }
            return ((item.raw.text("asset_kind") == "audio" ? "音频" : "视频") + " · 点击下载",V3.fnt)
        }
        if item.raw.text("parse_status") == "failed" || item.raw.text("upload_status") == "failed" {
            let reason = item.raw.text("failure_reason")
            let label = ["format_unsupported":"文件格式不受支持","content_invalid":"文件内容无效","size_exceeded":"文件内容超出解析限制","service_unavailable":"解析服务暂不可用","timeout":"解析超时","quota_exceeded":"当前资料数量已达上限"][reason]
            return (label.map { "解析失败 · " + $0 } ?? "解析失败",V3.red)
        }
        if item.raw.text("parse_status") == "queued" { return ("等待解析",V3.blue) }
        if item.busy { return ("正在解析…",V3.blue) }
        return (["MD":"Markdown","PDF":"PDF","DOCX":"Word","TXT":"纯文本"][item.format] ?? item.format,V3.fnt)
    }
    private func fileRow(_ item:DatasetRecord) -> some View {
        let meta = rowMeta(item)
        let failed = meta.1 == V3.red && !item.media
        return HStack(spacing:0) {
            formatIcon(item)
            VStack(alignment:.leading,spacing:4) {
                Text(item.name).font(V3.sans(14,weight:.medium)).foregroundStyle(V3.txt).lineLimit(1).help(item.name)
                Text(meta.0).font(V3.sans(12)).foregroundStyle(meta.1).lineLimit(1)
            }.padding(.horizontal,12).frame(maxWidth:.infinity,alignment:.leading)
            HStack(spacing:5) {
                if !item.raw.text("interview_label").isEmpty {
                    CareerIcon(name:"calendar",size:13,template:true).foregroundStyle(V3.sub)
                    Text("面试 · " + item.raw.text("interview_label")).lineLimit(1)
                }
            }.font(V3.sans(12)).foregroundStyle(V3.sub).frame(width:190,alignment:.leading)
            Text(item.size).font(V3.number(12,weight:.regular)).foregroundStyle(V3.sub).frame(width:66,alignment:.trailing)
            Group {
                if failed && item.retryable { Button("重试") { Task { await mutate("/api/datasets/" + item.id + "/retry","POST") } }.buttonStyle(.plain).font(V3.sans(12)).foregroundStyle(V3.txt).disabled(busy || batchMode) }
                else { Text(listDate(item.raw.text("created_at"))).font(V3.number(12,weight:.regular)).foregroundStyle(V3.sub) }
            }.frame(width:144,alignment:.trailing)
            Group {
                if batchMode {
                    Toggle("选择「\(item.name)」",isOn:Binding(get:{selected.contains(item.id)},set:{if $0 {selected.insert(item.id)} else {selected.remove(item.id)}})).labelsHidden().toggleStyle(.checkbox).disabled(busy)
                } else {
                    Menu {
                        Button(item.media ? "下载文件" : "查看文件") { open(item) }.disabled(!item.ready)
                        Button("重命名") { show("rename",item.raw) }
                        Button("移动到文件夹") { selected = [item.id]; show("move") }
                        Button("管理关联") { show("associate",item.raw); Task { await loadSessions() } }.disabled(item.raw.text("upload_status") != "succeeded")
                        if item.retryable { Button("重新解析") { Task { await mutate("/api/datasets/" + item.id + "/retry","POST") } } }
                        Divider()
                        Button("删除资料",role:.destructive) { selected = [item.id]; show("deleteBatch") }.disabled(item.busy)
                    } label:{ Image(systemName:"ellipsis").font(.system(size:13)).foregroundStyle(V3.fnt).frame(width:28,height:28) }
                        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().disabled(busy).accessibilityLabel("打开「\(item.name)」操作菜单")
                }
            }.frame(width:42,alignment:.trailing)
        }
        .padding(.leading,12).padding(.trailing,10).frame(height:54)
        .background(RoundedRectangle(cornerRadius:8).fill(hoveredRow == item.id ? Color(hex:0xF6F6F3) : .clear))
        .contentShape(Rectangle())
        .onHover { inside in hoveredRow = inside ? item.id : (hoveredRow == item.id ? nil : hoveredRow) }
        .onTapGesture { if batchMode { if selected.contains(item.id) { selected.remove(item.id) } else { selected.insert(item.id) } } else if item.ready { open(item) } }
    }
    /// `.ds-batch-bar`: floating bar while selecting several datasets.
    private var batchBar: some View {
        HStack(spacing:14) {
            Toggle(isOn:Binding(get:{!visible.isEmpty && visible.allSatisfy{selected.contains($0.id)}},set:{if $0 { selected.formUnion(visible.map(\.id)) } else { selected.subtract(visible.map(\.id)) }})) { Text("全选").font(V3.sans(13)).foregroundStyle(V3.txt) }
                .toggleStyle(.checkbox).disabled(visible.isEmpty || busy)
            HStack(spacing:0) { Text("已选 ").foregroundStyle(V3.sub); Text("\(selected.count)").font(V3.number(13)).foregroundStyle(V3.txt); Text(" 项").foregroundStyle(V3.sub) }.font(V3.sans(13))
            Rectangle().fill(V3.line).frame(width:1,height:20)
            Button { show("move") } label:{ LibraryIcon(name:"icon-folder",size:13); Text("移动到文件夹") }.buttonStyle(V3ButtonStyle(kind:.ghost,height:30)).disabled(selected.isEmpty || busy)
            Button { show("deleteBatch") } label:{ Image(systemName:"trash").font(.system(size:11)); Text("删除") }.buttonStyle(V3ButtonStyle(kind:.danger,height:30)).disabled(selected.isEmpty || busy)
            Rectangle().fill(V3.line).frame(width:1,height:20)
            Button { batchMode = false; selected = [] } label:{ Image(systemName:"xmark").font(.system(size:12,weight:.medium)).foregroundStyle(V3.sub).frame(width:28,height:28) }
                .buttonStyle(.plain).accessibilityLabel("取消选择").help("取消选择并退出批量")
        }
        .padding(.horizontal,16).frame(height:48)
        .background(.white,in:RoundedRectangle(cornerRadius:12)).overlay(RoundedRectangle(cornerRadius:12).stroke(V3.cl))
        .shadow(color:.black.opacity(0.10),radius:16,y:6)
        .padding(.bottom,28)
    }
    private func show(_ kind:String,_ item:JSONValue = .null) {
        guard !busy else { return }; if account.isEmpty { pending = kind == "createFolder" ? kind : "createFolder"; requireAccount(); return }
        target = item; action = kind; sheetError = nil; preview = ""; name = kind == "renameFolder" ? item.text("name") : item.text("file_name"); destination = kind == "associate" ? item.text("interview_session_id") : folders.first?.text("id") ?? ""
    }
    private var sheet: some View {
        VStack(alignment:.leading,spacing:20) {
            HStack(alignment:.top) {
                VStack(alignment:.leading,spacing:5) {
                    Text(sheetTitle).font(V3.serif(20)).foregroundStyle(V3.txt).lineLimit(1)
                    if let description = sheetDescription { Text(description).font(V3.sans(12.5)).foregroundStyle(V3.sub).fixedSize(horizontal:false,vertical:true) }
                }
                Spacer()
                Button { action = nil } label:{ Image(systemName:"xmark").font(.system(size:12,weight:.medium)).foregroundStyle(V3.fnt) }.buttonStyle(.plain).accessibilityLabel("关闭").disabled(busy)
            }
            sheetContent
            if let sheetError { Text(sheetError).foregroundStyle(.red).font(LibraryTypography.sans(12)) }
            if !["preview","media"].contains(action ?? "") {
                HStack(spacing:10) {
                    if action == "associate" && !target.text("interview_session_id").isEmpty { Button("取消关联") { Task { await save(unlink:true) } }.buttonStyle(CareerActionStyle(kind:.danger)).disabled(busy) }
                    Spacer()
                    Button("取消") { action = nil }.buttonStyle(V3ButtonStyle(kind:.ghost,height:36,width:80)).disabled(busy)
                    Button(busy ? "处理中…" : confirmLabel) { Task { await save() } }
                        .buttonStyle(V3ButtonStyle(kind:["deleteFolder","deleteBatch"].contains(action ?? "") ? .danger : .dark,height:36)).disabled(busy || loading)
                }.padding(.top,8)
            }
        }.padding(28).frame(width:["preview","media"].contains(action ?? "") ? 820 : ["associate","move"].contains(action ?? "") ? 520 : 440).frame(minHeight:200,maxHeight:740).interactiveDismissDisabled(busy)
    }
    private var sheetTitle: String {
        switch action {
        case "deleteFolder": return "确认删除文件夹「\(target.text("name"))」？"
        case "deleteBatch": return selected.count == 1 ? "永久删除「\(datasets.first { selected.contains($0.id) }?.name ?? "资料")」？" : "永久删除所选资料（\(selected.count) 份）？"
        default: return ["createFolder":"新建文件夹","renameFolder":"重命名文件夹","rename":"重命名资料","move":"移动到文件夹","associate":"管理关联","preview":"文档预览","media":"音视频预览","uploadRename":"保留两份","replace":"替换现有文档？"][action ?? ""] ?? "资料库"
        }
    }
    private var sheetDescription: String? {
        ["createFolder":"创建分类文件夹，整理和归类求职资料。","renameFolder":"修改文件夹名称，内部资料归属将自动同步。","rename":"只修改资料显示名称，不改变文件格式或已保存的内容。"][action ?? ""]
    }
    private var confirmLabel: String {
        ["createFolder":"创建文件夹","rename":"保存名称","deleteFolder":"确认删除","deleteBatch":selected.count == 1 ? "永久删除" : "永久删除所选","replace":"确认替换","move":"移动"][action ?? ""] ?? "保存"
    }
    @ViewBuilder private var sheetContent: some View {
        if ["createFolder","renameFolder","rename","uploadRename"].contains(action ?? "") {
            VStack(alignment:.leading,spacing:8) {
                Text(["createFolder":"文件夹名称","renameFolder":"文件夹名称"][action ?? ""] ?? "资料名称").font(V3.sans(12)).foregroundStyle(V3.sub)
                TextField("",text:$name,prompt:Text(action == "createFolder" ? "例如：核心项目、工作复盘、资格证书" : "").foregroundStyle(V3.fnt2)).textFieldStyle(.plain).font(V3.sans(13))
                    .padding(.horizontal,12).frame(height:40).background(.white,in:RoundedRectangle(cornerRadius:8)).overlay(RoundedRectangle(cornerRadius:8).stroke(V3.cl))
                    .onSubmit { Task { await save() } }.disabled(busy)
            }
        }
        else if action == "move" { Text("移动 \(selected.count) 份资料"); Picker("目标文件夹",selection:$destination) { Text("请选择").tag(""); ForEach(folders,id:\.self) { Text($0.text("name")).tag($0.text("id")) } }.disabled(busy) }
        else if action == "deleteFolder" { Text("将永久删除该文件夹及其中的 \(target["dataset_count"]?.integer ?? 0) 份资料，包括源文件和解析结果，删除后无法恢复。").font(V3.sans(13)).foregroundStyle(V3.sub).fixedSize(horizontal:false,vertical:true) }
        else if action == "deleteBatch" {
            Text(selected.count == 1 ? "删除后将移除源文件、解析结果和资料记录，且无法恢复。" : "将删除所选 \(selected.count) 份资料，移除源文件、解析结果和资料记录，且无法恢复。").font(V3.sans(13)).foregroundStyle(V3.sub).fixedSize(horizontal:false,vertical:true)
            if selected.count > 1 { ScrollView { VStack(alignment:.leading,spacing:8) { ForEach(datasets.filter{selected.contains($0.id)}) { Text($0.name).font(V3.sans(12)).foregroundStyle(V3.sub) } } }.frame(maxHeight:160) }
        }
        else if action == "associate" { Text("一份资料最多关联一场面试。换场次先解除旧关联，新关联失败时旧关联不会自动恢复。").font(LibraryTypography.sans(12)).foregroundStyle(.secondary); Picker("面试场次",selection:$destination) { Text("请选择").tag(""); ForEach(sessions,id:\.self) { Text($0.text("company_name") + " · " + $0.text("job_title") + " · " + $0.text("stage_label") + " " + date($0.text("start_at"))).tag($0.text("id")) } }.disabled(busy) }
        else if action == "preview" { Text(target.text("file_name")).font(LibraryTypography.sans(12)).foregroundStyle(.secondary); if loading { ProgressView() } else if preview.isEmpty { Button("重新读取正文") { Task { await loadPreview() } } } else { ScrollView { NativeMarkdownView(source:preview).frame(maxWidth:.infinity,alignment:.leading) }.frame(minHeight:300,maxHeight:600) } }
        else if action == "media" { if let player { VideoPlayer(player:player).frame(height:380) } else if loading { ProgressView("正在读取私有媒体…") } else { Text("媒体不可用，请下载原文件重试。") } }
        else if action == "replace" { Text("确认使用当前上传文件替换「\(target.text("file_name"))」？旧原文件和解析结果会被删除，不可恢复；保留资料 ID、文件夹和面试关联。") }
    }
    private func load(poll:Bool = false) async {
        let generation = UUID(); loadID = generation
        guard !account.isEmpty else { loaded = true; return }; loading = true; error = nil
        do {
            repeat {
                async let files = request("/api/datasets")
                async let groups = request("/api/datasets/folders")
                let (data,group) = try await (files,groups); try Task.checkCancellation(); guard active, loadID == generation else { return }
                datasets = (data["datasets"]?.items ?? []).map(DatasetRecord.init); folders = group["folders"]?.items ?? []; limits = data["limits"] ?? .null; loaded = true; loading = false; selected.formIntersection(datasets.map(\.id))
                if !folder.isEmpty && folder != "uncategorized" && !folders.contains(where:{$0.text("id")==folder}) { folder = ""; history = [] }
                if !poll || !datasets.contains(where:{$0.busy}) { break }; try await Task.sleep(for:.seconds(3))
            } while !Task.isCancelled
        } catch { if active && loadID == generation && !(error is CancellationError) { self.error = explain(error) } }
        if active && loadID == generation && !Task.isCancelled { loading = false }
    }
    private func mutate(_ path:String,_ method:String,_ body:JSONValue? = nil,query:[String:String] = [:]) async { guard !busy else { return }; busy = true; error = nil; do { _ = try await request(path,method,body,query:query); notice = "已保存"; await load() } catch { if !(error is CancellationError) { self.error = explain(error) } }; busy = false; refresh = UUID() }
    private func save(unlink:Bool = false) async {
        guard !busy else { return }; busy = true; sheetError = nil
        do {
            switch action {
            case "createFolder": _ = try await request("/api/datasets/folders","POST",.object(["name":.string(name)]))
            case "renameFolder": _ = try await request("/api/datasets/folders/" + target.text("id"),"PATCH",.object(["name":.string(name)]))
            case "rename": _ = try await request("/api/datasets/" + target.text("id"),"PATCH",.object(["name":.string(name)]))
            case "move": guard DatasetRequest.id(destination) else { throw APIError.invalidResponse }; _ = try await request("/api/datasets/move-batch","POST",.object(["folder_id":.string(destination),"dataset_ids":.array(selected.sorted().map(JSONValue.string))])); selected = []
            case "deleteFolder": _ = try await request("/api/datasets/folders/" + target.text("id"),"DELETE",query:["confirm_contents":"true"])
            case "deleteBatch":
                var failures:[String] = []; var removed = 0
                for item in datasets.filter({selected.contains($0.id)}) { do { _ = try await request("/api/datasets/" + item.id,"DELETE"); selected.remove(item.id); removed += 1 } catch { if error is CancellationError { throw error }; failures.append(item.name + "：" + explain(error)) } }
                notice = "已删除 \(removed) 份资料"; if !failures.isEmpty { throw APIError.server(status:409,code:failures.joined(separator:"；")) }
            case "associate":
                let old = target.text("interview_session_id"), id = target.text("id")
                if !old.isEmpty && (unlink || old != destination) { _ = try await request("/api/interview-sessions/" + old + "/assets/" + id,"DELETE"); target = .object(["id":.string(id),"file_name":target["file_name"] ?? .null]); notice = "旧关联已解除" }
                if !unlink && destination != old { guard DatasetRequest.id(destination) else { throw APIError.invalidResponse }; _ = try await request("/api/interview-sessions/" + destination + "/assets/attach","POST",.object(["dataset_id":.string(id)])) }
            case "uploadRename":
                guard let index = queue.firstIndex(where:{$0.id==queueID}), !name.isEmpty else { throw APIError.invalidResponse }
                let ext = URL(fileURLWithPath:queue[index].upload.name).pathExtension
                queue[index].upload.name = name.lowercased().hasSuffix("." + ext.lowercased()) ? name : name + "." + ext; queue[index].upload = queue[index].upload.rekey(); queue[index].status = "selected"; queue[index].message = "等待重新上传"
            case "replace":
                guard let index = queue.firstIndex(where:{$0.id==queueID}), target.text("asset_kind") == "document" else { throw APIError.invalidResponse }
                queue[index].upload.replacing = target.text("id"); queue[index].upload.revision = target.text("content_revision"); queue[index].upload.name = target.text("file_name"); queue[index].upload = queue[index].upload.rekey(); queue[index].status = "selected"; queue[index].message = "已确认替换，等待上传"
            default: break
            }
            action = nil; await load()
        } catch { if !(error is CancellationError) { sheetError = explain(error); await load() } }
        busy = false; refresh = UUID()
    }
    private func loadSessions() async {
        loading = true; do { var values:[JSONValue] = [], cursor = ""; var seen = Set<String>(); repeat { var query = ["limit":"500"]; if !cursor.isEmpty { query["cursor"] = cursor }; let data = try await request("/api/interview-sessions",query:query); values += data["items"]?.items ?? []; cursor = data.text("next_cursor"); if !cursor.isEmpty && !seen.insert(cursor).inserted { throw APIError.invalidResponse } } while !cursor.isEmpty; sessions = values } catch { if !(error is CancellationError) { sheetError = explain(error) } }; loading = false
    }
    private func open(_ item:DatasetRecord) { guard !busy else { return }; if !item.ready { notice = "\(item.status)，暂时无法预览。"; return }; if item.media { show("media",item.raw); Task { await loadMedia(item) } } else { show("preview",item.raw); Task { await loadPreview() } } }
    private func loadPreview() async { let id = target.text("id"); loading = true; sheetError = nil; do { let data = try await request("/api/datasets/" + id + "/content"); if action == "preview" && target.text("id") == id { preview = data.text("markdown") } } catch { if !(error is CancellationError) { sheetError = explain(error) } }; loading = false }
    private func loadMedia(_ item:DatasetRecord) async {
        let owner = account; loading = true
        do { let file = try await session.api.downloadDataset(id:item.id,limit:maximum); var retained = false; defer { if !retained { file.discard() } }; guard active, owner == account, action == "media", target.text("id") == item.id else { file.discard(); throw CancellationError() }; let playable = file.url.deletingLastPathComponent().appendingPathComponent("preview." + item.format.lowercased()); try FileManager.default.moveItem(at:file.url,to:playable); mediaFile = file; retained = true; player = AVPlayer(url:playable) }
        catch { if active && owner == account && !(error is CancellationError) { sheetError = explain(error) } }
        if active && owner == account { loading = false }
    }
    private func download(_ item:DatasetRecord) async {
        guard !busy else { return }; let panel = NSSavePanel(); panel.nameFieldStringValue = item.name; guard panel.runModal() == .OK, let destination = panel.url else { return }
        let owner = account; busy = true; error = nil
        do { let file = try await session.api.downloadDataset(id:item.id,limit:maximum); defer { file.discard() }; guard owner == account && !owner.isEmpty else { throw CancellationError() }; let allowed = destination.startAccessingSecurityScopedResource(); defer { if allowed { destination.stopAccessingSecurityScopedResource() } }; if FileManager.default.fileExists(atPath:destination.path) { _ = try FileManager.default.replaceItemAt(destination,withItemAt:file.url) } else { try FileManager.default.copyItem(at:file.url,to:destination) }; notice = "已保存「\(item.name)」" } catch { if active && owner == account && !(error is CancellationError) { self.error = explain(error) } }; if active && owner == account { busy = false }
    }
    private func pick() { guard !busy, !account.isEmpty, DatasetRequest.id(folder) else { if account.isEmpty { pending = "createFolder"; requireAccount() }; return }; let panel = NSOpenPanel(); panel.allowsMultipleSelection = true; panel.canChooseDirectories = false; let configured = (limits["allowed_extensions"]?.items ?? []) + (limits["media_allowed_extensions"]?.items ?? []); let extensions = configured.compactMap(\.stringValue); panel.allowedContentTypes = (extensions.isEmpty ? ["pdf","docx","md","txt","webm","m4a","mp3","wav","ogg","mp4","mov"] : extensions).compactMap{UTType(filenameExtension:$0.trimmingCharacters(in:CharacterSet(charactersIn:".")))}; guard panel.runModal() == .OK else { return }; let targetFolder = folder; Task { await enqueue(panel.urls,into:targetFolder) } }
    private func enqueue(_ urls:[URL],into targetFolder:String) async {
        let owner = account; guard !owner.isEmpty else { return }
        let batch = max(1,limits["max_files_per_batch"]?.integer ?? 10)
        for url in urls.prefix(max(0,batch - queue.filter{$0.status != "accepted"}.count)) {
            let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
            do { let media = ["webm","m4a","mp3","wav","ogg","mp4","mov"].contains(url.pathExtension.lowercased()); let limit = media ? maximum : min(maximum,Int64(limits["max_file_bytes"]?.numberValue ?? 20*1024*1024)); let upload = try await Task.detached { try DatasetUpload.snapshot(url,folder:targetFolder,limit:limit) }.value; guard active, owner == account, queue.filter({$0.status != "accepted"}).count < batch else { upload.discard(); return }; queue.append(LibraryQueued(upload:upload)) } catch { if active && owner == account { self.error = "\(url.lastPathComponent)：" + explain(error) } }
        }
        if urls.count > batch { notice = "每批最多 \(batch) 个文件，超出部分未加入。" }
    }
    private var uploadQueue: some View {
        VStack(alignment:.leading,spacing:12) {
            HStack { Text("上传队列").font(.headline); Spacer(); Button("上传 / 重试") { uploadTask = Task { await uploadAll() } }.buttonStyle(WebActionStyle()).disabled(busy) }
            ForEach(queue) { item in
                HStack { VStack(alignment:.leading,spacing:5) { Text(item.upload.name); Text((folders.first{$0.text("id")==item.upload.folder}?.text("name") ?? "文件夹") + " · " + item.message).font(LibraryTypography.sans(11)).foregroundStyle(item.status == "unknown" ? .orange:.secondary) }; Spacer()
                    if item.status == "conflict" { Button("保留两份") { queueID = item.id; show("uploadRename"); name = item.upload.name }; if let existing = datasets.first(where:{$0.folder==item.upload.folder && $0.name.precomposedStringWithCanonicalMapping==item.upload.name.precomposedStringWithCanonicalMapping}), !existing.media { Button("替换…") { queueID = item.id; show("replace",existing.raw) } } }
                    if item.status != "uploading" { Button(item.status == "accepted" ? "关闭":"移出") { item.upload.discard(); queue.removeAll{$0.id==item.id} } }
                }.disabled(busy)
            }
            Text("目标文件夹已固定。结果不确定时沿用原标识重试；退出账号或离开资料库会清理临时文件。").font(LibraryTypography.sans(11)).foregroundStyle(.secondary)
        }.padding(20).background(Color(hex:0xF7F7F4),in:RoundedRectangle(cornerRadius:14))
    }
    private func uploadAll() async {
        guard !busy else { return }; let owner = account; busy = true; error = nil
        for id in queue.filter({["selected","unknown","rejected"].contains($0.status)}).map(\.id) {
            guard let index = queue.firstIndex(where:{$0.id==id}), owner == account, !Task.isCancelled else { break }
            let upload = queue[index].upload; queue[index].status = "uploading"; queue[index].message = "正在上传…"
            do { _ = try await session.api.uploadDataset(upload); guard active, owner == account else { break }; if let index = queue.firstIndex(where:{$0.id==id}) { queue[index].status = "accepted"; queue[index].message = "服务器已接受"; upload.discard() } }
            catch { guard active, owner == account, let index = queue.firstIndex(where:{$0.id==id}) else { break }; if case APIError.server(let status,let code) = error, (400..<500).contains(status) { queue[index].status = code.contains("CONFLICT") ? "conflict":"rejected"; queue[index].upload = upload.rekey(); queue[index].message = explain(error) } else { queue[index].status = "unknown"; queue[index].message = "结果尚未确认；重试沿用原标识。" } }
        }
        if owner == account { busy = false; await load(); refresh = UUID() }
    }
    private func date(_ value:String,format pattern:String = "yyyy-MM-dd") -> String { guard let date = CareerApplication.date(value) else { return "—" }; let format = DateFormatter(); format.dateFormat = pattern; return format.string(from:date) }
    private func explain(_ error:Error) -> String {
        if case APIError.unauthorized = error { return "登录已失效，请重新登录。" }
        if case APIError.server(_,let code) = error { return ["FOLDER_NAME_CONFLICT":"文件夹名称已存在。", "DATASET_NAME_CONFLICT":"同一文件夹已有同名文件，请选择保留两份或确认替换。", "DATASET_FILENAME_CONFLICT":"同一文件夹已有同名文件，请选择保留两份或确认替换。", "DATASET_IN_PROGRESS":"资料正在处理，暂时不能删除或替换。", "DATASET_NOT_RETRYABLE":"只有解析失败的文档可重新解析。", "DATASET_FILE_TOO_LARGE":"文件超出上传限制。", "INVALID_DATASET_NAME":"名称无效，请去除路径符号或控制字符。", "DATASET_ALREADY_LINKED":"已关联其他面试，请刷新后重试。", "FOLDER_NOT_FOUND":"文件夹已不存在，请刷新后选择。", "DATASET_NOT_FOUND":"资料已不存在或不可访问。", "ASSET_DELETE_FAILED":"原文件清理失败，请刷新确认后重试。", "DATASET_BUSY":"资料正在处理，暂时不能删除或替换。", "FOLDER_NAME_DUPLICATE":"文件夹名称已存在。", "DATASET_CONTENT_CONFLICT":"资料已更新，请刷新后重新确认替换。", "PRECONDITION_FAILED":"资料已更新，请刷新后重新确认替换。"][code] ?? "操作未完成（\(code)）。请刷新确认状态后再试。" }
        return "连接失败，结果尚未确认。请刷新或沿用原标识重试。"
    }
}

private struct LibraryCreateButtonStyle: ButtonStyle {
    func makeBody(configuration:Configuration) -> some View {
        configuration.label.font(LibraryTypography.sans(12,weight:.medium)).foregroundStyle(.white)
            .frame(width:120,height:32).background(Color(hex:0x1D1D1B).opacity(configuration.isPressed ? 0.8:1),in:RoundedRectangle(cornerRadius:7))
    }
}

enum LibraryTypography {
    static let registered: Void = {
        for (name,ext) in [("LibrarySans-Regular","otf"),("LibrarySerif-SemiBold","ttf")] {
            if let url = Bundle.module.url(forResource:name,withExtension:ext,subdirectory:"Library") {
                CTFontManagerRegisterFontsForURL(url as CFURL,.process,nil)
            }
        }
    }()
    static func sans(_ size:CGFloat,weight:Font.Weight = .regular) -> Font {
        _ = registered
        return .custom("DrawOfferLibrarySans-Regular",size:size).weight(weight)
    }
    static func serif(_ size:CGFloat) -> Font {
        _ = registered
        return .custom("DrawOfferLibrarySerif-SemiBold",size:size)
    }
}

private struct LibraryIcon: View {
    let name:String
    let size:CGFloat
    var body:some View {
        if let url = Bundle.module.url(forResource:name,withExtension:"png",subdirectory:"Library"), let image = NSImage(contentsOf:url) {
            Image(nsImage:image).resizable().frame(width:size,height:size).accessibilityHidden(true)
        }
    }
}
