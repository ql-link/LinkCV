import SwiftUI

/// Read-only native Markdown. No HTML, remote image fetches or embedded web scripts.
struct NativeMarkdownView: View {
    private struct Block: Identifiable { let id:Int; let kind:String; let text:String; let rows:[[String]]; let level:Int }
    private let blocks:[Block]
    private let truncated:Bool
    init(source:String) {
        let limited=String(source.prefix(500_000)); let characterTruncated=limited.count<source.count
        let lines=limited.components(separatedBy:"\n"); var blocks:[Block]=[], index=0
        func cells(_ line:String)->[String] { var parts=line.split(separator:"|",omittingEmptySubsequences:false).map{String($0).trimmingCharacters(in:.whitespaces)};if parts.first=="" {parts.removeFirst()};if parts.last==""{parts.removeLast()};return Array(parts.prefix(20)) }
        while index<lines.count && blocks.count<5000 {
            let line=lines[index],trim=line.trimmingCharacters(in:.whitespaces)
            if trim.hasPrefix("```") {let language=String(trim.dropFirst(3));var content:[String]=[];index+=1;while index<lines.count && !lines[index].trimmingCharacters(in:.whitespaces).hasPrefix("```"){content.append(lines[index]);index+=1};blocks.append(Block(id:blocks.count,kind:"code",text:content.joined(separator:"\n"),rows:[],level:language=="mermaid" ? 1:0));index+=1;continue}
            if index+1<lines.count,line.contains("|"),lines[index+1].contains("---") {var rows=[cells(line)];index+=2;while index<lines.count && lines[index].contains("|") && !lines[index].isEmpty {rows.append(cells(lines[index]));index+=1};blocks.append(Block(id:blocks.count,kind:"table",text:"",rows:rows,level:0));continue}
            let level=trim.prefix(while:{$0=="#"}).count
            let kind=level>0 && level<=6 && trim.dropFirst(level).hasPrefix(" ") ? "heading":trim.hasPrefix("![") ? "image":"text"
            if !trim.isEmpty { blocks.append(Block(id:blocks.count,kind:kind,text:kind=="heading" ? String(trim.dropFirst(level+1)):trim.hasPrefix("- ") ? "• "+String(trim.dropFirst(2)):trim,rows:[],level:level)) }
            index+=1
        }
        self.blocks=blocks
        self.truncated=characterTruncated || index<lines.count
    }
    var body:some View {
        VStack(alignment:.leading,spacing:12) {
            if truncated { Text("正文较长，预览显示前 50 万字符；完整内容请下载原文件查看。").foregroundStyle(.orange).font(.system(size:12)) }
            ForEach(blocks){block in
                if block.kind=="heading" {Text(block.text).font(.system(size:max(14,25-Double(block.level)*2),weight:.semibold)).padding(.top,8)}
                else if block.kind=="code" {VStack(alignment:.leading,spacing:8){if block.level==1 {Text("Mermaid 图表源码 · 原生预览暂不执行图表脚本").font(.system(size:11)).foregroundStyle(.secondary)};Text(block.text).font(.system(size:12,design:.monospaced)).textSelection(.enabled)}.frame(maxWidth:.infinity,alignment:.leading).padding(14).background(Color(hex:0xF6F6F3),in:RoundedRectangle(cornerRadius:8))}
                else if block.kind=="table" {ScrollView(.horizontal){Grid(alignment:.leading,horizontalSpacing:16,verticalSpacing:10){ForEach(Array(block.rows.enumerated()),id:\.offset){row,values in GridRow{ForEach(Array(values.enumerated()),id:\.offset){_,value in Text(inline(value)).font(.system(size:12,weight:row==0 ? .semibold:.regular)).frame(minWidth:80,maxWidth:280,alignment:.leading)}}}}.padding(12).overlay(RoundedRectangle(cornerRadius:8).stroke(Color(hex:0xE4E4E0)))}}
                else if block.kind=="image" {Label("文档图片请下载原文件查看",systemImage:"photo").font(.system(size:12)).foregroundStyle(.secondary)}
                else {Text(inline(block.text)).font(.system(size:13)).textSelection(.enabled)}
            }
        }
    }
    private func inline(_ source:String)->AttributedString {(try? AttributedString(markdown:source,options:.init(interpretedSyntax:.inlineOnlyPreservingWhitespace))) ?? AttributedString(source)}
}
