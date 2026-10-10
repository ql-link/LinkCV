using System.Text.Json;
using System.Text.Json.Serialization;
using DrawOffer.Core.Models;

namespace DrawOffer.Core.Paper;

/// <summary>Public fictional examples. No session, credentials or HTTP transport.</summary>
public static class GuestTemplates
{
    public static async Task<IReadOnlyList<ResumeTemplate>> LoadAsync(CancellationToken ct = default)
    {
        await using var stream = typeof(GuestTemplates).Assembly.GetManifestResourceStream("DrawOffer.Core.resume-templates.json")
            ?? throw new InvalidDataException("Bundled examples missing");
        return (await JsonSerializer.DeserializeAsync<Envelope>(stream, cancellationToken: ct))?.Templates ?? [];
    }

    public static Task<PaperPreparation> PrepareAsync(ResumeTemplate template, CancellationToken ct = default)
        => PaperAssets.PrepareAsync(template.ToRenderRequest(), "", (_, _, _) => throw new InvalidDataException(), ct);

    private sealed record Envelope([property: JsonPropertyName("templates")] List<ResumeTemplate> Templates);
}
