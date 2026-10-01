using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using LinkResume.Core.Models;

namespace LinkResume.Core.Api;

/// <summary>
/// 业务数据入口。界面只依赖这个接口：现在用 <see cref="MockApiClient"/>，
/// 后端补上 desktop 渠道（Bearer 会话）后换成 <see cref="HttpApiClient"/>，界面不用改。
/// </summary>
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

/// <summary>令牌存储。正式实现走 Windows Credential Locker（PasswordVault），desktop 渠道落地时补。</summary>
public interface ITokenStore
{
    string? AccessToken { get; }
    void Clear();
}

/// <summary>
/// 真实后端客户端（骨架）。凭据载体与其他端的区别：
/// Web 用 HttpOnly Cookie，小程序用 Bearer，桌面用 Bearer + 系统凭据库保存 refresh（channel=desktop，需后端新增）。
/// </summary>
public sealed class HttpApiClient(HttpClient http, ITokenStore tokens) : IApiClient
{
    public async Task<User?> CurrentUserAsync(CancellationToken ct = default)
        => (await SendAsync("/api/auth/me", ct))["user"]?.Deserialize<User>();

    public Task<User> SignInAsync(string email, string password, CancellationToken ct = default)
        => throw new ApiException(HttpStatusCode.NotImplemented, "DESKTOP_CHANNEL_NOT_AVAILABLE");

    public Task SignOutAsync(CancellationToken ct = default)
    {
        tokens.Clear();
        return Task.CompletedTask;
    }

    public async Task<IReadOnlyList<ResumeTemplate>> ListResumeTemplatesAsync(CancellationToken ct = default)
        => (await SendAsync("/api/resume-templates", ct))["templates"]?.Deserialize<List<ResumeTemplate>>() ?? [];

    /// <summary>统一请求管线：注入 Bearer 与 X-Request-ID，按后端 {error: CODE} 约定转换错误。401 后的 refresh 轮换待 desktop 渠道补。</summary>
    private async Task<JsonNode> SendAsync(string path, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, path);
        request.Headers.Add("X-Request-ID", Guid.NewGuid().ToString());
        if (tokens.AccessToken is { } token) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await http.SendAsync(request, ct);
        var body = await response.Content.ReadFromJsonAsync<JsonNode>(ct) ?? new JsonObject();
        if (!response.IsSuccessStatusCode)
            throw new ApiException(response.StatusCode, body["error"]?.GetValue<string>() ?? $"HTTP_{(int)response.StatusCode}");
        return body;
    }
}
