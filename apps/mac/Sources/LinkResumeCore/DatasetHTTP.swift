import Foundation
extension DesktopTransport {
    func uploadDataset(_ upload: DatasetUpload, access: String?) async throws -> JSONValue {
        guard DatasetRequest.id(upload.folder), UUID(uuidString:upload.id)?.uuidString.lowercased() == upload.id,
              !upload.name.isEmpty, !upload.name.contains(where:{ "\r\n\"\\/".contains($0) }), upload.limit > 0, upload.limit <= 512 * 1024 * 1024 else { throw APIError.invalidResponse }
        let size = try upload.file.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
        guard size > 0, size <= upload.limit else { throw APIError.invalidResponse }
        let directory = try DatasetUpload.privateDirectory(); defer { try? FileManager.default.removeItem(at:directory) }
        let container = directory.appendingPathComponent("multipart")
        FileManager.default.createFile(atPath:container.path,contents:nil,attributes:[.posixPermissions:0o600])
        let output = try FileHandle(forWritingTo:container), input = try FileHandle(forReadingFrom:upload.file)
        defer { try? input.close(); try? output.close() }
        let boundary = "LinkResume-" + UUID().uuidString
        func write(_ text:String) throws { try output.write(contentsOf:Data(text.utf8)) }
        func field(_ name:String,_ value:String) throws { try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n") }
        var path = "/api/datasets", method = "POST"
        if let replacing = upload.replacing {
            guard DatasetRequest.id(replacing), let revision = upload.revision, revision.allSatisfy({$0 >= "0" && $0 <= "9"}), !revision.isEmpty else { throw APIError.invalidResponse }
            path += "/" + replacing + "/file"; method = "PUT"; try field("confirm_replace","true")
        } else { try field("folder_id",upload.folder); try field("file_name",upload.name) }
        try write("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(upload.name)\"\r\nContent-Type: application/octet-stream\r\n\r\n")
        var copied = 0
        while let data = try input.read(upToCount:65536), !data.isEmpty { try Task.checkCancellation(); copied += data.count; guard copied <= upload.limit else { throw APIError.invalidResponse }; try output.write(contentsOf:data) }
        guard copied == size else { throw APIError.invalidResponse }
        try write("\r\n--\(boundary)--\r\n"); try output.synchronize()
        var request = URLRequest(url:origin.appending(path:path)); request.httpMethod = method; request.timeoutInterval = 600
        request.setValue("multipart/form-data; boundary=\(boundary)",forHTTPHeaderField:"Content-Type")
        request.setValue(upload.id,forHTTPHeaderField:"Idempotency-Key")
        if let replacing = upload.replacing { request.setValue("\"dataset-\(replacing)-\(upload.revision!)\"",forHTTPHeaderField:"If-Match") }
        if let access { request.setValue("Bearer \(access)",forHTTPHeaderField:"Authorization") }
        let (data,response) = try await session.upload(for:request,fromFile:container)
        guard let http = response as? HTTPURLResponse, data.count <= 4 * 1024 * 1024 else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else { throw APIError.server(status:http.statusCode,code:(try? JSONDecoder().decode(JSONValue.self,from:data))?.text("error") ?? "HTTP_\(http.statusCode)") }
        return try JSONDecoder().decode(JSONValue.self,from:data)
    }
    func downloadDataset(id:String,to target:URL,limit:Int64,access:String?) async throws {
        guard DatasetRequest.id(id), limit > 0, limit <= 512 * 1024 * 1024 else { throw APIError.invalidResponse }
        var request = URLRequest(url:origin.appending(path:"/api/datasets/" + id + "/source"),cachePolicy:.reloadIgnoringLocalCacheData); request.timeoutInterval = 600
        if let access { request.setValue("Bearer \(access)",forHTTPHeaderField:"Authorization") }
        let (bytes,response) = try await session.bytes(for:request); defer { bytes.task.cancel() }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard http.statusCode == 200 else { throw APIError.server(status:http.statusCode,code:"DATASET_SOURCE_UNAVAILABLE") }
        guard http.expectedContentLength <= limit else { throw APIError.invalidResponse }
        FileManager.default.createFile(atPath:target.path,contents:Data(),attributes:[.posixPermissions:0o600])
        let output = try FileHandle(forWritingTo:target); defer { try? output.close() }
        try output.truncate(atOffset:0)
        var buffer = Data(), count:Int64 = 0
        for try await byte in bytes { try Task.checkCancellation(); count += 1; guard count <= limit else { throw APIError.invalidResponse }; buffer.append(byte); if buffer.count >= 65536 { try output.write(contentsOf:buffer); buffer.removeAll(keepingCapacity:true) } }
        guard count > 0 else { throw APIError.invalidResponse }; try output.write(contentsOf:buffer)
    }
}
