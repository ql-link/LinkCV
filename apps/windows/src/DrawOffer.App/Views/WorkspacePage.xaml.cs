using System.ComponentModel;
using DrawOffer.Core.Models;
using DrawOffer.Core.Session;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace DrawOffer.App.Views;

public sealed partial class WorkspacePage : Page
{
    public static WorkspacePage Current { get; private set; } = null!;
    public string? SelectedTemplateId { get; private set; }
    private readonly Button _account = new();
    private ContentDialog? _login;
    private ResumeTemplate? _creationTemplate;
    private bool _wasSignedIn;
    private string? _accountId;
    private string _homeDraft = "";

    public WorkspacePage()
    {
        InitializeComponent();
        Current = this;
        foreach (var section in Enum.GetValues<WorkspaceSection>())
            Nav.MenuItems.Add(new NavigationViewItem { Content = section.Title(),
                Icon = new FontIcon { Glyph = section.Glyph() }, Tag = section });
        _account.Click += async (_, _) =>
        {
            if (App.Session.Phase == SessionViewModel.SessionPhase.SignedIn)
                await App.Session.SignOutCommand.ExecuteAsync(null);
            else await RequestLoginAsync();
        };
        var brand = new Button { Content = new Image { Source = new BitmapImage(new Uri("ms-appx:///Assets/Branding/wordmark.png")), Width = 146, Height = 30 },
            Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent), BorderThickness = new Thickness(0), Margin = new Thickness(8, 0, 0, 10) };
        brand.Click += (_, _) => Nav.SelectedItem = Nav.MenuItems[(int)WorkspaceSection.Home];
        TopBar.Children.Add(brand);
        TopBar.Children.Add(ActionButton("＋ 新建对话", (_, _) => { _homeDraft = ""; Nav.SelectedItem = Nav.MenuItems[(int)WorkspaceSection.Home]; ShowSection(WorkspaceSection.Home); }));
        foreach (var section in Enum.GetValues<WorkspaceSection>())
        {
            var entry = section;
            var button = new Button { Content = section.Title(), FontSize = 14, Tag = section, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Height = 34,
                Background = new SolidColorBrush(Microsoft.UI.Colors.Transparent), BorderThickness = new Thickness(0), Padding = new Thickness(10, 0, 10, 0) };
            button.Click += (_, _) => Nav.SelectedItem = Nav.MenuItems[(int)entry];
            TopBar.Children.Add(button);
        }
        TopBar.Children.Add(new TextBlock { Text = "最近对话", FontSize = 11.5, Margin = new Thickness(12,22,0,8), Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray) });
        TopBar.Children.Add(new TextBlock { Text = "登录后读取对话；原生列表尚未接入", FontSize = 12, Margin = new Thickness(12,0,0,24), TextWrapping = TextWrapping.Wrap });
        AccountHost.Children.Add(_account);
        App.Session.PropertyChanged += OnSessionChanged;
        Unloaded += (_, _) => { App.Session.PropertyChanged -= OnSessionChanged; _login?.Hide(); };
        UpdateAccount();
        Nav.SelectedItem = Nav.MenuItems[(int)WorkspaceSection.Home];
    }

    private void UpdateAccount()
    {
        var signedIn = App.Session.Phase == SessionViewModel.SessionPhase.SignedIn;
        _account.Content = signedIn ? $"{App.Session.User?.Nickname} · 退出登录" : "登录";
        if (signedIn) _login?.Hide();
        if (_wasSignedIn && (!signedIn || _accountId != App.Session.User?.Id))
        {
            _creationTemplate = null;
            _homeDraft = "";
            SelectedTemplateId = null;
            _login?.Hide();
            Nav.SelectedItem = Nav.MenuItems[(int)WorkspaceSection.Home];
        }
        _wasSignedIn = signedIn;
        _accountId = signedIn ? App.Session.User?.Id : null;
    }

    private void OnSessionChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(SessionViewModel.Phase) ||
            (e.PropertyName == nameof(SessionViewModel.User) && _wasSignedIn))
        {
            UpdateAccount();
            if (Nav.SelectedItem is NavigationViewItem { Tag: WorkspaceSection section } && section != WorkspaceSection.Templates && section != WorkspaceSection.Jobs && section != WorkspaceSection.Schedule)
                ShowSection(section);
        }
    }

    public async Task RequestLoginAsync(ResumeTemplate? template = null, string? reason = null)
    {
        if (_login is not null) return;
        if (template is null && App.Session.Phase == SessionViewModel.SessionPhase.SignedIn) {
            var notice = new ContentDialog { XamlRoot = XamlRoot, Title = "此功能尚未开放",
                Content = "此功能将在后续版本开放。你已输入的内容会保留，可以继续浏览模板。", CloseButtonText = "知道了" };
            _login = notice;
            try { await notice.ShowAsync(); } finally { _login = null; }
            return;
        }
        if (App.Session.Phase != SessionViewModel.SessionPhase.SignedIn)
        {
            var dialog = new ContentDialog { XamlRoot = XamlRoot,
                Title = template is null ? reason ?? "登录后查看和同步你的简历" : $"登录后继续使用「{template.Name}」",
                Content = new SignInPage(), CloseButtonText = "暂不登录" };
            _login = dialog;
            try { await dialog.ShowAsync(); }
            finally { _login = null; }
        }
        if (template is not null && App.Session.Phase == SessionViewModel.SessionPhase.SignedIn)
        {
            _creationTemplate = template;
            SelectedTemplateId = template.Id;
            Nav.SelectedItem = Nav.MenuItems[(int)WorkspaceSection.Resumes];
            ShowCreation();
        }
    }

    private static Button ActionButton(string title, RoutedEventHandler action)
    {
        var button = new Button { Content = title, FontSize = 13, Padding = new Thickness(16, 10, 16, 10), CornerRadius = new CornerRadius(8),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 23, 25, 28)), Foreground = new SolidColorBrush(Microsoft.UI.Colors.White) };
        button.Click += action;
        return button;
    }

    private void ShowHome()
    {
        var signedIn = App.Session.Phase == SessionViewModel.SessionPhase.SignedIn;
        var panel = new StackPanel { Spacing = 12, Padding = new Thickness(52, 51, 52, 60), MaxWidth = 964, HorizontalAlignment = HorizontalAlignment.Center };
        panel.Children.Add(new TextBlock { Text = signedIn ? "RESUMES  /  个人工作区" : "RESUMES  /  游客预览", FontSize = 11, Foreground = new SolidColorBrush(Microsoft.UI.Colors.Gray) });
        panel.Children.Add(new TextBlock { Text = "我的简历", FontSize = 28, FontFamily = new FontFamily("Noto Serif SC, SimSun") });
        panel.Children.Add(new TextBlock { Text = "每份简历独立编辑，需要时复制一份按岗位修改。", FontSize = 13 });
        panel.Children.Add(new Border { Height = 1, Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 236, 236, 234)), Margin = new Thickness(0, 12, 0, 0) });
        var empty = new StackPanel { Spacing = 16, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 60, 0, 0) };
        empty.Children.Add(new Border { Width = 132, Height = 176, Background = new SolidColorBrush(Microsoft.UI.Colors.White), BorderBrush = new SolidColorBrush(Microsoft.UI.Colors.LightGray), BorderThickness = new Thickness(1), CornerRadius = new CornerRadius(5), Child = new TextBlock { Text = "━━\n━━━━\n\n教育经历\n\n项目经历\n\n专业技能", FontSize = 12, Padding = new Thickness(16) } });
        empty.Children.Add(new TextBlock { Text = signedIn ? "个人简历列表尚未接入" : "从第一份简历开始", FontFamily = new FontFamily("Noto Serif SC, SimSun"), FontSize = 18, HorizontalAlignment = HorizontalAlignment.Center });
        empty.Children.Add(new TextBlock { Text = signedIn ? "尚未查询你的账号数据，这里不代表你没有简历。" : "新建时选一套模板、起个名字；已有简历文件可以用「导入简历」。", FontSize = 13, TextWrapping = TextWrapping.Wrap });
        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 20, HorizontalAlignment = HorizontalAlignment.Center };
        actions.Children.Add(ActionButton("新建简历 →", (_, _) => Nav.SelectedItem = Nav.MenuItems[(int)WorkspaceSection.Templates]));
        actions.Children.Add(ActionButton("导入简历", async (_, _) => await RequestLoginAsync()));
        empty.Children.Add(actions);
        empty.Children.Add(new TextBlock { Text = "内置示例可离线预览；保存、导入与个人数据需登录，原生写入功能尚未接入。", FontSize = 12, TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(empty);
        if (App.Session.ErrorMessage is { } message) panel.Children.Add(new TextBlock { Text = message, TextWrapping = TextWrapping.Wrap });
        ContentFrame.Content = new ScrollViewer { Content = panel };
    }

    private void ShowCreation()
    {
        if (_creationTemplate is null) return;
        var panel = new StackPanel { Spacing = 20, Padding = new Thickness(40) };
        panel.Children.Add(new TextBlock { Text = $"已选择：{_creationTemplate.Name}", FontSize = 24 });
        panel.Children.Add(new TextBlock { Text = "登录已完成，模板选择已保留。原生简历创建与编辑尚未接入，此时没有保存新的简历。", TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(ActionButton("返回模板预览", (_, _) => Nav.SelectedItem = Nav.MenuItems[(int)WorkspaceSection.Templates]));
        ContentFrame.Content = panel;
    }

    private void OnSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is NavigationViewItem { Tag: WorkspaceSection section }) {
            foreach (var button in TopBar.Children.OfType<Button>().Where(b => b.Tag is WorkspaceSection))
                button.Background = new SolidColorBrush((WorkspaceSection)button.Tag == section ? Windows.UI.Color.FromArgb(255, 230, 230, 226) : Microsoft.UI.Colors.Transparent);
            ShowSection(section);
        }
    }

    private async Task ShowPluginAsync() {
        var dialog = new ContentDialog { XamlRoot = XamlRoot, Title = "安装浏览器插件", Content = "插件安装入口尚未开放。你仍可以浏览模板和示例简历。", CloseButtonText = "知道了" };
        await dialog.ShowAsync();
    }

    public void Navigate(WorkspaceSection section) { Nav.SelectedItem = Nav.MenuItems[(int)section]; }

    private void ShowSection(WorkspaceSection section)
    {
        if (section == WorkspaceSection.Home) {
            ContentFrame.Content = new AssistantHomePage(App.Session.Phase == SessionViewModel.SessionPhase.SignedIn ? App.Session.User?.Nickname : null,
                _homeDraft, text => _homeDraft = text,
                () => Nav.SelectedItem = Nav.MenuItems[(int)WorkspaceSection.Templates],
                () => RequestLoginAsync(reason: "登录 DrawOffer；你的输入会保留。"), ShowPluginAsync);
            return;
        }
        if (section == WorkspaceSection.Datasets) { ContentFrame.Content = new DatasetLibraryPage(); return; }
        if (section == WorkspaceSection.Mock) { ContentFrame.Content = new MockInterviewPage(); return; }
        if (section == WorkspaceSection.Schedule) { ContentFrame.Content = new InterviewSchedulePage(); return; }
        if (section == WorkspaceSection.Jobs) { ContentFrame.Content = new JobsBoardPage(); return; }
        if (section == WorkspaceSection.Resumes)
        {
            if (_creationTemplate is not null && App.Session.Phase == SessionViewModel.SessionPhase.SignedIn)
            { ShowCreation(); return; }
            ShowHome();
            return;
        }
        ContentFrame.Navigate(section == WorkspaceSection.Templates ? typeof(TemplatesPage) : typeof(PlaceholderPage), section,
            new EntranceNavigationTransitionInfo());
    }
}
