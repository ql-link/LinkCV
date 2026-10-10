using DrawOffer.Core.Api;
using DrawOffer.Core.Session;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage.Streams;

namespace DrawOffer.App.Views;

public sealed partial class SignInPage : Page
{
    public SessionViewModel Session => App.Session;
    private DesktopLoginChallenge? _challenge;
    private DateTimeOffset _deadline;
    private CancellationTokenSource? _waiting;

    public SignInPage()
    {
        InitializeComponent();
        Unloaded += (_, _) => _waiting?.Cancel();
    }

    private async void OnSignIn(object sender, RoutedEventArgs e) => await WaitForLoginAsync(false);
    private async void OnNewQr(object sender, RoutedEventArgs e) => await WaitForLoginAsync(true);
    private async void OnRestore(object sender, RoutedEventArgs e) => await Session.RestoreAsync();
    private async void OnSignOut(object sender, RoutedEventArgs e)
    {
        _waiting?.Cancel();
        _challenge = null;
        QrImage.Source = null;
        await Session.SignOutCommand.ExecuteAsync(null);
    }

    private async Task WaitForLoginAsync(bool newChallenge)
    {
        if (Session.Api is not HttpApiClient api) return;
        _waiting?.Cancel();
        using var waiting = new CancellationTokenSource();
        _waiting = waiting;
        var ct = waiting.Token;
        LoginButton.IsEnabled = NewQrButton.IsEnabled = false;
        try
        {
            if (newChallenge || _challenge is null || _deadline <= DateTimeOffset.UtcNow)
            {
                _challenge = null;
                QrImage.Source = null;
                if ((await api.Coordinator.CapabilitiesAsync(ct))["wechat_login_enabled"]?.GetValue<bool>() != true)
                {
                    StatusText.Text = "当前服务尚未开放桌面微信登录。";
                    return;
                }
                _challenge = await api.Coordinator.BeginLoginAsync("0.1.0", ct);
                var qrcode = _challenge.Qrcode;
                _deadline = DateTimeOffset.UtcNow.AddSeconds(qrcode["expires_in"]!.GetValue<int>());
                using var stream = new InMemoryRandomAccessStream();
                using (var writer = new DataWriter(stream))
                {
                    writer.WriteBytes(Convert.FromBase64String(qrcode["qr_base64"]!.GetValue<string>()));
                    await writer.StoreAsync();
                    writer.DetachStream();
                }
                stream.Seek(0);
                var image = new BitmapImage();
                await image.SetSourceAsync(stream);
                ct.ThrowIfCancellationRequested();
                QrImage.Source = image;
            }
            var challenge = _challenge!;
            while (DateTimeOffset.UtcNow < _deadline)
            {
                var status = await api.Coordinator.LoginStatusAsync(challenge, ct);
                if (status is "confirmed" or "consumed")
                {
                    await Session.CompleteDesktopLoginAsync(challenge, ct);
                    return;
                }
                if (status is "cancelled" or "expired")
                {
                    _challenge = null;
                    StatusText.Text = "登录已取消或二维码过期，请重新获取。";
                    return;
                }
                StatusText.Text = "请在微信中扫码并确认登录。";
                await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(challenge.Qrcode["poll_interval_seconds"]!.GetValue<int>(), 1, 10)), ct);
            }
            _challenge = null;
            StatusText.Text = "二维码已过期，请重新获取。";
        }
        catch (OperationCanceledException) { }
        catch (ApiException error) when (error.Status == System.Net.HttpStatusCode.NotFound && _challenge is null)
        {
            StatusText.Text = "当前服务尚未部署桌面微信登录接口，请联系管理员更新服务后重试。";
        }
        catch (Exception)
        {
            StatusText.Text = "登录未完成。请检查网络或凭据库权限后重试；重试将沿用本次领取请求。";
        }
        finally
        {
            LoginButton.IsEnabled = NewQrButton.IsEnabled = true;
            if (_waiting == waiting) _waiting = null;
        }
    }
}
