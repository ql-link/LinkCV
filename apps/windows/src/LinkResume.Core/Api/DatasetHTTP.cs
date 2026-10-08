using System.Net;
using System.Net.Http.Json;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using LinkResume.Core.Models;
namespace LinkResume.Core.Api;
public sealed partial class DesktopTransport {
    public async Task<JsonNode> UploadDatasetAsync(DatasetUpload upload,string? access,CancellationToken ct=default){
        if(!DatasetRequest.Id(upload.Folder)||!Guid.TryParseExact(upload.Id,"D",out var key)||key.ToString("D")!=upload.Id||string.IsNullOrWhiteSpace(upload.Name)||upload.Name.IndexOfAny(['\r','\n','"','\\','/'])>=0||upload.Limit<=0||upload.Limit>512L*1024*1024)throw new InvalidDataException();
        var info=new FileInfo(upload.File);if(info.Length<=0||info.Length>upload.Limit)throw new InvalidDataException();
        var path="/api/datasets";var method=HttpMethod.Post;
        using var form=new MultipartFormDataContent();
        if(upload.Replacing is {} replacing){if(!DatasetRequest.Id(replacing)||string.IsNullOrEmpty(upload.Revision)||!upload.Revision.All(c=>c is >= '0' and <= '9'))throw new InvalidDataException();path+="/"+replacing+"/file";method=HttpMethod.Put;form.Add(new StringContent("true"),"confirm_replace");}
        else{form.Add(new StringContent(upload.Folder),"folder_id");form.Add(new StringContent(upload.Name),"file_name");}
        await using var source=new FileStream(upload.File,FileMode.Open,FileAccess.Read,FileShare.Read,65536,true);
        var content=new StreamContent(source);content.Headers.ContentType=new MediaTypeHeaderValue("application/octet-stream");form.Add(content,"file",upload.Name);
        using var request=new HttpRequestMessage(method,path){Content=form};request.Headers.Add("Idempotency-Key",upload.Id);
        if(upload.Replacing is {} id)request.Headers.TryAddWithoutValidation("If-Match",$"\"dataset-{id}-{upload.Revision}\"");
        if(access is not null)request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",access);
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromMinutes(10));
        using var response=await _fileHttp.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,timeout.Token);
        if(!response.IsSuccessStatusCode&&response.Content.Headers.ContentType?.MediaType!="application/json")throw new ApiException(response.StatusCode,"HTTP_"+(int)response.StatusCode);
        var result=await response.Content.ReadFromJsonAsync<JsonNode>(timeout.Token)??throw new InvalidDataException();
        if(!response.IsSuccessStatusCode)throw new ApiException(response.StatusCode,result["error"]?.GetValue<string>()??"HTTP_"+(int)response.StatusCode);return result;
    }
    public async Task DownloadDatasetAsync(string id,string target,long limit,string? access,CancellationToken ct=default){
        if(!DatasetRequest.Id(id)||limit<=0||limit>512L*1024*1024)throw new InvalidDataException();
        using var request=new HttpRequestMessage(HttpMethod.Get,"/api/datasets/"+id+"/source");request.Headers.CacheControl=new CacheControlHeaderValue{NoStore=true,NoCache=true};if(access is not null)request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",access);
        using var timeout=CancellationTokenSource.CreateLinkedTokenSource(ct);timeout.CancelAfter(TimeSpan.FromMinutes(10));using var response=await _fileHttp.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,timeout.Token);
        if(response.StatusCode!=HttpStatusCode.OK)throw new ApiException(response.StatusCode,"DATASET_SOURCE_UNAVAILABLE");if(response.Content.Headers.ContentLength>limit)throw new InvalidDataException();
        await using var input=await response.Content.ReadAsStreamAsync(timeout.Token);await using var output=new FileStream(target,FileMode.Create,FileAccess.Write,FileShare.None,65536,true);long total=0;var bytes=new byte[65536];int count;
        while((count=await input.ReadAsync(bytes,timeout.Token))>0){total+=count;if(total>limit)throw new InvalidDataException();await output.WriteAsync(bytes.AsMemory(0,count),timeout.Token);}if(total==0)throw new InvalidDataException();
    }
}
