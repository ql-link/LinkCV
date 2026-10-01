using System.Text.Json;
using LinkResume.Core.Models;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace LinkResume.App.Paper;

/// <summary>
/// 简历纸面，对应 Mac 端的 ResumePaperView。整个 App 里唯一用到网页视图的地方：
/// WebView2 通过虚拟主机映射加载随包的离线 paper.html，用 <c>window.linkresume.render(request)</c> 注入数据。
/// 页面 ready 之前到达的请求先暂存，ready 后补发最新一份。
/// </summary>
public sealed partial class ResumePaperView : UserControl
{
    // 虚拟主机只映射到安装目录下的 Renderer 文件夹，页面本身的 CSP 禁止任何外部请求
    private const string Host = "paper.linkresume.local";
    private readonly WebView2 _webView = new();
    private bool _ready;
    private string? _pending;

    public event EventHandler<double>? Rendered;

    public ResumePaperView()
    {
        Content = _webView;
        _ = InitializeAsync();
    }

    public void Render(ResumeRenderRequest request)
    {
        _pending = request.ToJson();
        Flush();
    }

    private async Task InitializeAsync()
    {
        await _webView.EnsureCoreWebView2Async();
        var core = _webView.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.SetVirtualHostNameToFolderMapping(Host, Path.Combine(AppContext.BaseDirectory, "Assets", "Renderer"), CoreWebView2HostResourceAccessKind.DenyCors);
        core.WebMessageReceived += OnMessage;
        _webView.DefaultBackgroundColor = Microsoft.UI.Colors.Transparent;
        core.Navigate($"https://{Host}/paper.html");
    }

    private void OnMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        using var message = JsonDocument.Parse(args.WebMessageAsJson);
        switch (message.RootElement.GetProperty("type").GetString())
        {
            case "ready":
                _ready = true;
                Flush();
                break;
            case "rendered":
                Rendered?.Invoke(this, message.RootElement.GetProperty("heightPx").GetDouble());
                break;
        }
    }

    private void Flush()
    {
        if (!_ready || _pending is null) return;
        // payload 是 System.Text.Json 的序列化结果，本身就是合法 JS 字面量
        _ = _webView.CoreWebView2.ExecuteScriptAsync($"window.linkresume.render({_pending})");
        _pending = null;
    }
}
