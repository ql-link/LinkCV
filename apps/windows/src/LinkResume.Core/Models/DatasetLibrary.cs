using System.Text.Json.Nodes;
using System.Security.AccessControl;
using System.Security.Principal;
namespace LinkResume.Core.Models;
public static class DatasetRequest {
    public static bool Id(string value)=>value.Length>0&&value[0]!='0'&&value.All(c=>c is >= '0' and <= '9')&&ulong.TryParse(value,out var id)&&id>0;
    public static bool Allowed(string path,string method){
        if(path is "/api/datasets" or "/api/datasets/folders")return method is "GET" or "POST";
        if(path=="/api/datasets/move-batch")return method=="POST";
        var p=path.Split('/');if(p.Length<4||p[0]!=""||p[1]!="api")return false;
        if(p[2]=="interview-sessions"&&p.Length==6&&Id(p[3])&&p[4]=="assets")return p[5]=="attach"?method=="POST":Id(p[5])&&method=="DELETE";
        if(p[2]!="datasets")return false;if(p.Length==5&&p[3]=="folders"&&Id(p[4]))return method is "PATCH" or "DELETE";
        if(!Id(p[3]))return false;if(p.Length==4)return method is "GET" or "PATCH" or "DELETE";if(p.Length!=5)return false;
        return new Dictionary<string,string>{{"content","GET"},{"source","GET"},{"retry","POST"},{"folder","PATCH"},{"file","PUT"}}.GetValueOrDefault(p[4])==method;
    }
}
public sealed record DatasetRecord(JsonNode Raw){
    public string Text(string key)=>Raw[key]?.GetValue<string>()??"";
    public string Id=>Text("id");public string Name=>Text("file_name");public string Folder=>Text("folder_id");public string Format=>Text("file_format").ToUpperInvariant();
    public bool Media=>Text("asset_kind") is "audio" or "video";public bool Ready=>Text("upload_status")=="succeeded"&&(Media||Text("parse_status")=="succeeded");
    public bool Busy=>Text("upload_status")=="uploading"||Text("parse_status") is "queued" or "processing";
    public bool Retryable=>!Media&&Text("upload_status")=="succeeded"&&Text("parse_status")=="failed";
    public string Status=>Ready?(Media?"可下载":"可用"):Text("upload_status")=="failed"?"上传失败":new Dictionary<string,string>{{"queued","等待解析"},{"processing","正在解析"},{"failed","解析失败"}}.GetValueOrDefault(Text("parse_status"),"正在上传");
    public string Size=>FormatSize(Raw["file_size"]?.GetValue<long>()??0);
    public static string FormatSize(long bytes)=>bytes>=1024*1024?$"{bytes/(1024.0*1024):F1} MB":bytes>=1024?$"{bytes/1024.0:F1} KB":$"{bytes} B";
}
public sealed record DatasetUpload(string Id,string File,string Directory,string Folder,string Name,long Limit,string? Replacing=null,string? Revision=null){
    public static DatasetUpload Snapshot(string source,string folder,long limit){
        var info=new FileInfo(source);if(!DatasetRequest.Id(folder)||!info.Exists||info.Attributes.HasFlag(FileAttributes.ReparsePoint)||info.Length<=0||info.Length>limit||limit>512L*1024*1024)throw new InvalidDataException();
        var directory=PrivateDirectory();try{var file=Path.Combine(directory,"snapshot");System.IO.File.Copy(source,file);if(!OperatingSystem.IsWindows())System.IO.File.SetUnixFileMode(file,UnixFileMode.UserRead|UnixFileMode.UserWrite);if(new FileInfo(file).Length!=info.Length)throw new InvalidDataException();return new(Guid.NewGuid().ToString("D"),file,directory,folder,info.Name,limit);}catch{System.IO.Directory.Delete(directory,true);throw;}
    }
    public static string PrivateDirectory(){var path=Path.Combine(Path.GetTempPath(),"LinkResumeLibrary-"+Guid.NewGuid());System.IO.Directory.CreateDirectory(path);if(OperatingSystem.IsWindows()){try{var sid=WindowsIdentity.GetCurrent().User??throw new UnauthorizedAccessException();var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);acl.SetOwner(sid);acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));new DirectoryInfo(path).SetAccessControl(acl);}catch{System.IO.Directory.Delete(path);throw;}}else System.IO.File.SetUnixFileMode(path,UnixFileMode.UserRead|UnixFileMode.UserWrite|UnixFileMode.UserExecute);return path;}
    public void Discard(){try{System.IO.Directory.Delete(Directory,true);}catch(IOException){}catch(UnauthorizedAccessException){}}
}
public sealed record DatasetFile(string File,string Directory){public void Discard(){try{System.IO.Directory.Delete(Directory,true);}catch(IOException){}catch(UnauthorizedAccessException){}}}
