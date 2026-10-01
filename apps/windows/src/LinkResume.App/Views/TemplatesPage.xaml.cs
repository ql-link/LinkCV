using LinkResume.Core.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace LinkResume.App.Views;

public sealed partial class TemplatesPage : Page
{
    public TemplatesPage()
    {
        InitializeComponent();
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        var templates = await App.Session.Api.ListResumeTemplatesAsync();
        TemplateList.ItemsSource = templates;
        TemplateList.SelectedIndex = templates.Count > 0 ? 0 : -1;
    }

    private void OnTemplateChanged(object sender, SelectionChangedEventArgs e)
    {
        if (TemplateList.SelectedItem is ResumeTemplate template) Paper.Render(template.ToRenderRequest());
    }
}
