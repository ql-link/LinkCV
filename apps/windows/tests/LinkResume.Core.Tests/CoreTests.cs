using System.Text.Json.Nodes;
using LinkResume.Core.Api;
using LinkResume.Core.Models;
using LinkResume.Core.Session;
using Xunit;

namespace LinkResume.Core.Tests;

// 与 apps/mac/Tests/LinkResumeCoreTests 同一组断言，保证两端核心层行为一致
public class CoreTests
{
    [Fact]
    public async Task MockTemplatesRequireSignIn()
    {
        var error = await Assert.ThrowsAsync<ApiException>(() => new MockApiClient().ListResumeTemplatesAsync());
        Assert.Equal("UNAUTHORIZED", error.Code);
    }

    [Fact]
    public async Task MockTemplatesCarryLayoutPlans()
    {
        var templates = await new MockApiClient(signedIn: true).ListResumeTemplatesAsync();
        Assert.Equal(3, templates.Count);
        Assert.All(templates, template => Assert.NotNull(template.LayoutPlan));
    }

    [Fact]
    public async Task RenderRequestMatchesWebPresentationRule()
    {
        var template = (await new MockApiClient(signedIn: true).ListResumeTemplatesAsync())[0];
        var request = JsonNode.Parse(template.ToRenderRequest().ToJson())!;
        Assert.Equal(1, request["protocol_version"]!.GetValue<int>());
        Assert.Equal("resume-presentation.v1", request["style"]!["schema_version"]!.GetValue<string>());
        Assert.NotNull(request["style"]!["template_scoped"]![template.Key]);
        Assert.True(JsonNode.DeepEquals(template.Style, request["style"]!["template_snapshot"]));
    }

    [Fact]
    public async Task SessionRestoreAndSignOut()
    {
        var session = new SessionViewModel(new MockApiClient(signedIn: true));
        await session.RestoreAsync();
        Assert.Equal(SessionViewModel.SessionPhase.SignedIn, session.Phase);
        await session.SignOutCommand.ExecuteAsync(null);
        Assert.Equal(SessionViewModel.SessionPhase.SignedOut, session.Phase);
    }

    [Fact]
    public void NavigationMatchesWebOrder()
    {
        var titles = Enum.GetValues<WorkspaceSection>().Select(section => section.Title());
        Assert.Equal(["首页", "我的简历", "简历模板", "岗位看板", "面试日程", "模拟面试", "资料库"], titles);
    }
}
