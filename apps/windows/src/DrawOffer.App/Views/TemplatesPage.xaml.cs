using DrawOffer.Core.Models;
using DrawOffer.Core.Paper;
using DrawOffer.App.Paper;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace DrawOffer.App.Views;

public sealed partial class TemplatesPage : Page
{
    private readonly CancellationTokenSource _load = new();
    private bool _active;
    private ContentDialog? _preview;
    public TemplatesPage()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Unloaded += (_, _) => { _active = false; _load.Cancel(); _preview?.Hide(); };
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        _active = true;
        try {
            var templates = await GuestTemplates.LoadAsync(_load.Token);
            if (!_active) return;
            TemplateList.ItemsSource = templates;
            PaperError.Text = $"找到 {templates.Count} 套模板";
        }
        catch (OperationCanceledException) { }
        catch (Exception) { if (_active) PaperError.Text = "模板加载失败，请重新打开模板页。"; }
    }

    private async void OnThumbnailLoaded(object sender, RoutedEventArgs e)
    {
        if (sender is not ResumePaperView paper || paper.DataContext is not ResumeTemplate template) return;
        try {
            var result = await GuestTemplates.PrepareAsync(template, _load.Token);
            if (_active) paper.Render(result.Request);
        }
        catch (OperationCanceledException) { }
        catch (Exception) { if (_active) PaperError.Text = "部分预览不可用，请重新打开模板页。"; }
    }

    private async void OnPreviewTemplate(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not ResumeTemplate template || _preview is not null) return;
        var paper = new ResumePaperView { Width = 794, Height = 1123 };
        var status = new TextBlock { Text = "虚构示例资料 · 最终排版以 PDF 为准；字体、换行与分页可能不同。", FontSize = 12, TextWrapping = TextWrapping.Wrap };
        paper.Rendered += (_, height) => paper.Height = Math.Max(1123, height);
        paper.RenderFailed += (_, message) => status.Text = message;
        var body = new StackPanel { Spacing = 12 };
        body.Children.Add(status);
        body.Children.Add(new ScrollViewer { Content = paper, Height = 480, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        var dialog = new ContentDialog { XamlRoot = XamlRoot, Title = template.Name, Content = body,
            PrimaryButtonText = "使用此模板", CloseButtonText = "关闭", DefaultButton = ContentDialogButton.Primary };
        _preview = dialog;
        try {
            var result = await GuestTemplates.PrepareAsync(template, _load.Token);
            if (!_active) return;
            paper.Render(result.Request);
            var action = await dialog.ShowAsync();
            if (_active && action == ContentDialogResult.Primary) {
                _preview = null;
                await WorkspacePage.Current.RequestLoginAsync(template);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception) { if (_active) PaperError.Text = "预览加载失败，请重试。"; }
        finally { _preview = null; }
    }
}
