using LinkResume.Core.Session;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace LinkResume.App.Views;

public sealed partial class SignInPage : Page
{
    public SessionViewModel Session => App.Session;

    public SignInPage() => InitializeComponent();

    private async void OnSignIn(object sender, RoutedEventArgs e)
        => await Session.SignInCommand.ExecuteAsync((EmailBox.Text, PasswordBox.Password));
}
