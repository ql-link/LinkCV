using System.Collections.Concurrent;
using System.Net;
using System.Text.Json.Nodes;
using DrawOffer.Core.Api;
using DrawOffer.Core.Models;
using DrawOffer.Core.Paper;
using DrawOffer.Core.Session;
using Xunit;

namespace DrawOffer.Core.Tests;

public class DesktopSessionTests
{
    private sealed class Store : ITokenStore
    {
        private readonly object _gate = new();
        public DesktopCredentialRecord? Record = new("1", "fixture-session.old-secret", Guid.NewGuid());
        public bool FailCommit;
        public bool FailClear;
        public string? Scope;
        public DesktopCredentialRecord? Load(string scope) { lock (_gate) { Scope = scope; return Record; } }
        public void Save(string scope, DesktopCredentialRecord record)
        {
            lock (_gate)
            {
                Scope = scope;
                if (FailCommit && record.Pending is null) throw new IOException("Fixture storage unavailable");
                Record = record;
            }
        }
        public void Clear(string scope) { lock (_gate) { if (FailClear) throw new IOException("Fixture clear denied"); Record = null; } }
    }

    private sealed class Transport : IDesktopTransport
    {
        public Uri Origin => new("https://api.example.test");
        public ConcurrentQueue<(string Path, Dictionary<string, string>? Body, string? Access)> Calls { get; } = new();
        public Func<string,Task> DatasetHandler = _=>Task.CompletedTask;
        public string? DatasetTarget;
        public async Task DownloadDatasetAsync(string id,string target,long limit,string? access,CancellationToken ct=default){DatasetTarget=target;Calls.Enqueue(("/api/datasets/"+id+"/source",null,access));await DatasetHandler(target);await File.WriteAllTextAsync(target,"fictional private file",ct);}
        public Func<string, Task<DesktopImage>> ImageHandler = _ => Task.FromResult(new DesktopImage(Convert.FromBase64String(PaperAssets.Placeholder.Split(',')[1]), "image/png"));
        public Task<DesktopImage> DownloadImageAsync(string path, int limit, string? access, CancellationToken ct = default)
        { Calls.Enqueue((path, null, access)); return ImageHandler(path); }
        public Func<string, Task<JsonNode>> Handler = path => Task.FromResult(path == "/api/auth/desktop/refresh" ? Tokens() : JsonNode.Parse("{\"templates\":[]}")!);
        public Task<JsonNode> SendAsync(string path, Dictionary<string, string>? body = null, string? access = null, CancellationToken ct = default)
        {
            Calls.Enqueue((path, body is null ? null : new(body), access));
            return Handler(path);
        }
    }

    private static JsonNode Tokens() => JsonNode.Parse("""
        {"user":{"id":"1","email":null,"nickname":"张三","is_admin":false},
         "access_token":"fixture-access","refresh_token":"fixture-session.new-secret","expires_in":600,"session_protocol":1}
        """)!;

    [Fact]
    public async Task ConcurrentRequestsShareRefreshAndCallerCancellationDoesNotCancelIt()
    {
        var store = new Store();
        var transport = new Transport();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource<JsonNode>(TaskCreationOptions.RunContinuationsAsynchronously);
        transport.Handler = path =>
        {
            if (path != "/api/auth/desktop/refresh") return Task.FromResult(JsonNode.Parse("{\"templates\":[]}")!);
            entered.TrySetResult();
            return release.Task;
        };
        var coordinator = new SessionCoordinator(transport, store);
        using var cancellation = new CancellationTokenSource();
        var canceled = coordinator.RequestAsync("/api/resume-templates", cancellation.Token);
        var requests = Enumerable.Range(0, 10).Select(_ => coordinator.RequestAsync("/api/resume-templates")).ToArray();
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => canceled);
        release.SetResult(Tokens());
        await Task.WhenAll(requests);
        Assert.Single(transport.Calls.Where(call => call.Path == "/api/auth/desktop/refresh"));
        Assert.All(transport.Calls.Where(call => call.Path == "/api/resume-templates"), call => Assert.Equal("fixture-access", call.Access));
        Assert.Null(store.Record!.Pending);
        Assert.Equal("fixture-session.new-secret", store.Record.RefreshToken);
        Assert.Equal("LinkResume:windows:desktop:https://api.example.test/", store.Scope);
    }

    [Fact]
    public async Task NetworkFailureKeepsJournalAndReusesRequestId()
    {
        var store = new Store();
        var transport = new Transport { Handler = _ => Task.FromException<JsonNode>(new HttpRequestException("Fixture offline")) };
        var coordinator = new SessionCoordinator(transport, store);
        await Assert.ThrowsAsync<HttpRequestException>(() => coordinator.RequestAsync("/api/resume-templates"));
        var requestId = store.Record!.Pending!.RequestId;
        transport.Handler = path => Task.FromResult(path == "/api/auth/desktop/refresh" ? Tokens() : JsonNode.Parse("{\"templates\":[]}")!);
        await coordinator.RequestAsync("/api/resume-templates");
        Assert.All(transport.Calls.Where(call => call.Path == "/api/auth/desktop/refresh"), call => Assert.Equal(requestId, call.Body!["request_id"]));
    }

    [Fact]
    public async Task SaveFailureDoesNotExposeAccessAndRetryUsesPendingJournal()
    {
        var store = new Store { FailCommit = true };
        var transport = new Transport();
        var coordinator = new SessionCoordinator(transport, store);
        await Assert.ThrowsAsync<IOException>(() => coordinator.RequestAsync("/api/resume-templates"));
        Assert.DoesNotContain(transport.Calls, call => call.Path == "/api/resume-templates");
        var journal = store.Record!.Pending!;
        store.FailCommit = false;
        await coordinator.RequestAsync("/api/resume-templates");
        Assert.All(transport.Calls.Where(call => call.Path == "/api/auth/desktop/refresh"), call => Assert.Equal(journal.RequestId, call.Body!["request_id"]));
    }

    [Fact]
    public async Task RefreshUnauthorizedClearsCredentials()
    {
        var store = new Store();
        var transport = new Transport { Handler = _ => Task.FromException<JsonNode>(new ApiException(HttpStatusCode.Unauthorized, "SESSION_INVALID")) };
        var coordinator = new SessionCoordinator(transport, store);
        await Assert.ThrowsAsync<ApiException>(() => coordinator.RequestAsync("/api/resume-templates"));
        Assert.Null(store.Record);
        Assert.Null(await coordinator.RestoreAsync());
    }

    [Fact]
    public async Task SignOutWaitsForRefreshAndDoesNotRestoreLateResult()
    {
        var store = new Store();
        var transport = new Transport();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource<JsonNode>(TaskCreationOptions.RunContinuationsAsynchronously);
        transport.Handler = path =>
        {
            if (path == "/api/auth/desktop/refresh") { entered.TrySetResult(); return release.Task; }
            return Task.FromResult(JsonNode.Parse("{\"ok\":true}")!);
        };
        var coordinator = new SessionCoordinator(transport, store);
        var request = coordinator.RequestAsync("/api/resume-templates");
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var logout = coordinator.SignOutAsync();
        Assert.Null(store.Record);
        release.SetResult(Tokens());
        await logout;
        await Assert.ThrowsAsync<ApiException>(() => request);
        Assert.Null(store.Record);
        var call = Assert.Single(transport.Calls.Where(call => call.Path == "/api/auth/desktop/logout"));
        Assert.Equal("fixture-session.new-secret", call.Body!["refresh_token"]);
        Assert.Null(await coordinator.RestoreAsync());
    }

    [Fact]
    public async Task SignOutRecoversFailedRefreshWithTheSameJournal()
    {
        var store = new Store();
        var transport = new Transport();
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource<JsonNode>(TaskCreationOptions.RunContinuationsAsynchronously);
        var attempts = 0;
        transport.Handler = path =>
        {
            if (path != "/api/auth/desktop/refresh") return Task.FromResult(JsonNode.Parse("{\"ok\":true}")!);
            if (Interlocked.Increment(ref attempts) != 1) return Task.FromResult(Tokens());
            entered.TrySetResult();
            return release.Task;
        };
        var coordinator = new SessionCoordinator(transport, store);
        var request = coordinator.RequestAsync("/api/resume-templates");
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var journal = store.Record!.Pending!;
        var logout = coordinator.SignOutAsync();
        release.SetException(new HttpRequestException("Fixture lost response"));
        await logout;
        await Assert.ThrowsAsync<HttpRequestException>(() => request);
        var refreshes = transport.Calls.Where(call => call.Path == "/api/auth/desktop/refresh").ToArray();
        Assert.Equal(2, refreshes.Length);
        Assert.All(refreshes, call =>
        {
            Assert.Equal(journal.RequestId, call.Body!["request_id"]);
            Assert.Equal(journal.RefreshToken, call.Body["refresh_token"]);
        });
        Assert.Equal("fixture-session.new-secret", Assert.Single(transport.Calls.Where(call => call.Path == "/api/auth/desktop/logout")).Body!["refresh_token"]);
        Assert.Null(store.Record);
        Assert.Null(await coordinator.RestoreAsync());
    }

    [Fact]
    public async Task BeginLoginCannotUndoANewerSignOut()
    {
        var store = new Store();
        var release = new TaskCompletionSource<JsonNode>(TaskCreationOptions.RunContinuationsAsynchronously);
        var transport = new Transport { Handler = _ => release.Task };
        var coordinator = new SessionCoordinator(transport, store);
        var login = coordinator.BeginLoginAsync("1.0.0");
        Assert.Null(store.Record);
        var logout = coordinator.SignOutAsync();
        release.SetResult(JsonNode.Parse("{\"ok\":true}")!);
        await logout;
        await Assert.ThrowsAsync<ApiException>(() => login);
        Assert.DoesNotContain(transport.Calls, call => call.Path == "/api/auth/desktop/wechat/qrcode");
        Assert.Single(transport.Calls, call => call.Path == "/api/auth/desktop/logout");
        Assert.Null(await coordinator.RestoreAsync());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SignOutRejectsLateLoginResponse(bool exchange)
    {
        var store = new Store { Record = null };
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource<JsonNode>(TaskCreationOptions.RunContinuationsAsynchronously);
        var heldPath = exchange ? "/api/auth/desktop/wechat/exchange" : "/api/auth/desktop/wechat/status";
        var transport = new Transport
        {
            Handler = path =>
            {
                if (path == heldPath) { entered.TrySetResult(); return release.Task; }
                return Task.FromResult(path == "/api/auth/desktop/wechat/qrcode"
                    ? JsonNode.Parse("{\"scene\":\"desktop:0123456789abcdef\",\"poll_token\":\"fixture-poll\"}")!
                    : JsonNode.Parse("{\"ok\":true}")!);
            },
        };
        var coordinator = new SessionCoordinator(transport, store);
        var challenge = await coordinator.BeginLoginAsync("1.0.0");
        Task response = exchange ? coordinator.CompleteLoginAsync(challenge) : coordinator.LoginStatusAsync(challenge);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        var logout = coordinator.SignOutAsync();
        release.SetResult(exchange ? Tokens() : JsonNode.Parse("{\"status\":\"confirmed\"}")!);
        await logout;
        await Assert.ThrowsAsync<ApiException>(() => response);
        Assert.Null(store.Record);
        Assert.Null(await coordinator.RestoreAsync());
        if (exchange)
            Assert.Equal("fixture-session.new-secret", Assert.Single(transport.Calls.Where(call => call.Path == "/api/auth/desktop/logout")).Body!["refresh_token"]);
    }

    [Fact]
    public async Task SignOutFailureStillDisablesLocalSession()
    {
        var store = new Store();
        var transport = new Transport { Handler = _ => Task.FromException<JsonNode>(new HttpRequestException("Fixture offline")) };
        var coordinator = new SessionCoordinator(transport, store);
        var error = await Assert.ThrowsAsync<ApiException>(() => coordinator.SignOutAsync());
        Assert.Equal("REMOTE_LOGOUT_UNCONFIRMED", error.Code);
        Assert.Null(store.Record);
        Assert.Null(await coordinator.RestoreAsync());
    }

    [Theory]
    [InlineData("http://api.example.test", false)]
    [InlineData("http://localhost:8000", false)]
    [InlineData("https://user:secret@api.example.test", false)]
    [InlineData("https://api.example.test/untrusted", false)]
    public void RejectsUntrustedOrigin(string origin, bool local)
        => Assert.Throws<ArgumentException>(() => new DesktopTransport(new Uri(origin), local));

    private static Transport LoginTransport() => new()
    {
        Handler = path => Task.FromResult(path == "/api/auth/desktop/wechat/qrcode"
            ? JsonNode.Parse("{\"scene\":\"desktop:0123456789abcdef\",\"poll_token\":\"fixture-poll\"}")!
            : path == "/api/auth/desktop/wechat/exchange" ? Tokens() : JsonNode.Parse("{\"ok\":true}")!),
    };

    [Fact]
    public async Task RemoteLogoutCanRetryAfterLocalCredentialsWereCleared()
    {
        var store = new Store();
        var transport = new Transport { Handler = _ => Task.FromException<JsonNode>(new HttpRequestException("Fixture offline")) };
        var coordinator = new SessionCoordinator(transport, store);
        await Assert.ThrowsAsync<ApiException>(() => coordinator.SignOutAsync());
        Assert.Null(store.Record);
        transport.Handler = _ => Task.FromResult(JsonNode.Parse("{\"ok\":true}")!);
        await coordinator.SignOutAsync();
        Assert.Equal(2, transport.Calls.Count(call => call.Path == "/api/auth/desktop/logout"));
        Assert.All(transport.Calls, call => Assert.Equal("fixture-session.old-secret", call.Body!["refresh_token"]));
        Assert.Null(await coordinator.RestoreAsync());
    }

    [Fact]
    public async Task LoginSaveFailureRetriesSharedExchangeWithoutExposingAccess()
    {
        var store = new Store { Record = null };
        var transport = LoginTransport();
        var coordinator = new SessionCoordinator(transport, store);
        var challenge = await coordinator.BeginLoginAsync("1.0.0");
        store.FailCommit = true;
        await Assert.ThrowsAsync<IOException>(() => coordinator.CompleteLoginAsync(challenge));
        Assert.Null(store.Record);
        await Assert.ThrowsAsync<ApiException>(() => coordinator.RequestAsync("/api/resume-templates"));
        store.FailCommit = false;
        Assert.Equal("1", (await coordinator.CompleteLoginAsync(challenge)).Id);
        Assert.Single(transport.Calls, call => call.Path == "/api/auth/desktop/wechat/exchange");
        Assert.Equal("fixture-session.new-secret", store.Record!.RefreshToken);
    }

    [Fact]
    public async Task CancelledLoginWaiterCanRetrySharedExchange()
    {
        var store = new Store { Record = null };
        var transport = LoginTransport();
        var coordinator = new SessionCoordinator(transport, store);
        var challenge = await coordinator.BeginLoginAsync("1.0.0");
        var release = new TaskCompletionSource<JsonNode>(TaskCreationOptions.RunContinuationsAsynchronously);
        transport.Handler = _ => release.Task;
        using var cancellation = new CancellationTokenSource();
        var waiter = coordinator.CompleteLoginAsync(challenge, cancellation.Token);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiter);
        Assert.Null(store.Record);
        var retry = coordinator.CompleteLoginAsync(challenge);
        release.SetResult(Tokens());
        Assert.Equal("1", (await retry).Id);
        Assert.Single(transport.Calls, call => call.Path == "/api/auth/desktop/wechat/exchange");
    }

    [Fact]
    public async Task SecondBusinessUnauthorizedInvalidatesAndRetriesOnlyOnce()
    {
        var store = new Store();
        var transport = new Transport
        {
            Handler = path => path == "/api/auth/desktop/refresh" ? Task.FromResult(Tokens())
                : Task.FromException<JsonNode>(new ApiException(HttpStatusCode.Unauthorized, "SESSION_INVALID")),
        };
        var coordinator = new SessionCoordinator(transport, store);
        await Assert.ThrowsAsync<ApiException>(() => coordinator.RequestAsync("/api/resume-templates"));
        Assert.Equal(2, transport.Calls.Count(call => call.Path == "/api/resume-templates"));
        Assert.Equal(2, transport.Calls.Count(call => call.Path == "/api/auth/desktop/refresh"));
        Assert.Null(store.Record);
        Assert.Null(await coordinator.RestoreAsync());
    }

    [Fact]
    public async Task ExpiredJournalNeverReplaysAndClearsCredentials()
    {
        var store = new Store { Record = new("1", "fixture-token", Guid.NewGuid(),
            new RefreshJournal(Guid.NewGuid().ToString(), "fixture-token", DateTimeOffset.UtcNow.AddSeconds(-121))) };
        var transport = new Transport();
        var coordinator = new SessionCoordinator(transport, store);
        await Assert.ThrowsAsync<ApiException>(() => coordinator.RestoreAsync());
        Assert.Empty(transport.Calls);
        Assert.Null(store.Record);
    }

    [Fact]
    public async Task ClearFailureDisablesSessionAndCanRetryCleanup()
    {
        var store = new Store { FailClear = true };
        var transport = LoginTransport();
        var coordinator = new SessionCoordinator(transport, store);
        await Assert.ThrowsAsync<IOException>(() => coordinator.SignOutAsync());
        Assert.Single(transport.Calls, call => call.Path == "/api/auth/desktop/logout");
        Assert.NotNull(store.Record);
        Assert.Null(await coordinator.RestoreAsync());
        await Assert.ThrowsAsync<ApiException>(() => coordinator.RequestAsync("/api/resume-templates"));
        store.FailClear = false;
        await coordinator.SignOutAsync();
        Assert.Null(store.Record);
    }
    private static ResumeRenderRequest ImagePaper() => new("虚构头像", JsonNode.Parse("{\"media_kind\":\"avatar\",\"src\":\"/api/resumes/42/assets/a.png\"}")!, new JsonObject(), null);

    [Fact]
    public async Task PrivateImageUsesAccessAndCannotReturnAfterLogout()
    {
        var store = new Store();
        var transport = new Transport { Handler = path => Task.FromResult(path == "/api/auth/desktop/logout" ? JsonNode.Parse("{\"ok\":true}")! : Tokens()) };
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource<DesktopImage>(TaskCreationOptions.RunContinuationsAsynchronously);
        transport.ImageHandler = _ => { entered.SetResult(); return release.Task; };
        var coordinator = new SessionCoordinator(transport, store);
        var pending = coordinator.PreparePaperAsync(ImagePaper(), TestContext.Current.CancellationToken);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await coordinator.SignOutAsync();
        release.SetResult(new(Convert.FromBase64String(PaperAssets.Placeholder.Split(',')[1]), "image/png"));
        await Assert.ThrowsAsync<ApiException>(() => pending);
        Assert.Equal("fixture-access", transport.Calls.First(call => call.Path.EndsWith("a.png")).Access);
        Assert.Null(store.Record);
    }

    [Fact]
    public async Task PrivateImageUnauthorizedRefreshesOnceThenInvalidates()
    {
        var store = new Store();
        var transport = new Transport();
        int failures = 1;
        transport.ImageHandler = _ => failures-- > 0 ? Task.FromException<DesktopImage>(new ApiException(HttpStatusCode.Unauthorized, "UNAUTHORIZED")) : Task.FromResult(new DesktopImage(Convert.FromBase64String(PaperAssets.Placeholder.Split(',')[1]), "image/png"));
        var coordinator = new SessionCoordinator(transport, store);
        var prepared = await coordinator.PreparePaperAsync(ImagePaper(), TestContext.Current.CancellationToken);
        Assert.Equal(0, prepared.MissingImageCount);
        Assert.Equal(2, transport.Calls.Count(call => call.Path.EndsWith("a.png")));
        failures = 2;
        await Assert.ThrowsAsync<ApiException>(() => coordinator.PreparePaperAsync(ImagePaper(), TestContext.Current.CancellationToken));
        Assert.Null(store.Record);
    }


    [Fact] public async Task LibraryLateDownloadAfterLogoutRejectsAndCleansTemporaryFile(){var store=new Store();var transport=new Transport{Handler=path=>Task.FromResult(path=="/api/auth/desktop/logout"?JsonNode.Parse("{\"ok\":true}")!:path=="/api/auth/desktop/refresh"?Tokens():JsonNode.Parse("{\"templates\":[]}")!)};var coordinator=new SessionCoordinator(transport,store);await coordinator.RequestAsync("/api/resume-templates");var entered=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);var release=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);transport.DatasetHandler=async _=>{entered.SetResult();await release.Task;};var pending=coordinator.DownloadDatasetAsync("1",1024);await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));var target=transport.DatasetTarget!;await coordinator.SignOutAsync();release.SetResult();await Assert.ThrowsAsync<ApiException>(()=>pending);Assert.False(Directory.Exists(Path.GetDirectoryName(target)));}
}
