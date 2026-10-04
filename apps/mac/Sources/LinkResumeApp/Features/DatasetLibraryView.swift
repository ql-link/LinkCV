import AppKit
import AVKit
import CoreText
import Foundation
import LinkResumeCore
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
            VStack(alignment:.leading,spacing:24) {
                header
                if loading && !loaded { ProgressView("正在加载资料与文件夹…").frame(maxWidth:.infinity,minHeight:250) }
                else if !account.isEmpty && !loaded { VStack { empty("加载失败","资料与文件夹暂不可用，请重新加载。",symbol:"exclamationmark.arrow.triangle.2.circlepath"); Button("重新加载") { refresh = UUID() }.disabled(busy) } }
                else if folder.isEmpty { root }
                else { fileList }
                if let error { HStack { Text(error).font(LibraryTypography.sans(13)).foregroundStyle(.red); Spacer(); Button("重新加载") { refresh = UUID() }.disabled(busy) } }
                if let notice { Text(notice).font(LibraryTypography.sans(13)).foregroundStyle(.secondary) }
                if !queue.isEmpty { uploadQueue }
            }.padding(.horizontal,32).padding(.top,52).padding(.bottom,40).frame(maxWidth:924).frame(maxWidth:.infinity,alignment:.top)
        }.task(id:account + refresh.uuidString) { active = true; await load(poll:true) }
            .onChange(of:account) { _, id in
                player?.pause(); player = nil; mediaFile?.discard(); mediaFile = nil; uploadTask?.cancel(); queue.forEach { $0.upload.discard() }; queue = []; action = nil; selected = []; inspected = ""; datasets = []; folders = []; loaded = false; limits = .null; preview = ""; error = nil; sheetError = nil; notice = nil; busy = false; folder = ""; history = []; query = ""; sessions = []
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
    private var header: some View {
        VStack(alignment:.leading,spacing:0) {
            HStack(alignment:.top,spacing:24) {
                VStack(alignment:.leading,spacing:0) {
                    Text("DATASETS").font(LibraryTypography.sans(11)).foregroundStyle(Color(hex:0x96968F)).frame(height:13,alignment:.top)
                    Text(folderName).font(LibraryTypography.serif(28)).foregroundStyle(Color(hex:0x1D1D1B)).frame(height:40,alignment:.leading).padding(.top,9)
                    Text(folder.isEmpty && (!datasets.isEmpty || !folders.isEmpty) ? "\(datasets.count) 份资料 · \(folders.count) 个文件夹" : "把履历、项目记录和参考资料集中在这里，写简历时随时调用。")
                        .font(LibraryTypography.sans(13)).foregroundStyle(Color(hex:0x55554F)).frame(minHeight:19,alignment:.leading).padding(.top,6)
                }.frame(maxWidth:.infinity,alignment:.leading)
                HStack(spacing:10) {
                    HStack(spacing:7) {
                        LibraryIcon(name:"icon-search",size:13)
                        TextField("搜索资料…",text:$query).textFieldStyle(.plain).font(LibraryTypography.sans(12))
                    }.padding(.horizontal,12).frame(width:200,height:32).background(Color(hex:0xF4F4F2),in:RoundedRectangle(cornerRadius:8))
                    Button("新建文件夹") { show("createFolder") }.buttonStyle(LibraryCreateButtonStyle()).disabled(busy)
                }.padding(.top,32)
            }
            Rectangle().fill(Color(hex:0xECECEA)).frame(height:1).padding(.top,21)
            if !folder.isEmpty {
                HStack(spacing:12) {
                    if !history.isEmpty { Button("‹ 返回") { folder = history.removeLast(); selected = []; query = "" }.disabled(busy) }
                    Button("资料库") { navigate("") }.buttonStyle(.plain).disabled(busy)
                    Text("/ " + folderName).font(LibraryTypography.sans(12)).foregroundStyle(.secondary)
                    Spacer()
                    Picker("筛选",selection:$filter) { Text("全部").tag("all"); Text("文档").tag("document"); Text("音频").tag("audio"); Text("视频").tag("video"); Text("可用").tag("ready"); Text("处理中").tag("processing"); Text("失败").tag("failed") }.frame(width:140)
                    Button { refresh = UUID() } label:{ Image(systemName:"arrow.clockwise") }.help("刷新资料库").disabled(busy)
                    if DatasetRequest.id(folder) { Button("上传文件") { pick() }.buttonStyle(WebActionStyle()).disabled(busy || !loaded) }
                }.padding(.top,24)
            }
        }
    }
    private var emptyFolders: some View {
        VStack(alignment:.leading,spacing:0) {
            if let url = Bundle.module.url(forResource:"empty-folders",withExtension:"png",subdirectory:"Library"), let illustration = NSImage(contentsOf:url) {
                Image(nsImage:illustration).resizable().aspectRatio(504.0/200,contentMode:.fit)
                    .clipShape(RoundedRectangle(cornerRadius:11)).padding(8)
                    .accessibilityHidden(true)
            }
            Text("还没有文件夹").font(LibraryTypography.serif(18))
                .foregroundStyle(Color(hex:0x1D1D1B)).frame(height:26,alignment:.leading).padding(.horizontal,32).padding(.top,14)
            Text("建议先新建文件夹分类整理，后续写简历时可以快速检索和引用相关资料。")
                .font(LibraryTypography.sans(13)).foregroundStyle(Color(hex:0x55554F)).lineSpacing(4)
                .frame(maxWidth:.infinity,minHeight:22,alignment:.leading).padding(.horizontal,32).padding(.top,8).padding(.bottom,32)
        }.frame(maxWidth:520,alignment:.leading)
            .background(.white,in:RoundedRectangle(cornerRadius:16))
            .overlay(RoundedRectangle(cornerRadius:16).stroke(Color(hex:0xE4E4E0),lineWidth:1))
            .shadow(color:.black.opacity(0.04),radius:8,x:0,y:4)
            .frame(maxWidth:.infinity).padding(.top,35)
    }
    private func navigate(_ id:String) { guard !busy else { return }; history.append(folder); folder = id; selected = []; inspected = ""; query = "" }
    private var root: some View {
        VStack(alignment:.leading,spacing:12) {
            if folders.isEmpty && datasets.isEmpty { emptyFolders }
            else {
            HStack { Text("文件夹").font(LibraryTypography.sans(13,weight:.medium)); Spacer(); Text("按最近更新").font(LibraryTypography.sans(11)).foregroundStyle(Color(hex:0x96968F)) }
            LazyVGrid(columns:[GridItem(.adaptive(minimum:260),spacing:20)],spacing:20) {
                ForEach(folders.filter { query.isEmpty || $0.text("name").localizedCaseInsensitiveContains(query) },id:\.self) { item in folderCard(item) }
                if datasets.contains(where:{$0.folder.isEmpty}) { folderCard(.object(["id":.string("uncategorized"),"name":.string("未分类"),"dataset_count":.number(Double(datasets.filter{$0.folder.isEmpty}.count))])) }
                Button { show("createFolder") } label:{ VStack(spacing:12) { LibraryIcon(name:"icon-plus",size:16).frame(width:36,height:36).background(Color(hex:0xF4F4F2),in:Circle()); Text("新建文件夹").font(LibraryTypography.sans(13,weight:.medium)); Text("按求职用途分类，最多 50 个").font(LibraryTypography.sans(11)).foregroundStyle(.secondary) }.frame(maxWidth:.infinity).frame(height:172).overlay(RoundedRectangle(cornerRadius:16).stroke(Color(hex:0xC4C4BE),style:StrokeStyle(lineWidth:1,dash:[4,3]))) }.buttonStyle(.plain).disabled(busy)
            }

                Text(query.isEmpty ? "最近上传" : "搜索结果").font(LibraryTypography.sans(13,weight:.medium)).padding(.top,20)
                let recent = query.isEmpty ? Array(visible.prefix(5)) : visible
                VStack(spacing:0) {
                    ForEach(recent) { item in
                        HStack(spacing:12) {
                            formatIcon(item)
                            Button(item.name) { navigate(item.folder.isEmpty ? "uncategorized" : item.folder); inspected = item.id }.buttonStyle(.plain).font(LibraryTypography.sans(13,weight:.medium)).lineLimit(1).frame(maxWidth:.infinity,alignment:.leading)
                            if !item.folder.isEmpty { Button { navigate(item.folder) } label:{ HStack(spacing:5) { LibraryIcon(name:"icon-folder",size:13); Text(folders.first{$0.text("id")==item.folder}?.text("name") ?? "文件夹") }.font(LibraryTypography.sans(11)).foregroundStyle(Color(hex:0x55554F)).padding(.horizontal,8).padding(.vertical,4).background(Color(hex:0xF4F4F2),in:Capsule()) }.buttonStyle(.plain) }
                            Spacer(minLength:12)
                            if !item.ready { Text(item.status).font(LibraryTypography.sans(11)).foregroundStyle(.secondary) }
                            Text(date(item.raw.text("created_at"))).font(LibraryTypography.sans(11)).foregroundStyle(Color(hex:0x96968F)).frame(width:90,alignment:.trailing)
                        }.frame(height:55)
                        if item.id != recent.last?.id { Rectangle().fill(Color(hex:0xECECEA)).frame(height:1) }
                    }
                    if recent.isEmpty { Text("没有匹配的资料。").foregroundStyle(.secondary).padding(20) }
                }.padding(.horizontal,18).background(.white,in:RoundedRectangle(cornerRadius:16)).overlay(RoundedRectangle(cornerRadius:16).stroke(Color(hex:0xE4E4E0))).shadow(color:.black.opacity(0.04),radius:8,x:0,y:4)
                Text("写简历或和 AI 助手对话时，可以通过「添加资料」选择要引用的文件。").font(LibraryTypography.sans(11)).foregroundStyle(Color(hex:0x96968F)).padding(.top,8)

            }

        }
    }
    private func folderCard(_ item:JSONValue) -> some View {
        let records = datasets.filter { $0.folder == item.text("id") }
        let count = item["dataset_count"]?.integer ?? records.count
        let art = count == 0 ? "folder-empty" : count < 3 ? "folder-project" : "folder-documents"
        return Button { navigate(item.text("id")) } label:{
            VStack(alignment:.leading,spacing:0) {
                if let url = Bundle.module.url(forResource:art,withExtension:"png",subdirectory:"Library"), let image = NSImage(contentsOf:url) {
                    Image(nsImage:image).resizable().scaledToFill().frame(height:96).clipped().clipShape(RoundedRectangle(cornerRadius:11)).padding(8).accessibilityHidden(true)
                }
                Text(item.text("name")).font(LibraryTypography.sans(14,weight:.medium)).lineLimit(1).padding(.leading,18).padding(.trailing,42).padding(.top,6)
                Text(count == 0 ? "空文件夹 · 进入后上传资料" : "\(count) 份资料" + (records.first.map { " · 最近上传 " + date($0.raw.text("created_at")) } ?? ""))
                    .font(LibraryTypography.sans(11)).foregroundStyle(Color(hex:0x96968F)).lineLimit(1).padding(.horizontal,18).padding(.top,4)
                Spacer(minLength:0)
            }.frame(maxWidth:.infinity).frame(height:172).background(.white,in:RoundedRectangle(cornerRadius:16)).overlay(RoundedRectangle(cornerRadius:16).stroke(Color(hex:0xE4E4E0))).shadow(color:.black.opacity(0.04),radius:8,x:0,y:4)
        }.buttonStyle(.plain).overlay(alignment:.topTrailing) {
            if DatasetRequest.id(item.text("id")) { Menu { Button("重命名") { show("renameFolder",item) }; Button("删除文件夹及其中资料",role:.destructive) { show("deleteFolder",item) } } label:{LibraryIcon(name:"icon-more",size:14)}.menuStyle(.borderlessButton).frame(width:20).padding(.top,119).padding(.trailing,18).disabled(busy) }
        }
    }
    private func formatIcon(_ item:DatasetRecord) -> some View { Text(item.format).font(LibraryTypography.sans(8,weight:.bold)).foregroundStyle(item.media ? Color(hex:0x7763AE) : item.format == "PDF" ? Color(hex:0xD64545) : item.format == "MD" ? Color(hex:0x3B9A5B) : Color(hex:0x3F6FD8)).frame(width:32,height:32).background(Color(hex:0xF4F4F2),in:RoundedRectangle(cornerRadius:8)) }
    private func empty(_ title:String,_ subtitle:String,symbol:String) -> some View { VStack(spacing:16) { Image(systemName:symbol).font(LibraryTypography.sans(64,weight:.ultraLight)).foregroundStyle(Color(hex:0xD2D2CC)); Text(title).font(.custom("Songti SC",size:20).weight(.semibold)); Text(subtitle).font(LibraryTypography.sans(13)).foregroundStyle(.secondary) }.frame(maxWidth:.infinity,minHeight:230) }
    private var fileList: some View {
        ViewThatFits(in:.horizontal) {
            HStack(alignment:.top,spacing:24) { fileTable.frame(minWidth:650); if let item = datasets.first(where:{$0.id==inspected}) { inspector(item).frame(width:260) } }
            VStack(alignment:.leading,spacing:24) { fileTable; if let item = datasets.first(where:{$0.id==inspected}) { inspector(item) } }
        }
    }
    private func inspector(_ item:DatasetRecord) -> some View {
        VStack(alignment:.leading,spacing:16) {
            HStack { Text("资料详情").font(LibraryTypography.sans(14,weight:.semibold)); Spacer(); Button { inspected = "" } label:{Image(systemName:"xmark")} }
            formatIcon(item); Text(item.name).font(LibraryTypography.sans(14,weight:.medium)).textSelection(.enabled)
            Text(detailSummary(item)).font(LibraryTypography.sans(12)).foregroundStyle(.secondary)
            if !item.raw.text("failure_reason").isEmpty { Text(item.raw.text("failure_reason")).font(LibraryTypography.sans(12)).foregroundStyle(.red) }
            Button(item.media ? "播放音视频" : "查看文件") { open(item) }.buttonStyle(WebActionStyle()).disabled(!item.ready)
            Button("下载原文件") { Task { await download(item) } }.disabled(item.raw.text("upload_status") != "succeeded")
            Group {
            Button("重命名") { show("rename",item.raw) }
            Button("移动到文件夹") { selected = [item.id]; show("move") }
            Button("管理关联") { show("associate",item.raw); Task { await loadSessions() } }
            if item.retryable { Button("重新解析") { Task { await mutate("/api/datasets/" + item.id + "/retry","POST") } } }
            Button("删除资料…",role:.destructive) { selected = [item.id]; show("deleteBatch") }.disabled(item.busy)
            }
        }.frame(maxWidth:.infinity,alignment:.leading).padding(20).background(Color(hex:0xF8F8F5),in:RoundedRectangle(cornerRadius:14)).disabled(busy)
    }
    private func detailSummary(_ item:DatasetRecord) -> String {
        let association = item.raw.text("interview_label").isEmpty ? "未关联" : item.raw.text("interview_label")
        return ["状态：" + item.status,"大小：" + item.size,"上传：" + date(item.raw.text("created_at")),"关联：" + association].joined(separator:"\n")
    }
    private var fileTable: some View {
        VStack(alignment:.leading,spacing:16) {
            HStack { Toggle("全选",isOn:Binding(get:{!visible.isEmpty && visible.allSatisfy{selected.contains($0.id)}},set:{if $0 { selected.formUnion(visible.map(\.id)) } else { selected.subtract(visible.map(\.id)) }})).toggleStyle(.checkbox); Text("名称").frame(maxWidth:.infinity,alignment:.leading); Text("关联").frame(width:160,alignment:.leading); Text("大小").frame(width:80,alignment:.trailing); Text("上传日期").frame(width:100,alignment:.trailing); Spacer().frame(width:28) }.font(LibraryTypography.sans(11)).foregroundStyle(.secondary).disabled(busy)
            Divider()
            ForEach(visible) { item in fileRow(item) }
            if visible.isEmpty { empty(datasets.contains{$0.folder==folder} ? "没有匹配的资料" : "还没有资料","上传文档和音视频，集中管理你的个人材料。",symbol:"doc.badge.plus") }
            if DatasetRequest.id(folder) { Button { pick() } label:{VStack(spacing:5) { Label("拖入文件，或点击上传到「\(folderName)」",systemImage:"arrow.up.doc"); Text("PDF、Word、Markdown、纯文本与音视频 · 最多 \(limits["max_files_per_batch"]?.integer ?? 10) 个文件").font(LibraryTypography.sans(11)).foregroundStyle(.secondary) }.frame(maxWidth:.infinity).padding(16).overlay(RoundedRectangle(cornerRadius:10).stroke(Color(hex:0xCACAC5),style:StrokeStyle(lineWidth:1,dash:[4,3]))) }.buttonStyle(.plain).disabled(busy || !loaded) }
            if !selected.isEmpty { HStack { Text("已选择 \(selected.count) 份"); Button("移动到文件夹") { show("move") }; Button("删除所选",role:.destructive) { show("deleteBatch") }; Spacer(); Button("取消选择") { selected = [] } }.padding(16).background(Color(hex:0xF4F4F1),in:RoundedRectangle(cornerRadius:12)).disabled(busy) }
        }
    }
    private func fileRow(_ item:DatasetRecord) -> some View {
        HStack(spacing:12) {
            Toggle("选择 \(item.name)",isOn:Binding(get:{selected.contains(item.id)},set:{if $0 {selected.insert(item.id)} else {selected.remove(item.id)}})).labelsHidden().toggleStyle(.checkbox).disabled(busy)
            formatIcon(item)
            Button { inspected = item.id } label:{ VStack(alignment:.leading,spacing:5) { Text(item.name).font(LibraryTypography.sans(13,weight:.medium)).lineLimit(1); Text(item.status + (item.raw.text("failure_reason").isEmpty ? "" : " · " + item.raw.text("failure_reason"))).font(LibraryTypography.sans(11)).foregroundStyle(item.status.contains("失败") ? .red : .secondary) }.frame(maxWidth:.infinity,alignment:.leading) }.buttonStyle(.plain).disabled(busy)
            Button { show("associate",item.raw); Task { await loadSessions() } } label:{Text(item.raw.text("interview_label").isEmpty ? "未关联" : item.raw.text("interview_label")).font(LibraryTypography.sans(12)).lineLimit(1).frame(width:160,alignment:.leading)}.buttonStyle(.plain).disabled(busy || item.raw.text("upload_status") != "succeeded")
            Text(item.size).font(LibraryTypography.sans(12)).frame(width:80,alignment:.trailing); Text(date(item.raw.text("created_at"))).font(LibraryTypography.sans(12)).foregroundStyle(.secondary).frame(width:100,alignment:.trailing)
            Menu { Button(item.media ? "下载原文件" : "查看文档") { open(item) }.disabled(!item.ready); Button("下载原文件") { Task { await download(item) } }.disabled(item.raw.text("upload_status") != "succeeded"); Button("重命名") { show("rename",item.raw) }; Button("移动到文件夹") { selected = [item.id]; show("move") }; Button("管理关联") { show("associate",item.raw); Task { await loadSessions() } }; if item.retryable { Button("重新解析") { Task { await mutate("/api/datasets/" + item.id + "/retry","POST") } } }; Button("删除",role:.destructive) { selected = [item.id]; show("deleteBatch") }.disabled(item.busy) } label:{ Image(systemName:"ellipsis") }.menuStyle(.borderlessButton).frame(width:28).disabled(busy)
        }.padding(.vertical,10)
    }
    private func show(_ kind:String,_ item:JSONValue = .null) {
        guard !busy else { return }; if account.isEmpty { pending = kind == "createFolder" ? kind : "createFolder"; requireAccount(); return }
        target = item; action = kind; sheetError = nil; preview = ""; name = kind == "renameFolder" ? item.text("name") : item.text("file_name"); destination = kind == "associate" ? item.text("interview_session_id") : folders.first?.text("id") ?? ""
    }
    private var sheet: some View {
        VStack(alignment:.leading,spacing:20) {
            HStack { Text(["createFolder":"新建文件夹","renameFolder":"重命名文件夹","rename":"重命名资料","move":"移动到文件夹","deleteFolder":"删除文件夹？","deleteBatch":"删除所选资料？","associate":"管理关联","preview":"文档预览","media":"音视频预览","uploadRename":"保留两份","replace":"替换现有文档？"][action ?? ""] ?? "资料库").font(.custom("Songti SC",size:24).weight(.semibold)); Spacer(); Button("关闭") { action = nil }.disabled(busy) }
            sheetContent
            if let sheetError { Text(sheetError).foregroundStyle(.red).font(LibraryTypography.sans(12)) }
            if !["preview","media"].contains(action ?? "") { HStack { if action == "associate" && !target.text("interview_session_id").isEmpty { Button("取消关联",role:.destructive) { Task { await save(unlink:true) } }.disabled(busy) }; Spacer(); Button("取消") { action = nil }.disabled(busy); Button(busy ? "处理中…" : ["deleteFolder","deleteBatch"].contains(action ?? "") ? "永久删除" : action == "replace" ? "确认替换" : "保存") { Task { await save() } }.buttonStyle(WebActionStyle()).disabled(busy || loading) } }
        }.padding(28).frame(width:["preview","media"].contains(action ?? "") ? 820:560).frame(minHeight:250,maxHeight:740).interactiveDismissDisabled(busy)
    }
    @ViewBuilder private var sheetContent: some View {
        if ["createFolder","renameFolder","rename","uploadRename"].contains(action ?? "") { TextField("名称",text:$name).textFieldStyle(.roundedBorder).disabled(busy) }
        else if action == "move" { Text("移动 \(selected.count) 份资料"); Picker("目标文件夹",selection:$destination) { Text("请选择").tag(""); ForEach(folders,id:\.self) { Text($0.text("name")).tag($0.text("id")) } }.disabled(busy) }
        else if action == "deleteFolder" { Text("永久删除「\(target.text("name"))」及其中全部 \(target["dataset_count"]?.integer ?? 0) 份资料，无法恢复。正在上传或解析的资料会阻止删除。") }
        else if action == "deleteBatch" { Text("永久删除以下 \(selected.count) 份资料及原文件，无法恢复。"); ScrollView { VStack(alignment:.leading,spacing:8) { ForEach(datasets.filter{selected.contains($0.id)}) { Text($0.name) } } }.frame(maxHeight:200) }
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
    private func date(_ value:String) -> String { guard let date = CareerApplication.date(value) else { return "—" }; let format = DateFormatter(); format.dateFormat = "yyyy-MM-dd"; return format.string(from:date) }
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
        return .custom("LinkResumeLibrarySans-Regular",size:size).weight(weight)
    }
    static func serif(_ size:CGFloat) -> Font {
        _ = registered
        return .custom("LinkResumeLibrarySerif-SemiBold",size:size)
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
