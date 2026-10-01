using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using LinkResume.Core.Models;

namespace LinkResume.Core.Api;

/// <summary>正式 App 仍注入 Mock；HTTP 实现须在系统安全凭据库接入后启用。</summary>
public interface IApiClient
{
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
        await using var stream = typeof(MockApiClient).Assembly.GetManifestResourceStream("LinkResume.Core.resume-templates.json")
            ?? throw new InvalidOperationException("mock fixture missing");
        var envelope = await JsonSerializer.DeserializeAsync<TemplateEnvelope>(stream, cancellationToken: ct);
        return envelope?.Templates ?? [];
    }

    private sealed record TemplateEnvelope(
        [property: System.Text.Json.Serialization.JsonPropertyName("templates")] List<ResumeTemplate> Templates);
}

public interface IDesktopTransport
{
    Uri Origin { get; }
    Task<JsonNode> SendAsync(string path, Dictionary<string, string>? body = null, string? access = null, CancellationToken ct = default);
}

public sealed class DesktopTransport : IDesktopTransport, IDisposable
{
    public Uri Origin { get; }
    private readonly HttpClient _http;

    public DesktopTransport(Uri origin, bool allowLocalHttp = false)
    {
        if (!origin.IsAbsoluteUri || origin.UserInfo.Length != 0 || origin.Query.Length != 0 || origin.Fragment.Length != 0 || origin.AbsolutePath != "/" ||
            (origin.Scheme != "https" && !(allowLocalHttp && origin.Scheme == "http" && new[] { "localhost", "127.0.0.1", "[::1]" }.Contains(origin.Host))))
            throw new ArgumentException("A trusted API origin is required", nameof(origin));
        Origin = origin;
        _http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { BaseAddress = origin };
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

    public void Dispose() => _http.Dispose();
}

public sealed class HttpApiClient(LinkResume.Core.Session.SessionCoordinator coordinator) : IApiClient
{
    public LinkResume.Core.Session.SessionCoordinator Coordinator { get; } = coordinator;
    public Task<User?> CurrentUserAsync(CancellationToken ct = default) => Coordinator.RestoreAsync(ct);
    public Task<User> SignInAsync(string email, string password, CancellationToken ct = default)
        => throw new ApiException(HttpStatusCode.MethodNotAllowed, "DESKTOP_WECHAT_LOGIN_REQUIRED");
    public Task SignOutAsync(CancellationToken ct = default) => Coordinator.SignOutAsync();
    public async Task<IReadOnlyList<ResumeTemplate>> ListResumeTemplatesAsync(CancellationToken ct = default)
        => (await Coordinator.RequestAsync("/api/resume-templates", ct))["templates"]?.Deserialize<List<ResumeTemplate>>() ?? [];
}
