using LinkResume.Core.Models;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Animation;

namespace LinkResume.App.Views;

public sealed partial class WorkspacePage : Page
{
    public WorkspacePage()
    {
        InitializeComponent();
        foreach (var section in Enum.GetValues<WorkspaceSection>())
        {
            Nav.MenuItems.Add(new NavigationViewItem
            {
                Content = section.Title(),
                Icon = new FontIcon { Glyph = section.Glyph() },
                Tag = section,
            });
        }
        Nav.SelectedItem = Nav.MenuItems[(int)WorkspaceSection.Templates];
    }

    private void OnSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is not NavigationViewItem { Tag: WorkspaceSection section }) return;
        var page = section == WorkspaceSection.Templates ? typeof(TemplatesPage) : typeof(PlaceholderPage);
        ContentFrame.Navigate(page, section, new EntranceNavigationTransitionInfo());
    }
}
