using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using DrawOffer.Core.Models;
using DrawOffer.Core.Paper;

namespace DrawOffer.Core.Api;

/// <summary>App 注入真实 HTTP 客户端；Mock 仅用于离线测试。</summary>
public interface IApiClient
{
    Task<JsonNode> UploadDatasetAsync(DatasetUpload upload,CancellationToken ct=default) => throw new InvalidDataException();
    Task<DatasetFile> DownloadDatasetAsync(string id,long limit,CancellationToken ct=default) => throw new InvalidDataException();
    Task<JsonNode> CareerRequestAsync(string path, string method = "GET", Dictionary<string,string>? query = null, JsonNode? body = null, CancellationToken ct = default) => throw new ApiException(HttpStatusCode.Unauthorized, "UNAUTHORIZED");
    Task<PaperPreparation> PreparePaperAsync(ResumeRenderRequest request, CancellationToken ct = default)
        => PaperAssets.PrepareAsync(request, "", (_, _, _) => throw new InvalidDataException(), ct);
    Task<User?> CurrentUserAsync(CancellationToken ct = default);
    Task<User> SignInAsync(string email, string password, CancellationToken ct = default);
    Task SignOutAsync(CancellationToken ct = default);
    Task<IReadOnlyList<ResumeTemplate>> ListResumeTemplatesAsync(CancellationToken ct = default);
}

public sealed class ApiException(HttpStatusCode status, string code) : Exception(code)
{
    public HttpStatusCode Status { get; } = status;
    public string Code { get; } = code;
}

/// <summary>
/// 离线 mock：模板来自 apps/native/shared/fixtures（后端布局编译器生成，内容虚构）。
/// 需后端：登录目前不校验密码。
/// </summary>
public sealed class MockApiClient(bool signedIn = false) : IApiClient
{
    public static readonly User PreviewUser = new("1", "v3-preview@example.com", "预览用户", false);
    private User? _user = signedIn ? PreviewUser : null;

    public Task<User?> CurrentUserAsync(CancellationToken ct = default) => Task.FromResult(_user);

    public Task<User> SignInAsync(string email, string password, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrEmpty(password))
            throw new ApiException(HttpStatusCode.BadRequest, "INVALID_CREDENTIALS");
        _user = new User("1", email, email.Split('@')[0], false);
        return Task.FromResult(_user);
    }

    public Task SignOutAsync(CancellationToken ct = default)
    {
        _user = null;
        return Task.CompletedTask;
    }

    public async Task<IReadOnlyList<ResumeTemplate>> ListResumeTemplatesAsync(CancellationToken ct = default)
    {
        if (_user is null) throw new ApiException(HttpStatusCode.Unauthorized, "UNAUTHORIZED");
        await using var stream = typeof(MockApiClient).Assembly.GetManifestResourceStream("DrawOffer.Core.resume-templates.json")
            ?? throw new InvalidOperationException("mock fixture missing");
        var envelope = await JsonSerializer.DeserializeAsync<TemplateEnvelope>(stream, cancellationToken: ct);
        return envelope?.Templates ?? [];
    }

    private sealed record TemplateEnvelope(
        [property: System.Text.Json.Serialization.JsonPropertyName("templates")] List<ResumeTemplate> Templates);
}

public interface IDesktopTransport
{
    Task<JsonNode> UploadDatasetAsync(DatasetUpload upload,string? access,CancellationToken ct=default) => throw new InvalidDataException();
    Task DownloadDatasetAsync(string id,string target,long limit,string? access,CancellationToken ct=default) => throw new InvalidDataException();
    Task<JsonNode> CareerAsync(string path, string method, Dictionary<string,string>? query, JsonNode? body, string? access, CancellationToken ct = default) => throw new InvalidDataException();
    Uri Origin { get; }
    Task<DesktopImage> DownloadImageAsync(string path, int limit, string? access, CancellationToken ct = default)
        => throw new InvalidDataException();
    Task<JsonNode> SendAsync(string path, Dictionary<string, string>? body = null, string? access = null, CancellationToken ct = default);
}

public sealed partial class DesktopTransport : IDesktopTransport, IDisposable
{
    public Uri Origin { get; }
    private readonly HttpClient _http;
    private readonly HttpClient _fileHttp;

    public DesktopTransport(Uri origin, bool allowLocalHttp = false)
    {
        if (!origin.IsAbsoluteUri || origin.UserInfo.Length != 0 || origin.Query.Length != 0 || origin.Fragment.Length != 0 || origin.AbsolutePath != "/" ||
            (origin.Scheme != "https" && !(allowLocalHttp && origin.Scheme == "http" && new[] { "localhost", "127.0.0.1", "[::1]" }.Contains(origin.Host))))
            throw new ArgumentException("A trusted API origin is required", nameof(origin));
        Origin = origin;
        _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = origin };
        _fileHttp = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = origin, Timeout = TimeSpan.FromMinutes(10) };
    }

    public async Task<JsonNode> SendAsync(string path, Dictionary<string, string>? body = null, string? access = null, CancellationToken ct = default)
    {
        if (!path.StartsWith("/api/", StringComparison.Ordinal) || path.Contains("..") || path.Contains('?') || path.Contains('#'))
            throw new ArgumentException("Invalid API path", nameof(path));
        using var request = new HttpRequestMessage(body is null ? HttpMethod.Get : HttpMethod.Post, path);
        request.Headers.Add("X-Request-ID", Guid.NewGuid().ToString());
        if (access is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", access);
        if (body is not null) request.Content = JsonContent.Create(body);
        using var response = await _http.SendAsync(request, ct);
        if (!response.IsSuccessStatusCode)
        {
            string? code = null;
            try { code = (await response.Content.ReadFromJsonAsync<JsonNode>(ct))?["error"]?.GetValue<string>(); }
            catch (JsonException) { }
            throw new ApiException(response.StatusCode, code ?? $"HTTP_{(int)response.StatusCode}");
        }
        return await response.Content.ReadFromJsonAsync<JsonNode>(ct) ?? throw new JsonException("Missing response");
    }

    public async Task<JsonNode> CareerAsync(string path, string method, Dictionary<string,string>? query, JsonNode? body, string? access, CancellationToken ct = default)
    {
        if (!CareerRequest.Allowed(path, method) || query is not null && query.Keys.Any(k => !new[] { "scope", "cursor", "limit", "week_start", "timezone", "application_id", "include_archived", "v", "job_application_id", "resume_id", "status", "folder_id", "confirm_contents" }.Contains(k))) throw new InvalidDataException();
        var suffix = query is null || query.Count == 0 ? "" : "?" + string.Join("&", query.Select(x => Uri.EscapeDataString(x.Key) + "=" + Uri.EscapeDataString(x.Value)));
        using var request = new HttpRequestMessage(new HttpMethod(method), path + suffix);
        request.Headers.Add("X-Request-ID", Guid.NewGuid().ToString());
        if (access is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", access);
        if(path.EndsWith("/logo")) {
            if(method!="GET" || query?.Count!=1 || !query.TryGetValue("v",out var revision) || revision.Length!=64 || !revision.All(c=>char.IsAsciiDigit(c)||c is >= 'a' and <= 'f'))throw new InvalidDataException();
            request.Headers.Accept.ParseAdd("image/webp");
            using var logo=await _http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead,ct);
            if(logo.StatusCode==HttpStatusCode.Unauthorized)throw new ApiException(logo.StatusCode,"UNAUTHORIZED");
            if(logo.StatusCode!=HttpStatusCode.OK || logo.Content.Headers.ContentType?.MediaType!="image/webp" || logo.Content.Headers.ContentLength>256*1024)throw new InvalidDataException();
            await using var stream=await logo.Content.ReadAsStreamAsync(ct);using var data=new MemoryStream();var buffer=new byte[8192];int count;
            while((count=await stream.ReadAsync(buffer,ct))>0) {if(data.Length+count>256*1024)throw new InvalidDataException();data.Write(buffer,0,count);}
            var bytes=data.ToArray();
            if(bytes.Length<12 || System.Text.Encoding.ASCII.GetString(bytes,0,4)!="RIFF" || System.Text.Encoding.ASCII.GetString(bytes,8,4)!="WEBP")throw new InvalidDataException();
            return new JsonObject{["image_base64"]=Convert.ToBase64String(bytes)};
        }
        var payload=body;
        if(MockInterviewRequest.Allowed(path,method)&&(path.EndsWith("/answers")||path.EndsWith("/skip"))) {
            var key=body?["__idempotency_key"]?.GetValue<string>();
            if(!Guid.TryParseExact(key,"D",out var id)||id.ToString("D")!=key)throw new InvalidDataException();
            payload=body!.DeepClone();payload.AsObject().Remove("__idempotency_key");request.Headers.Add("Idempotency-Key",key);
        }
        if (body is not null) {
            if(path == "/api/job-descriptions/parse-draft") {
                var form = new MultipartFormDataContent();
                if(body["image_base64"]?.GetValue<string>() is { } encoded) {
                    var bytes = Convert.FromBase64String(encoded); var type = body["content_type"]?.GetValue<string>();
                    if(bytes.Length > 10 * 1024 * 1024 || type is not ("image/png" or "image/jpeg")) { form.Dispose(); throw new InvalidDataException(); }
                    var image = new ByteArrayContent(bytes); image.Headers.ContentType = new MediaTypeHeaderValue(type); form.Add(image, "image", type == "image/png" ? "upload.png" : "upload.jpg");
                } else { form.Add(new StringContent(body["text"]?.GetValue<string>() ?? ""), "text"); }
                request.Content = form;
            } else request.Content = JsonContent.Create(payload);
        }
        using var deadline=CancellationTokenSource.CreateLinkedTokenSource(ct);deadline.CancelAfter(TimeSpan.FromMinutes(3));ct=deadline.Token;
        using var response = await _http.SendAsync(request,HttpCompletionOption.ResponseHeadersRead, ct);
        if(response.IsSuccessStatusCode&&response.Content.Headers.ContentType?.MediaType=="text/event-stream"&&path.StartsWith("/api/mock-interviews/")) {
            await using var stream=await response.Content.ReadAsStreamAsync(ct);using var data=new MemoryStream();var buffer=new byte[8192];int count;
            while((count=await stream.ReadAsync(buffer,ct))>0){if(data.Length+count>4*1024*1024)throw new InvalidDataException();data.Write(buffer,0,count);}
            return MockInterviewRequest.DecodeEvents(new System.Text.UTF8Encoding(false,true).GetString(data.ToArray()));
        }
        if (!response.IsSuccessStatusCode && response.Content.Headers.ContentType?.MediaType != "application/json") throw new ApiException(response.StatusCode, "HTTP_" + (int)response.StatusCode);
        var result = await response.Content.ReadFromJsonAsync<JsonNode>(ct) ?? new JsonObject();
        if (!response.IsSuccessStatusCode) throw new ApiException(response.StatusCode, result["error"]?.GetValue<string>() ?? $"HTTP_{(int)response.StatusCode}");
        return result;
    }

    public async Task<DesktopImage> DownloadImageAsync(string path, int limit, string? access, CancellationToken ct = default)
    {
        if (!path.StartsWith("/api/", StringComparison.Ordinal) || path.Contains("..") || path.Contains('?') || path.Contains('#') || limit <= 0) throw new InvalidDataException();
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Accept.ParseAdd("image/png, image/jpeg");
        request.Headers.CacheControl = new CacheControlHeaderValue { NoStore = true, NoCache = true };
        if (access is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", access);
        using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (response.StatusCode != HttpStatusCode.OK) throw new ApiException(response.StatusCode, "IMAGE_READ_FAILED");
        var type = response.Content.Headers.ContentType?.MediaType?.ToLowerInvariant();
        if (type is not ("image/png" or "image/jpeg") || response.Content.Headers.ContentLength > limit) throw new InvalidDataException();
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        using var data = new MemoryStream();
        var buffer = new byte[64 * 1024];
        int count;
        while ((count = await stream.ReadAsync(buffer, ct)) > 0)
        {
            if (data.Length + count > limit) throw new InvalidDataException();
            data.Write(buffer, 0, count);
        }
        return new(data.ToArray(), type);
    }

    public void Dispose() { _http.Dispose(); _fileHttp.Dispose(); }
}

public sealed class HttpApiClient(DrawOffer.Core.Session.SessionCoordinator coordinator) : IApiClient
{
    public Task<JsonNode> UploadDatasetAsync(DatasetUpload upload,CancellationToken ct=default) => coordinator.UploadDatasetAsync(upload,ct);
    public Task<DatasetFile> DownloadDatasetAsync(string id,long limit,CancellationToken ct=default) => coordinator.DownloadDatasetAsync(id,limit,ct);
    public Task<JsonNode> CareerRequestAsync(string path, string method = "GET", Dictionary<string,string>? query = null, JsonNode? body = null, CancellationToken ct = default) => coordinator.CareerRequestAsync(path, method, query, body, ct);
    public DrawOffer.Core.Session.SessionCoordinator Coordinator { get; } = coordinator;
    public Task<PaperPreparation> PreparePaperAsync(ResumeRenderRequest request, CancellationToken ct = default) => Coordinator.PreparePaperAsync(request, ct);
    public Task<User?> CurrentUserAsync(CancellationToken ct = default) => Coordinator.RestoreAsync(ct);
    public Task<User> SignInAsync(string email, string password, CancellationToken ct = default)
        => throw new ApiException(HttpStatusCode.MethodNotAllowed, "DESKTOP_WECHAT_LOGIN_REQUIRED");
    public Task SignOutAsync(CancellationToken ct = default) => Coordinator.SignOutAsync();
    public async Task<IReadOnlyList<ResumeTemplate>> ListResumeTemplatesAsync(CancellationToken ct = default)
        => (await Coordinator.RequestAsync("/api/resume-templates", ct))["templates"]?.Deserialize<List<ResumeTemplate>>() ?? [];
}
