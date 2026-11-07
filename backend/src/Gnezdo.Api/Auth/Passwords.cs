using System.Security.Cryptography;

namespace Gnezdo.Api.Auth;

/// <summary>Passwords are kept only as a salted PBKDF2-SHA256 hash.</summary>
public static class Passwords
{
    private const int Iterations = 100_000;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"pbkdf2-sha256${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string stored)
    {
        var p = stored.Split('$');
        if (p.Length != 4 || p[0] != "pbkdf2-sha256" || !int.TryParse(p[1], out var it)) return false;
        try
        {
            var salt = Convert.FromBase64String(p[2]);
            var want = Convert.FromBase64String(p[3]);
            var got = Rfc2898DeriveBytes.Pbkdf2(password, salt, it, HashAlgorithmName.SHA256, want.Length);
            return CryptographicOperations.FixedTimeEquals(got, want);
        }
        catch (FormatException) { return false; }
    }

    /// <summary>A new stamp: sign-ins made before it end.</summary>
    public static string NewStamp() => Guid.NewGuid().ToString("N");
}
