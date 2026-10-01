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

    [ObservableProperty] private SessionPhase _phase = SessionPhase.Restoring;
    [ObservableProperty] private User? _user;
    [ObservableProperty] private string? _errorMessage;

    public async Task RestoreAsync()
    {
        try { Apply(await Api.CurrentUserAsync()); }
        catch (Exception) { Apply(null); }
    }

    [RelayCommand]
    private async Task SignInAsync((string Email, string Password) credentials)
    {
        ErrorMessage = null;
        try { Apply(await Api.SignInAsync(credentials.Email, credentials.Password)); }
        catch (ApiException) { ErrorMessage = "登录失败，请检查邮箱和密码。"; }
    }

    [RelayCommand]
    private async Task SignOutAsync()
    {
        await Api.SignOutAsync();
        Apply(null);
    }

    private void Apply(User? user)
    {
        User = user;
        Phase = user is null ? SessionPhase.SignedOut : SessionPhase.SignedIn;
    }
}
