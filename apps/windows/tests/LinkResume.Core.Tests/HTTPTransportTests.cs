using System.Net;
using System.Net.Sockets;
using System.Text;
using LinkResume.Core.Api;
using LinkResume.Core.Paper;
using Xunit;

namespace LinkResume.Core.Tests;

public class HTTPTransportTests
{
    [Fact]
    public async Task RealHttpDoesNotAcceptCookiesAndRejectsRedirectWithoutForwardingBearer()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var origin = new Uri($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var requests = new List<string>();
        var server = Task.Run(async () =>
        {
            for (var index = 0; index < 3; index++)
            {
                using var client = await listener.AcceptTcpClientAsync(timeout.Token);
                await using var stream = client.GetStream();
                var bytes = new byte[8192];
                var request = new StringBuilder();
                while (!request.ToString().Contains("\r\n\r\n", StringComparison.Ordinal))
                {
                    var count = await stream.ReadAsync(bytes, timeout.Token);
                    if (count == 0) break;
                    request.Append(Encoding.ASCII.GetString(bytes, 0, count));
                }
                requests.Add(request.ToString());
                var headers = index == 2 ? $"302 Found\r\nLocation: {origin}api/redirect-target"
                    : "200 OK\r\nSet-Cookie: transport-fixture=secret; Path=/";
                var response = Encoding.ASCII.GetBytes($"HTTP/1.1 {headers}\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{{\"ok\":true}}");
                await stream.WriteAsync(response, timeout.Token);
            }
            listener.Stop();
        }, timeout.Token);
        using var transport = new DesktopTransport(origin, allowLocalHttp: true);
        Assert.True((await transport.SendAsync("/api/first", access: "fixture-access", ct: timeout.Token))["ok"]!.GetValue<bool>());
        Assert.True((await transport.SendAsync("/api/second", ct: timeout.Token))["ok"]!.GetValue<bool>());
        var error = await Assert.ThrowsAsync<ApiException>(() => transport.SendAsync("/api/redirect", access: "fixture-access", ct: timeout.Token));
        Assert.Equal(HttpStatusCode.Found, error.Status);
        await server;
        Assert.Equal(3, requests.Count);
        Assert.All(requests, request => Assert.DoesNotContain("\r\nCookie:", request, StringComparison.OrdinalIgnoreCase));
        Assert.Contains("Bearer fixture-access", requests[0]);
        Assert.DoesNotContain("Authorization:", requests[1], StringComparison.OrdinalIgnoreCase);
    }
    [Fact]
    public async Task CareerHttpEncodesQueryAndRejectsRedirectWithoutCookies()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var origin = new Uri($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var requests = new List<string>();
        var server = Task.Run(async () =>
        {
            for (var index = 0; index < 3; index++)
            {
                using var client = await listener.AcceptTcpClientAsync(timeout.Token);
                await using var stream = client.GetStream();
                var bytes = new byte[8192];
                var request = new StringBuilder();
                while (!request.ToString().Contains("\r\n\r\n", StringComparison.Ordinal))
                {
                    var count = await stream.ReadAsync(bytes, timeout.Token);
                    if (count == 0) break;
                    request.Append(Encoding.ASCII.GetString(bytes, 0, count));
                }
                requests.Add(request.ToString());
                var headers = index == 2 ? $"302 Found\r\nLocation: {origin}api/redirect-target"
                    : "200 OK\r\nSet-Cookie: transport-fixture=secret; Path=/";
                var response = Encoding.ASCII.GetBytes($"HTTP/1.1 {headers}\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{{\"ok\":true}}");
                await stream.WriteAsync(response, timeout.Token);
            }
            listener.Stop();
        }, timeout.Token);
        using var transport = new DesktopTransport(origin, allowLocalHttp: true);
        Assert.True((await transport.CareerAsync("/api/job-applications","GET",new(){{"cursor","a&b=岗位"}},null,"fixture-access", timeout.Token))["ok"]!.GetValue<bool>());
        Assert.True((await transport.CareerAsync("/api/job-applications/1/stages","POST",null,new System.Text.Json.Nodes.JsonObject{["base_lock_version"]=2},"fixture-access",timeout.Token))["ok"]!.GetValue<bool>());
        var error = await Assert.ThrowsAsync<ApiException>(() => transport.CareerAsync("/api/job-applications/1","GET",null,null,"fixture-access",timeout.Token));
        Assert.Equal(HttpStatusCode.Found, error.Status);
        await server;
        Assert.Equal(3, requests.Count);
        Assert.All(requests, request => Assert.DoesNotContain("\r\nCookie:", request, StringComparison.OrdinalIgnoreCase));
        Assert.Contains("Bearer fixture-access", requests[0]);
        Assert.Contains("POST /api/job-applications/1/stages",requests[1]);
        Assert.Contains("cursor=a%26b",requests[0]);
    }
    [Fact]
    public async Task ImageHttpStreamsBoundedBytesRejectsMimeAndRedirectsWithoutCookies()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var origin = new Uri($"http://127.0.0.1:{((IPEndPoint)listener.LocalEndpoint).Port}/");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var requests = new List<string>();
        var png = Convert.FromBase64String(PaperAssets.Placeholder.Split(',')[1]);
        var server = Task.Run(async () => {
            for (int index = 0; index < 5; index++)
            {
                using var client = await listener.AcceptTcpClientAsync(timeout.Token);
                await using var stream = client.GetStream();
                var request = new StringBuilder();
                var buffer = new byte[4096];
                while (!request.ToString().Contains("\r\n\r\n")) { var count = await stream.ReadAsync(buffer, timeout.Token); if (count == 0) break; request.Append(Encoding.ASCII.GetString(buffer, 0, count)); }
                requests.Add(request.ToString());
                var body = index == 2 ? new byte[100] : png;
                var status = index == 3 ? $"302 Found\r\nLocation: {origin}api/redirect-target" : "200 OK";
                var length = index == 2 ? "" : $"Content-Length: {(index == 1 ? 1000 : body.Length)}\r\n";
                var type = index == 4 ? "text/html" : "image/png";
                var header = Encoding.ASCII.GetBytes($"HTTP/1.1 {status}\r\nSet-Cookie: image-fixture=secret; Path=/\r\nContent-Type: {type}\r\n{length}Connection: close\r\n\r\n");
                await stream.WriteAsync(header, timeout.Token);
                await stream.WriteAsync(body, timeout.Token);
            }
            listener.Stop();
        }, timeout.Token);
        using var transport = new DesktopTransport(origin, allowLocalHttp: true);
        var image = await transport.DownloadImageAsync("/api/resumes/42/assets/a.png", 100, "fixture-access", timeout.Token);
        Assert.Equal(PaperAssets.Placeholder, PaperAssets.DataUrl(image, 100));
        await Assert.ThrowsAsync<InvalidDataException>(() => transport.DownloadImageAsync("/api/resumes/42/assets/large.png", 100, "fixture-access", timeout.Token));
        await Assert.ThrowsAsync<InvalidDataException>(() => transport.DownloadImageAsync("/api/resumes/42/assets/stream.png", 16, "fixture-access", timeout.Token));
        var redirect = await Assert.ThrowsAsync<ApiException>(() => transport.DownloadImageAsync("/api/resumes/42/assets/redirect.png", 100, "fixture-access", timeout.Token));
        Assert.Equal(HttpStatusCode.Found, redirect.Status);
        await Assert.ThrowsAsync<InvalidDataException>(() => transport.DownloadImageAsync("/api/resumes/42/assets/html.png", 100, "fixture-access", timeout.Token));
        await server;
        Assert.Equal(5, requests.Count);
        Assert.All(requests, request => { Assert.Contains("Bearer fixture-access", request); Assert.DoesNotContain("\r\nCookie:", request, StringComparison.OrdinalIgnoreCase); });
    }

}
