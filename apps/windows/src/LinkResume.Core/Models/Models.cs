using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace LinkResume.Core.Models;

/// <summary>与 <c>GET /api/auth/me</c> 的 user 对齐（apps/web/src/api/client.ts 的 User）。</summary>
public sealed record User(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("email")] string? Email,
    [property: JsonPropertyName("nickname")] string Nickname,
    [property: JsonPropertyName("is_admin")] bool IsAdmin);

/// <summary>
/// 简历模板。data / style / layout_plan 是后端契约里的深层结构，原生层只负责透传给纸面渲染器，
/// 所以保留为 <see cref="JsonNode"/>，不在 C# 里建模。
/// </summary>
public sealed record ResumeTemplate(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("key")] string Key,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("style_categories")] IReadOnlyList<string> StyleCategories,
    [property: JsonPropertyName("use_cases")] IReadOnlyList<string> UseCases,
    [property: JsonPropertyName("data")] JsonNode Data,
    [property: JsonPropertyName("style")] JsonNode Style,
    [property: JsonPropertyName("layout_plan")] JsonNode? LayoutPlan)
{
    /// <summary>组装纸面渲染请求，规则与 Web 端 client.ts 的 presentationForTemplate 一致。</summary>
    public ResumeRenderRequest ToRenderRequest()
    {
        var templateKey = Style["template_key"]?.GetValue<string>() ?? Key;
        var presentation = new JsonObject
        {
            ["schema_version"] = "resume-presentation.v1",
            ["portable"] = new JsonObject { ["smart_one_page"] = false },
            ["template_scoped"] = new JsonObject { [templateKey] = new JsonObject() },
            ["template_snapshot"] = Style.DeepClone(),
        };
        return new ResumeRenderRequest(Name, Data.DeepClone(), presentation, LayoutPlan?.DeepClone());
    }
}

/// <summary>纸面渲染协议 v1，字段与 resumePrintDocument.ts 的 ResumeRenderRequestV1 一一对应。</summary>
public sealed record ResumeRenderRequest(
    [property: JsonPropertyName("title")] string Title,
    [property: JsonPropertyName("data")] JsonNode Data,
    [property: JsonPropertyName("style")] JsonNode Style,
    [property: JsonPropertyName("layout_plan")] JsonNode? LayoutPlan)
{
    [JsonPropertyName("protocol_version")]
    public int ProtocolVersion => 1;

    public string ToJson() => JsonSerializer.Serialize(this);
}

/// <summary>工作区一级导航，与 Web V3 侧栏（apps/web/src/v3/Shell.tsx）同一顺序和文案。</summary>
public enum WorkspaceSection { Home, Resumes, Templates, Jobs, Schedule, Mock, Datasets }

public static class WorkspaceSections
{
    public static string Title(this WorkspaceSection section) => section switch
    {
        WorkspaceSection.Home => "首页",
        WorkspaceSection.Resumes => "我的简历",
        WorkspaceSection.Templates => "简历模板",
        WorkspaceSection.Jobs => "岗位看板",
        WorkspaceSection.Schedule => "面试日程",
        WorkspaceSection.Mock => "模拟面试",
        WorkspaceSection.Datasets => "资料库",
        _ => throw new ArgumentOutOfRangeException(nameof(section)),
    };

    /// <summary>Segoe Fluent Icons 字形；Mac 端对应 SF Symbols。</summary>
    public static string Glyph(this WorkspaceSection section) => section switch
    {
        WorkspaceSection.Home => "",
        WorkspaceSection.Resumes => "",
        WorkspaceSection.Templates => "",
        WorkspaceSection.Jobs => "",
        WorkspaceSection.Schedule => "",
        WorkspaceSection.Mock => "",
        WorkspaceSection.Datasets => "",
        _ => throw new ArgumentOutOfRangeException(nameof(section)),
    };
}
