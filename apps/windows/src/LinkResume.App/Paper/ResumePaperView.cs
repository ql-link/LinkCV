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
    private bool _unloaded;
    private string? _pending;

    public event EventHandler<double>? Rendered;
    public event EventHandler<string>? RenderFailed;

    public ResumePaperView()
    {
        Content = _webView;
        _ = InitializeAsync();
        Unloaded += (_, _) => {
            _unloaded = true;
            _pending = null;
            _ready = false;
            if (_webView.CoreWebView2 is { } core) core.WebMessageReceived -= OnMessage;
            _webView.Close();
        };
    }

    public void Clear()
    {
        _pending = null;
        if (_ready) _ = _webView.CoreWebView2.ExecuteScriptAsync("window.linkresume.clear()");
    }

    public void Render(ResumeRenderRequest request)
    {
        _pending = request.ToJson();
        Flush();
    }

    private async Task InitializeAsync()
    {
        try
        {
            await _webView.EnsureCoreWebView2Async();
            if (_unloaded) return;
            var core = _webView.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.SetVirtualHostNameToFolderMapping(Host, Path.Combine(AppContext.BaseDirectory, "Assets", "Renderer"), CoreWebView2HostResourceAccessKind.DenyCors);
            core.WebMessageReceived += OnMessage;
            core.NavigationStarting += (_, args) => {
                if (args.Uri != $"https://{Host}/paper.html" && args.Uri != "about:blank") args.Cancel = true;
            };
            _webView.DefaultBackgroundColor = Microsoft.UI.Colors.Transparent;
            core.Navigate($"https://{Host}/paper.html");
        }
        catch (Exception)
        {
            if (!_unloaded) RenderFailed?.Invoke(this, "纸面加载失败，请确认 WebView2 可用。");
        }
    }

    private void OnMessage(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        using var message = JsonDocument.Parse(args.WebMessageAsJson);
        switch (message.RootElement.GetProperty("type").GetString())
        {
            case "ready":
                if (message.RootElement.GetProperty("protocol").GetInt32() != 1)
                { RenderFailed?.Invoke(this, "纸面资源版本不匹配，请更新客户端。"); break; }
                _ready = true;
                Flush();
                break;
            case "error":
                RenderFailed?.Invoke(this, message.RootElement.GetProperty("message").GetString() ?? "纸面预览失败，请重试。");
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
