using System.ComponentModel;
using LinkResume.App.Views;
using LinkResume.Core.Session;
using Microsoft.UI.Xaml;

namespace LinkResume.App;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBar);
        AppWindow.Resize(new Windows.Graphics.SizeInt32(1280, 820));
        App.Session.PropertyChanged += OnSessionChanged;
    }

    private void OnSessionChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(SessionViewModel.Phase)) return;
        RootFrame.Navigate(App.Session.Phase == SessionViewModel.SessionPhase.SignedIn ? typeof(WorkspacePage) : typeof(SignInPage));
    }
}
