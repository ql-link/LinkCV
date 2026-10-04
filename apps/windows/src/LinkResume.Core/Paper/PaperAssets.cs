using System.Buffers.Binary;
using System.Net;
using System.Text.Json.Nodes;
using LinkResume.Core.Api;
using LinkResume.Core.Models;

namespace LinkResume.Core.Paper;

public sealed record DesktopImage(byte[] Data, string ContentType);
public sealed record PaperPreparation(ResumeRenderRequest Request, int MissingImageCount);

// No disk/global cache: data URLs belong only to the current paper request.
public static class PaperAssets
{
    public const int MaximumBytes = 10 * 1024 * 1024;
    public const int MaximumImages = 32;
    public const string Placeholder = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGM4c+bMfwAIMANkhLK+mwAAAABJRU5ErkJggg==";
    private static readonly HashSet<string> Bundled = new(new[] { "avatar-administrative.png", "avatar-administrative.svg", "avatar-campus.png", "avatar-campus.svg", "avatar-cat.jpg", "avatar-civic.png", "avatar-civic.svg", "avatar-creative.png", "avatar-creative.svg" }.Select(name => "/templates/" + name));

    public static HashSet<string> Sources(JsonNode? value)
    {
        var result = new HashSet<string>(StringComparer.Ordinal);
        if (value is JsonObject fields)
        {
            if (fields["media_kind"] is JsonValue && fields["src"] is JsonValue source && source.TryGetValue<string>(out var src)) result.Add(src);
            foreach (var field in fields) result.UnionWith(Sources(field.Value));
        }
        else if (value is JsonArray array) foreach (var item in array) result.UnionWith(Sources(item));
        return result;
    }

    public static string PathFor(string source, string account)
    {
        if (source.Length > 2048 || source.Contains('?') || source.Contains('#')) throw new InvalidDataException();
        var decoded = Uri.UnescapeDataString(source);
        if (decoded.Contains('%') || decoded.Contains('\\') || decoded.Contains("..")) throw new InvalidDataException();
        var parts = decoded.Split('/');
        string file;
        if (parts.Length == 6 && parts[0] == "" && parts[1] == "api" && parts[2] == "resumes" && parts[4] == "assets" && parts[3].Length > 0 && parts[3].All(char.IsAsciiDigit)) file = parts[5];
        else if (parts.Length == 7 && parts[0] == "" && parts[1] == "api" && parts[2] == "assets" && parts[3] == "users" && parts[4] == account && parts[5] == "assets") file = parts[6];
        else if (parts.Length == 8 && parts[0] == "" && parts[1] == "api" && parts[2] == "assets" && parts[3] == "users" && parts[4] == account && parts[5] == "assets" && parts[6] == "avatar") file = parts[7];
        else throw new InvalidDataException();
        if (file.Length is 0 or > 240 || !file.All(c => char.IsLetterOrDigit(c) || "._-".Contains(c)) || !new[] { ".png", ".jpg", ".jpeg" }.Contains(System.IO.Path.GetExtension(file).ToLowerInvariant())) throw new InvalidDataException();
        return decoded;
    }

    public static string DataUrl(DesktopImage image, int limit)
    {
        var data = image.Data.AsSpan();
        if (data.Length == 0 || data.Length > limit) throw new InvalidDataException();
        uint width = 0, height = 0;
        if (image.ContentType == "image/png" && data.Length >= 33 && data[..8].SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) && data.Slice(12, 4).SequenceEqual("IHDR"u8))
        { width = BinaryPrimitives.ReadUInt32BigEndian(data.Slice(16, 4)); height = BinaryPrimitives.ReadUInt32BigEndian(data.Slice(20, 4)); }
        else if (image.ContentType == "image/jpeg" && data.Length >= 4 && data[0] == 255 && data[1] == 216 && data[^2] == 255 && data[^1] == 217)
        {
            var offset = 2;
            while (offset + 4 <= data.Length)
            {
                if (data[offset++] != 255) throw new InvalidDataException();
                while (offset < data.Length && data[offset] == 255) offset++;
                if (offset >= data.Length) break;
                var marker = data[offset++];
                if (marker is 0xD9 or 0xDA) break;
                if (marker is >= 0xD0 and <= 0xD7 or 0x01) continue;
                if (offset + 2 > data.Length) break;
                var length = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(offset, 2));
                if (length < 2 || offset + length > data.Length) throw new InvalidDataException();
                if (marker is 0xC0 or 0xC1 or 0xC2 or 0xC3 or 0xC5 or 0xC6 or 0xC7 or 0xC9 or 0xCA or 0xCB or 0xCD or 0xCE or 0xCF)
                {
                    if (length < 8) throw new InvalidDataException();
                    height = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(offset + 3, 2));
                    width = BinaryPrimitives.ReadUInt16BigEndian(data.Slice(offset + 5, 2));
                    break;
                }
                offset += length;
            }
        }
        if (width == 0 || height == 0 || (ulong)width * height > 40_000_000) throw new InvalidDataException();
        return $"data:{image.ContentType};base64,{Convert.ToBase64String(image.Data)}";
    }

    public static async Task<PaperPreparation> PrepareAsync(ResumeRenderRequest request, string account,
        Func<string, int, CancellationToken, Task<DesktopImage>> download, CancellationToken ct = default)
    {
        var assets = new Dictionary<string, string>(StringComparer.Ordinal);
        int remaining = MaximumBytes, failures = 0, downloads = 0;
        foreach (var source in Sources(request.Data).Order(StringComparer.Ordinal).Where(src => !Bundled.Contains(src)))
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                if (downloads >= MaximumImages || remaining <= 0) throw new InvalidDataException();
                var path = PathFor(source, account);
                downloads++;
                var image = await download(path, remaining, ct);
                assets[source] = DataUrl(image, remaining);
                remaining -= image.Data.Length;
            }
            catch (OperationCanceledException) { throw; }
            catch (ApiException error) when (error.Status == HttpStatusCode.Unauthorized) { throw; }
            catch { assets[source] = Placeholder; failures++; }
        }
        return new(request with { Assets = assets }, failures);
    }
}
