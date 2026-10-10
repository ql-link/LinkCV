using DrawOffer.Core.Api;
using DrawOffer.Core.Paper;
using Xunit;

namespace DrawOffer.Core.Tests;

public class GuestTemplatesTests
{
    [Fact]
    public async Task GuestExamplesWorkWithoutGrantingAccountAccess()
    {
        var api = new MockApiClient();
        var templates = await GuestTemplates.LoadAsync();
        Assert.Equal(9, templates.Count);
        foreach (var template in templates)
        {
            var paper = await GuestTemplates.PrepareAsync(template);
            Assert.Equal(0, paper.MissingImageCount);
            Assert.NotNull(paper.Request.LayoutPlan);
        }
        await Assert.ThrowsAsync<ApiException>(() => api.ListResumeTemplatesAsync());
        Assert.Null(await api.CurrentUserAsync());
    }
}
