using System.Net;
using System.Text.Json.Nodes;
using LinkResume.Core.Api;
using LinkResume.Core.Models;
using LinkResume.Core.Paper;
using Xunit;

namespace LinkResume.Core.Tests;

public class PaperAssetsTests
{
    private static readonly byte[] Png = Convert.FromBase64String(PaperAssets.Placeholder.Split(',')[1]);
    private static ResumeRenderRequest Paper(IEnumerable<string> sources) => new("虚构图片测试", new JsonArray(sources.Select(src => (JsonNode)new JsonObject { ["media_kind"] = "resume_image", ["src"] = src }).ToArray()), new JsonObject(), null);

    [Fact]
    public void PathsRejectForeignOriginsTraversalAndAccounts()
    {
        Assert.Equal("/api/resumes/42/assets/照片.png", PaperAssets.PathFor("/api/resumes/42/assets/照片.png", "1"));
        Assert.Equal("/api/assets/users/1/assets/fixture.png", PaperAssets.PathFor("/api/assets/users%2F1%2Fassets%2Ffixture.png", "1"));
        Assert.Equal("/api/assets/users/1/assets/avatar/a.png", PaperAssets.PathFor("/api/assets/users%2F1%2Fassets%2Favatar%2Fa.png", "1"));
        foreach (var source in new[] { "https://api.example.test/api/resumes/42/assets/a.png", "//evil.example/a.png", "/api/resumes/42/assets/%2e%2e.png", "/api/resumes/42/assets/a%252F.png", "/api/resumes/42/assets/a.png?download=1", "/api/assets/users%2F2%2Fassets%2Fa.png", "/api/resumes/42/assets/a.svg", "/api/resumes/42/assets/a%2F.png" })
            Assert.Throws<InvalidDataException>(() => PaperAssets.PathFor(source, "1"));
    }

    [Fact]
    public void BytesValidateMimeDimensionsAndSize()
    {
        Assert.Equal(PaperAssets.Placeholder, PaperAssets.DataUrl(new(Png, "image/png"), Png.Length));
        Assert.Throws<InvalidDataException>(() => PaperAssets.DataUrl(new(Png, "image/jpeg"), 1000));
        Assert.Throws<InvalidDataException>(() => PaperAssets.DataUrl(new("not an image"u8.ToArray(), "image/png"), 1000));
        Assert.Throws<InvalidDataException>(() => PaperAssets.DataUrl(new(Png, "image/png"), Png.Length - 1));
        var huge = Png.ToArray();
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(huge.AsSpan(16, 4), 40_000_001);
        Assert.Throws<InvalidDataException>(() => PaperAssets.DataUrl(new(huge, "image/png"), 1000));
    }

    [Fact]
    public async Task DeduplicatesDegradesAndSerializesAssets()
    {
        Assert.DoesNotContain("\"assets\":null", Paper([]).ToJson());
        var paths = new List<string>();
        var source = "/api/resumes/42/assets/avatar.png";
        var missing = "/api/resumes/42/assets/missing.png";
        var original = Paper([source, source, missing, "/templates/avatar-cat.jpg", "https://evil.example/image.png"]);
        var prepared = await PaperAssets.PrepareAsync(original, "1", (path, limit, ct) => {
            paths.Add(path);
            return path.Contains("missing") ? Task.FromException<DesktopImage>(new ApiException(HttpStatusCode.NotFound, "ASSET_NOT_FOUND")) : Task.FromResult(new DesktopImage(Png, "image/png"));
        }, TestContext.Current.CancellationToken);
        Assert.Equal(2, paths.Count);
        Assert.Equal(2, prepared.MissingImageCount);
        Assert.Equal(PaperAssets.Placeholder, prepared.Request.Assets![source]);
        Assert.Equal(PaperAssets.Placeholder, prepared.Request.Assets[missing]);
        Assert.True(JsonNode.DeepEquals(original.Data, prepared.Request.Data));
        Assert.Contains("assets", prepared.Request.ToJson());
        Assert.DoesNotContain("Authorization", prepared.Request.ToJson());
        Assert.DoesNotContain("refresh_token", prepared.Request.ToJson());
    }

    [Fact]
    public async Task CapsImageCountAndPreservesCancellationAndUnauthorized()
    {
        int calls = 0;
        var prepared = await PaperAssets.PrepareAsync(Paper(Enumerable.Range(1, 40).Select(i => $"/api/resumes/42/assets/{i}.png")), "1", (_, _, _) => { calls++; return Task.FromResult(new DesktopImage(Png, "image/png")); }, TestContext.Current.CancellationToken);
        Assert.Equal(32, calls);
        Assert.Equal(8, prepared.MissingImageCount);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => PaperAssets.PrepareAsync(Paper(["/api/resumes/42/assets/a.png"]), "1", (_, _, _) => throw new OperationCanceledException()));
        await Assert.ThrowsAsync<ApiException>(() => PaperAssets.PrepareAsync(Paper(["/api/resumes/42/assets/a.png"]), "1", (_, _, _) => throw new ApiException(HttpStatusCode.Unauthorized, "UNAUTHORIZED")));
    }
    [Fact]
    public async Task ByteBudgetIsSharedAndJPEGIsAccepted()
    {
        using var stream = typeof(PaperAssetsTests).Assembly.GetManifestResourceStream("Fixture.avatar.jpg")!;
        using var jpeg = new MemoryStream();
        await stream.CopyToAsync(jpeg, TestContext.Current.CancellationToken);
        Assert.StartsWith("data:image/jpeg;base64,", PaperAssets.DataUrl(new(jpeg.ToArray(), "image/jpeg"), PaperAssets.MaximumBytes));
        var large = new byte[PaperAssets.MaximumBytes];
        Png.CopyTo(large, 0);
        var calls = 0;
        var prepared = await PaperAssets.PrepareAsync(Paper(["/api/resumes/42/assets/a.png", "/api/resumes/42/assets/b.png"]), "1", (_, _, _) => { calls++; return Task.FromResult(new DesktopImage(large, "image/png")); }, TestContext.Current.CancellationToken);
        Assert.Equal(1, calls);
        Assert.Equal(1, prepared.MissingImageCount);
        Assert.Equal(PaperAssets.Placeholder, prepared.Request.Assets!["/api/resumes/42/assets/b.png"]);
    }

}
