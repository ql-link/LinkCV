using LinkResume.Core.Api;
using LinkResume.Core.Session;
using Microsoft.UI.Xaml;

namespace LinkResume.App;

public partial class App : Application
{
    // 现在固定用 mock；desktop 渠道上线后按构建配置切到 HttpApiClient
    public static SessionViewModel Session { get; } = new(new MockApiClient());

    private Window? _window;

    public App() => InitializeComponent();

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        _window = new MainWindow();
        _window.Activate();
        await Session.RestoreAsync();
    }
}
