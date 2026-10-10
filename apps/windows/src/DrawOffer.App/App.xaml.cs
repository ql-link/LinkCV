using DrawOffer.Core.Api;
using DrawOffer.Core.Session;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Security.Principal;

namespace DrawOffer.App;

public partial class App : Application
{
    public static SessionViewModel Session { get; private set; } = null!;
    private DesktopTransport? _transport;
    private Window? _window;
    internal static Window? NativeWindow => (Current as App)?._window;
    private Mutex? _instance;

    public App() => InitializeComponent();

    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        try
        {
            var origin = Environment.GetEnvironmentVariable("DRAWOFFER_API_ORIGIN")
                ?? throw new InvalidOperationException("API origin missing");
            _instance = new Mutex(false, $"Local\\DrawOffer.Desktop.{WindowsIdentity.GetCurrent().User?.Value}");
            var owned = false;
            try { owned = _instance.WaitOne(0); }
            catch (AbandonedMutexException) { owned = true; }
            if (!owned)
            {
                ShowStartupError("DrawOffer 已在运行，请使用已打开的窗口。");
                return;
            }
            _transport = new DesktopTransport(new Uri(origin),
                Environment.GetEnvironmentVariable("DRAWOFFER_ALLOW_LOCAL_HTTP") == "1");
            Session = new(new HttpApiClient(new SessionCoordinator(_transport, new CredentialLockerTokenStore())));
        }
        catch (Exception)
        {
            ShowStartupError("API 地址未配置或无效。请设置 DRAWOFFER_API_ORIGIN 后重新启动。");
            return;
        }
        _window = new MainWindow();
        _window.Activate();
        await Session.RestoreAsync();
    }

    private void ShowStartupError(string message)
    {
        _window = new Window { Content = new TextBlock
        {
            Text = message, Margin = new Thickness(32), TextWrapping = TextWrapping.Wrap,
        }};
        _window.Activate();
    }
}
