using System.ComponentModel;
using LinkResume.App.Views;
using LinkResume.Core.Session;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace LinkResume.App;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBar);
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1280, 820));
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "LinkResume.ico"));
        RootFrame.Content = new WorkspacePage();
    }
}
