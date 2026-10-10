using System.Runtime.InteropServices;
using System.Text.Json;
using DrawOffer.Core.Session;
using Windows.Security.Credentials;
using Microsoft.Win32;
using System.Security.Cryptography;
using System.Text;

namespace DrawOffer.App;

/// <summary>Replace a single credential, including its recovery journal, without a delete/add gap.</summary>
public sealed class CredentialLockerTokenStore : ITokenStore
{
    private const string Account = "desktop-session-v1";
    private readonly PasswordVault _vault = new();
    // Credential Locker may roam. A different machine must not restore this refresh family.
    private readonly string _device = DeviceScope();

    private static string DeviceScope()
    {
        using var machine = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
        using var key = machine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
        var id = key?.GetValue("MachineGuid") as string;
        if (string.IsNullOrWhiteSpace(id)) throw new InvalidOperationException("Device identity unavailable");
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(id)));
    }

    private string Resource(string scope) => $"{scope}:{_device}";

    public DesktopCredentialRecord? Load(string scope)
    {
        PasswordCredential credential;
        try { credential = _vault.Retrieve(Resource(scope), Account); }
        catch (COMException error) when (error.HResult == unchecked((int)0x80070490)) { return null; }
        credential.RetrievePassword();
        return JsonSerializer.Deserialize<DesktopCredentialRecord>(credential.Password)
            ?? throw new JsonException("Invalid credential record");
    }

    public void Save(string scope, DesktopCredentialRecord record)
        => _vault.Add(new PasswordCredential(Resource(scope), Account, JsonSerializer.Serialize(record)));

    public void Clear(string scope)
    {
        try { _vault.Remove(_vault.Retrieve(Resource(scope), Account)); }
        catch (COMException error) when (error.HResult == unchecked((int)0x80070490)) { }
    }
}
