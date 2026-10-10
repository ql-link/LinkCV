using System.ComponentModel;
using DrawOffer.App.Views;
using DrawOffer.Core.Session;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace DrawOffer.App;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBar);
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1280, 820));
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "DrawOffer.ico"));
        RootFrame.Content = new WorkspacePage();
    }
}
