using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using LinkResume.Core.Api;
using LinkResume.Core.Models;
using LinkResume.Core.Paper;

namespace LinkResume.Core.Session;

public sealed record RefreshJournal(string RequestId, string RefreshToken, DateTimeOffset StartedAt);
public sealed record DesktopCredentialRecord(string AccountId, string RefreshToken, Guid Generation, RefreshJournal? Pending = null);

// Implementations must atomically replace the record in a system credential store, scoped by origin/channel/app.
public interface ITokenStore
{
    DesktopCredentialRecord? Load(string scope);
    void Save(string scope, DesktopCredentialRecord record);
    void Clear(string scope);
}

public sealed class DesktopLoginChallenge
{
    public JsonNode Qrcode { get; }
    internal string Verifier { get; }
    internal string RequestId { get; } = Guid.NewGuid().ToString();
    internal Guid Generation { get; }
    internal DesktopLoginChallenge(JsonNode qrcode, string verifier, Guid generation)
        => (Qrcode, Verifier, Generation) = (qrcode, verifier, generation);
}

public sealed class SessionCoordinator(IDesktopTransport transport, ITokenStore tokens)
{
    private readonly object _gate = new();
    private readonly string _scope = $"LinkResume:windows:desktop:{transport.Origin.GetLeftPart(UriPartial.Authority)}/";
    private Guid _generation = Guid.NewGuid();
    private bool _disabled;
    private string? _access;
    private DateTimeOffset _accessDeadline;
    private (Guid Id, Task<TokenEnvelope> Task)? _flight;
    private (string RequestId, Task<TokenEnvelope> Task)? _exchange;
    private (Guid Id, DesktopCredentialRecord? Saved, Task<TokenEnvelope>? Refresh, Task<TokenEnvelope>? Exchange)? _logoutRecovery;
    private Task? _logoutFlight;

    private sealed record TokenEnvelope(
        [property: JsonPropertyName("user")] User User,
        [property: JsonPropertyName("access_token")] string AccessToken,
        [property: JsonPropertyName("refresh_token")] string RefreshToken,
        [property: JsonPropertyName("expires_in")] int ExpiresIn,
        [property: JsonPropertyName("session_protocol")] int Protocol);

    public async Task<JsonNode> CapabilitiesAsync(CancellationToken ct = default)
    {
        var result = await transport.SendAsync("/api/auth/desktop/capabilities", ct: ct);
        if (result["session_protocol"]?.GetValue<int>() != 1) throw new JsonException("Unsupported session protocol");
        return result;
    }

    public async Task<DesktopLoginChallenge> BeginLoginAsync(string clientVersion, CancellationToken ct = default)
    {
        var generation = Guid.NewGuid();
        await SignOutAsync(generation);
        lock (_gate)
        {
            if (_generation != generation) throw InvalidSession();
            _disabled = false;
        }
        var verifier = Base64Url(RandomNumberGenerator.GetBytes(32));
        var challenge = Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var result = await transport.SendAsync("/api/auth/desktop/wechat/qrcode", new()
        {
            ["platform"] = "windows", ["client_version"] = clientVersion,
            ["code_challenge"] = challenge, ["code_challenge_method"] = "S256",
        }, ct: ct);
        lock (_gate) { CheckGeneration(generation); }
        return new DesktopLoginChallenge(result, verifier, generation);
    }

    public async Task<string> LoginStatusAsync(DesktopLoginChallenge challenge, CancellationToken ct = default)
    {
        lock (_gate) { CheckGeneration(challenge.Generation); }
        var result = await transport.SendAsync("/api/auth/desktop/wechat/status", new()
        {
            ["scene"] = challenge.Qrcode["scene"]!.GetValue<string>(),
            ["poll_token"] = challenge.Qrcode["poll_token"]!.GetValue<string>(),
        }, ct: ct);
        lock (_gate) { CheckGeneration(challenge.Generation); }
        return result["status"]!.GetValue<string>();
    }

    public async Task<User> CompleteLoginAsync(DesktopLoginChallenge challenge, CancellationToken ct = default)
    {
        Task<TokenEnvelope> shared;
        lock (_gate)
        {
            CheckGeneration(challenge.Generation);
            if (_exchange is not null && _exchange.Value.RequestId != challenge.RequestId) throw InvalidSession();
            _exchange ??= (challenge.RequestId, ExchangeRemoteAsync(challenge));
            shared = _exchange.Value.Task;
        }
        TokenEnvelope envelope;
        try { envelope = await shared.WaitAsync(ct); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch
        {
            lock (_gate) { if (_exchange?.Task == shared) _exchange = null; }
            throw;
        }
        lock (_gate)
        {
            ct.ThrowIfCancellationRequested();
            CheckGeneration(challenge.Generation);
            if (_exchange?.Task == shared)
            {
                Persist(envelope, null);
                _exchange = null;
            }
        }
        return envelope.User;
    }

    private async Task<TokenEnvelope> ExchangeRemoteAsync(DesktopLoginChallenge challenge)
        => Decode(await transport.SendAsync("/api/auth/desktop/wechat/exchange", new()
        {
            ["scene"] = challenge.Qrcode["scene"]!.GetValue<string>(),
            ["poll_token"] = challenge.Qrcode["poll_token"]!.GetValue<string>(),
            ["code_verifier"] = challenge.Verifier, ["request_id"] = challenge.RequestId,
        }));

    public async Task<User?> RestoreAsync(CancellationToken ct = default)
    {
        Guid generation;
        lock (_gate)
        {
            if (_disabled || tokens.Load(_scope) is null) return null;
            generation = _generation;
        }
        await RefreshAsync(ct);
        lock (_gate) { CheckGeneration(generation); }
        var result = await RequestAsync("/api/auth/desktop/me", ct);
        lock (_gate) { CheckGeneration(generation); }
        return result["user"]?.Deserialize<User>() ?? throw new JsonException("Missing user");
    }

    public async Task<JsonNode> RequestAsync(string path, CancellationToken ct = default)
    {
        return await AuthorizedAsync((access, token) => transport.SendAsync(path, access: access, ct: token), ct);
    }

    public Task<JsonNode> CareerRequestAsync(string path, string method = "GET", Dictionary<string,string>? query = null, JsonNode? body = null, CancellationToken ct = default)
    {
        if (!CareerRequest.Allowed(path, method)) throw new InvalidDataException();
        return AuthorizedAsync((access, token) => transport.CareerAsync(path, method, query, body, access, token), ct);
    }

    public Task<JsonNode> UploadDatasetAsync(DatasetUpload upload,CancellationToken ct=default) => AuthorizedAsync((access,token)=>transport.UploadDatasetAsync(upload,access,token),ct);
    public async Task<DatasetFile> DownloadDatasetAsync(string id,long limit,CancellationToken ct=default) {
        var directory=DatasetUpload.PrivateDirectory();var target=Path.Combine(directory,"source");
        try{await AuthorizedAsync(async(access,token)=>{await transport.DownloadDatasetAsync(id,target,limit,access,token);return true;},ct);return new(target,directory);}
        catch{Directory.Delete(directory,true);throw;}
    }

    public async Task<PaperPreparation> PreparePaperAsync(ResumeRenderRequest request, CancellationToken ct = default)
    {
        Guid generation;
        string account;
        lock (_gate)
        {
            if (_disabled) throw InvalidSession();
            generation = _generation;
            account = tokens.Load(_scope)?.AccountId ?? throw InvalidSession();
        }
        var result = await PaperAssets.PrepareAsync(request, account, (path, limit, token) =>
            AuthorizedAsync((access, inner) => transport.DownloadImageAsync(path, limit, access, inner), token), ct);
        lock (_gate) { ct.ThrowIfCancellationRequested(); CheckGeneration(generation); }
        return result;
    }

    private async Task<T> AuthorizedAsync<T>(Func<string?, CancellationToken, Task<T>> send, CancellationToken ct)
    {
        bool refresh;
        Guid generation;
        lock (_gate)
        {
            if (_disabled) throw InvalidSession();
            generation = _generation;
            refresh = _access is null || _accessDeadline <= DateTimeOffset.UtcNow;
        }
        if (refresh) await RefreshAsync(ct);
        string? access;
        lock (_gate) { CheckGeneration(generation); access = _access; }
        try
        {
            var result = await send(access, ct);
            lock (_gate) { CheckGeneration(generation); }
            return result;
        }
        catch (ApiException error) when (error.Status == HttpStatusCode.Unauthorized)
        {
            lock (_gate) { CheckGeneration(generation); refresh = _access == access; }
            if (refresh) await RefreshAsync(ct);
            lock (_gate) { CheckGeneration(generation); access = _access; }
            try
            {
                var result = await send(access, ct);
                lock (_gate) { CheckGeneration(generation); }
                return result;
            }
            catch (ApiException retry) when (retry.Status == HttpStatusCode.Unauthorized)
            {
                lock (_gate) { if (_generation == generation) Invalidate(); }
                throw;
            }
        }
    }

    private async Task<TokenEnvelope> RefreshAsync(CancellationToken ct)
    {
        Guid generation;
        DesktopCredentialRecord saved;
        (Guid Id, Task<TokenEnvelope> Task) shared;
        lock (_gate)
        {
            if (_disabled) throw InvalidSession();
            saved = tokens.Load(_scope) ?? throw InvalidSession();
            generation = _generation;
            if (_flight is null)
            {
                var journal = saved.Pending ?? new RefreshJournal(Guid.NewGuid().ToString(), saved.RefreshToken, DateTimeOffset.UtcNow);
                if (DateTimeOffset.UtcNow - journal.StartedAt >= TimeSpan.FromSeconds(120)) { Invalidate(); throw InvalidSession(); }
                tokens.Save(_scope, saved with { Pending = journal });
                var id = Guid.NewGuid();
                _flight = (id, Task.Run(() => RefreshAndCommitAsync(journal, saved.AccountId, generation, id)));
            }
            shared = _flight.Value;
        }
        var result = await shared.Task.WaitAsync(ct);
        lock (_gate) { CheckGeneration(generation); }
        return result;
    }

    private async Task<TokenEnvelope> RefreshAndCommitAsync(RefreshJournal journal, string account, Guid generation, Guid id)
    {
        try
        {
            var result = await RefreshRemoteAsync(journal);
            lock (_gate)
            {
                if (_generation == generation && !_disabled)
                {
                    _access = null;
                    Persist(result, account);
                }
                if (_flight?.Id == id) _flight = null;
            }
            return result;
        }
        catch (Exception error)
        {
            lock (_gate)
            {
                if (_flight?.Id == id) _flight = null;
                if (_generation == generation && error is ApiException { Status: HttpStatusCode.Unauthorized }) Invalidate();
            }
            throw;
        }
    }

    private async Task<TokenEnvelope> RefreshRemoteAsync(RefreshJournal journal)
        => Decode(await transport.SendAsync("/api/auth/desktop/refresh", new()
        { ["refresh_token"] = journal.RefreshToken, ["request_id"] = journal.RequestId }));

    private static TokenEnvelope Decode(JsonNode body) => body.Deserialize<TokenEnvelope>() ?? throw new JsonException("Missing credentials");

    private void Persist(TokenEnvelope result, string? expectedAccount)
    {
        if (result.Protocol != 1 || result.ExpiresIn < 0 || string.IsNullOrEmpty(result.AccessToken) || string.IsNullOrEmpty(result.RefreshToken) ||
            result.User is null || (expectedAccount is not null && expectedAccount != result.User.Id)) throw new JsonException("Invalid credentials");
        tokens.Save(_scope, new(result.User.Id, result.RefreshToken, _generation));
        _access = result.AccessToken;
        _accessDeadline = DateTimeOffset.UtcNow.AddSeconds(result.ExpiresIn);
    }

    private void CheckGeneration(Guid generation) { if (_disabled || _generation != generation) throw InvalidSession(); }
    private static ApiException InvalidSession() => new(HttpStatusCode.Unauthorized, "SESSION_INVALID");

    private void Invalidate()
    {
        _disabled = true;
        _generation = Guid.NewGuid();
        _access = null;
        _flight = null;
        tokens.Clear(_scope);
    }

    public Task SignOutAsync() => SignOutAsync(Guid.NewGuid());

    private async Task SignOutAsync(Guid nextGeneration)
    {
        DesktopCredentialRecord? saved;
        (Guid Id, Task<TokenEnvelope> Task)? shared;
        Task<TokenEnvelope>? exchange;
        (Guid Id, DesktopCredentialRecord? Saved, Task<TokenEnvelope>? Refresh, Task<TokenEnvelope>? Exchange)? recovery;
        Exception? clearError = null;
        lock (_gate)
        {
            _disabled = true;
            _generation = nextGeneration;
            _access = null;
            shared = _flight;
            _flight = null;
            exchange = _exchange?.Task;
            _exchange = null;
            saved = tokens.Load(_scope);
            if (_logoutRecovery is null && (saved is not null || exchange is not null))
                _logoutRecovery = (Guid.NewGuid(), saved, shared?.Task, exchange);
            recovery = _logoutRecovery;
            try { tokens.Clear(_scope); } catch (Exception error) { clearError = error; }
        }
        if (recovery is null)
        {
            if (clearError is not null) throw clearError;
            return;
        }
        Task remote;
        lock (_gate) { remote = _logoutFlight ??= Task.Run(() => RevokeAsync(recovery.Value)); }
        try { await remote; }
        catch (Exception)
        {
            lock (_gate) { if (_logoutFlight == remote) _logoutFlight = null; }
            throw new ApiException(HttpStatusCode.ServiceUnavailable, "REMOTE_LOGOUT_UNCONFIRMED");
        }
        lock (_gate) { if (_logoutFlight == remote) _logoutFlight = null; }
        if (clearError is not null) throw clearError;
        lock (_gate) { if (_logoutRecovery?.Id == recovery.Value.Id) _logoutRecovery = null; }
    }

    private async Task RevokeAsync((Guid Id, DesktopCredentialRecord? Saved, Task<TokenEnvelope>? Refresh, Task<TokenEnvelope>? Exchange) recovery)
    {
        var saved = recovery.Saved;
        var exchange = recovery.Exchange;
        try
        {
            var refresh = saved?.RefreshToken ?? "";
            if (exchange is not null) refresh = (await exchange).RefreshToken;
            else if (recovery.Refresh is { } pendingRefresh)
            {
                try { refresh = (await pendingRefresh).RefreshToken; }
                catch when (saved?.Pending is not null) { refresh = (await RefreshRemoteAsync(saved.Pending)).RefreshToken; }
            }
            else if (saved?.Pending is not null) refresh = (await RefreshRemoteAsync(saved.Pending)).RefreshToken;
            var result = await transport.SendAsync("/api/auth/desktop/logout", new() { ["refresh_token"] = refresh });
            if (result["ok"]?.GetValue<bool>() != true) throw new JsonException("Logout not confirmed");
        }
        catch (Exception) { throw new ApiException(HttpStatusCode.ServiceUnavailable, "REMOTE_LOGOUT_UNCONFIRMED"); }
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
