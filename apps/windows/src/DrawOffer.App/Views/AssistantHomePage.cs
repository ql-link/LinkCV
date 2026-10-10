using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace DrawOffer.App.Views;

/// <summary>Dev AssistantPage guest guide layout; no synthesized account progress.</summary>
public sealed class AssistantHomePage : Page
{
    private static SolidColorBrush Brush(byte r, byte g, byte b) => new(Windows.UI.Color.FromArgb(255, r, g, b));
    public AssistantHomePage(string? nickname, string draft, Action<string> updateDraft,
        Action browse, Func<Task> requireAccount, Func<Task> plugin)
    {
        JsonNode content;
        try { content = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Assets", "Home", "content.json")))!; }
        catch { Content = new TextBlock { Text = "首页信息暂时无法读取，请重新打开客户端。", Margin = new Thickness(52) }; return; }
        var hour = DateTime.Now.Hour;
        var greeting = hour < 11 ? "早上好" : hour < 13 ? "中午好" : hour < 18 ? "下午好" : "晚上好";
        greeting += nickname is null ? "。" : $"，{nickname}。";
        var panel = new StackPanel { Width = 720, Spacing = 0, HorizontalAlignment = HorizontalAlignment.Center };
        panel.Children.Add(new TextBlock { Text = greeting + (nickname is null ? content["title"]!.GetValue<string>() : "今天想推进什么？"),
            FontSize = 26, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontFamily = new FontFamily("SimSun"), TextAlignment = TextAlignment.Center, MinHeight = 37 });
        panel.Children.Add(new TextBlock { Text = nickname is null ? content["subtitle"]!.GetValue<string>() : "改简历、分析 JD、准备面试，从这里开始。",
            FontSize = 13, Foreground = Brush(150,150,143), TextAlignment = TextAlignment.Center, Margin = new Thickness(0,11,0,0) });
        var editor = new TextBox { Text = draft, PlaceholderText = content["placeholder"]!.GetValue<string>(), AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap, FontSize = 14, Height = 52, Padding = new Thickness(0), Margin = new Thickness(22,12,22,0),
            BorderThickness = new Thickness(0), Background = Brush(255,255,255) };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(editor, "向 DrawOffer 提问");
        var send = new Button { Content = "↑", Width = 36, Height = 36, CornerRadius = new CornerRadius(18), Foreground = Brush(255,255,255),
            Background = Brush(23,25,28), Padding = new Thickness(0), FontSize = 16, HorizontalAlignment = HorizontalAlignment.Right,
            IsEnabled = !string.IsNullOrWhiteSpace(draft) };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(send, "发送");
        send.Click += async (_, _) => await requireAccount();
        editor.TextChanged += (_, _) => { updateDraft(editor.Text); send.IsEnabled = !string.IsNullOrWhiteSpace(editor.Text); };
        var footer = new Grid { Height = 36, Margin = new Thickness(16,0,12,12) };
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        footer.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var attach = new Button { Content = "+", Width = 32, Height = 32, CornerRadius = new CornerRadius(16), Background = Brush(255,255,255), Padding = new Thickness(0) };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(attach, "添加资料");
        attach.Click += async (_, _) => await requireAccount();
        footer.Children.Add(attach);
        var model = new Button { Content = "✧ 模型未连接 ⌄", FontSize = 13.5, Background = Brush(255,255,255), BorderThickness = new Thickness(0), Margin = new Thickness(0,0,10,0),
            Flyout = new Flyout { Content = new TextBlock { Text = "AI 模型尚未连接" } } };
        Grid.SetColumn(model, 2); footer.Children.Add(model);
        Grid.SetColumn(send, 3); footer.Children.Add(send);
        var composer = new Grid();
        composer.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1,GridUnitType.Star) });
        composer.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        composer.Children.Add(editor); Grid.SetRow(footer,1); composer.Children.Add(footer);
        var composerBorder = new Border { Child = composer, Height = 120, CornerRadius = new CornerRadius(16), Background = Brush(255,255,255),
            BorderBrush = Brush(228,228,224), BorderThickness = new Thickness(1), Margin = new Thickness(0,32,0,0) };
        panel.Children.Add(composerBorder);
        var chips = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0,16,0,0) };
        foreach (var value in content["chips"]!.AsArray()) {
            var prompt = value!.GetValue<string>();
            var chip = new Button { Content = prompt, FontSize = 12, Background = Brush(244,244,242), BorderThickness = new Thickness(0), CornerRadius = new CornerRadius(14), Padding = new Thickness(10,5,10,5) };
            chip.Click += (_, _) => { editor.Text = prompt; editor.Focus(FocusState.Programmatic); editor.Select(editor.Text.Length,0); };
            chips.Children.Add(chip);
        }
        panel.Children.Add(chips);
        var cards = new Grid { ColumnSpacing = 19, Margin = new Thickness(0,32,0,0) };
        for(var i=0;i<3;i++) cards.ColumnDefinitions.Add(new ColumnDefinition());
        var index=0;
        var responsiveCards = new List<(Button Button, StackPanel Copy, Image Art, TextBlock Title, TextBlock Action)>();
        foreach(var card in content["cards"]!.AsArray()) {
            var id = card!["id"]!.GetValue<string>();
            var copy = new StackPanel { Spacing = 0, Height = 218 };
            var art = new Image { Source = new BitmapImage(new Uri($"ms-appx:///Assets/Home/{id}.png")), Height = 112, Stretch = Stretch.Uniform };
            copy.Children.Add(art);
            var title = new TextBlock { Text = nickname is not null && id == "firstResume" ? "准备一份简历" : card["title"]!.GetValue<string>(), FontFamily = new FontFamily("SimSun"), FontSize = 15,
                Margin = new Thickness(12,18,12,0), FontWeight = Microsoft.UI.Text.FontWeights.SemiBold };
            copy.Children.Add(title);
            copy.Children.Add(new TextBlock { Text = card["subtitle"]!.GetValue<string>(), FontSize = 12, Margin = new Thickness(12,6,12,0), Foreground = Brush(85,85,79) });
            var action = new TextBlock { Text = card["action"]!.GetValue<string>() + " →", FontSize = 12, Margin = new Thickness(12,24,12,14), Foreground = Brush(85,85,79) };
            copy.Children.Add(action);
            var button = new Button { Content = copy, Height = 236, Padding = new Thickness(8), CornerRadius = new CornerRadius(16), Background = Brush(255,255,255), BorderBrush = Brush(228,228,224), BorderThickness = new Thickness(1), HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Stretch };
            button.Click += async (_, _) => { if(id == "firstResume") browse(); else if(id == "plugin") await plugin(); else await requireAccount(); };
            Grid.SetColumn(button,index++); cards.Children.Add(button);
            responsiveCards.Add((button, copy, art, title, action));
        }
        panel.Children.Add(cards);
        panel.Children.Add(new TextBlock { Text = nickname is null ? "游客引导 · 当前输入仅保留在本次会话；AI 对话尚未开放。" : "引导视图 · 尚未读取账号进度；AI 对话尚未开放。",
            FontSize = 11, Foreground = Brush(150,150,143), TextAlignment = TextAlignment.Center, Margin = new Thickness(0,20,0,0) });
        // Center within the content viewport, without a page-level scroll container.
        // Down-only scaling protects the layout when a Windows window is unusually small.
        var viewport = new Grid { Margin = new Thickness(32,24,32,24) };
        viewport.Children.Add(new Viewbox { Child = panel, Stretch = Stretch.Uniform, StretchDirection = StretchDirection.DownOnly });
        viewport.SizeChanged += (_, args) => {
            panel.Width = Math.Clamp(args.NewSize.Width, 600, 720);
            var compact = args.NewSize.Height < 692;
            composerBorder.Margin = new Thickness(0,compact ? 24 : 32,0,0);
            chips.Margin = new Thickness(0,compact ? 12 : 16,0,0);
            cards.Margin = new Thickness(0,compact ? 20 : 32,0,0);
            foreach(var card in responsiveCards) {
                card.Button.Height = compact ? 200 : 236;
                card.Copy.Height = compact ? 182 : 218;
                card.Art.Height = compact ? 84 : 112;
                card.Title.Margin = new Thickness(12,compact ? 12 : 18,12,0);
                card.Action.Margin = new Thickness(12,compact ? 14 : 24,12,14);
            }
        };
        Content = viewport;
    }
}
