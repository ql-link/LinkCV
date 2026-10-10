using DrawOffer.Core.Models;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace DrawOffer.App.Views;

/// <summary>尚未实现的功能页。</summary>
public sealed partial class PlaceholderPage : Page
{
    public PlaceholderPage() => InitializeComponent();

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        if (e.Parameter is WorkspaceSection section) TitleText.Text = section.Title();
    }
}
