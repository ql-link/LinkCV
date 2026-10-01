using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using LinkResume.Core.Api;
using LinkResume.Core.Models;

namespace LinkResume.Core.Session;

/// <summary>登录态，对应 Mac 端的 SessionStore。界面按 Phase 决定显示登录页还是工作区。</summary>
public sealed partial class SessionViewModel(IApiClient api) : ObservableObject
{
    public enum SessionPhase { Restoring, SignedOut, SignedIn }

    public IApiClient Api { get; } = api;
    private long _operation;

    [ObservableProperty] private SessionPhase _phase = SessionPhase.Restoring;
    [ObservableProperty] private User? _user;
    [ObservableProperty] private string? _errorMessage;

    public async Task RestoreAsync()
    {
        var current = ++_operation;
        ErrorMessage = null;
        try
        {
            var user = await Api.CurrentUserAsync();
            if (current != _operation) return;
            Apply(user);
        }
        catch (ApiException error) when (error.Status == System.Net.HttpStatusCode.Unauthorized)
        {
            if (current != _operation) return;
            Apply(null);
            ErrorMessage = "登录已失效，请重新登录。";
        }
        catch (Exception)
        {
            if (current != _operation) return;
            User = null;
            Phase = SessionPhase.Restoring;
            ErrorMessage = "暂时无法恢复登录，可重试；已保留安全凭据。";
        }
    }

    [RelayCommand]
    private async Task SignInAsync((string Email, string Password) credentials)
    {
        var current = ++_operation;
        ErrorMessage = null;
        try
        {
            var user = await Api.SignInAsync(credentials.Email, credentials.Password);
            if (current != _operation) return;
            Apply(user);
        }
        catch (ApiException)
        {
            if (current != _operation) return;
            ErrorMessage = "登录失败，请检查邮箱和密码。";
        }
    }

    [RelayCommand]
    private async Task SignOutAsync()
    {
        var current = ++_operation;
        Apply(null);
        ErrorMessage = null;
        try { await Api.SignOutAsync(); }
        catch (Exception)
        {
            if (current != _operation) return;
            ErrorMessage = "本地已退出；远端撤销或安全存储清理未确认，请重试。";
        }
    }

    private void Apply(User? user)
    {
        User = user;
        Phase = user is null ? SessionPhase.SignedOut : SessionPhase.SignedIn;
    }
}
