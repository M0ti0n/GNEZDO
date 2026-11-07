// GNEZDO.exe of the Windows desktop build: starts program\GNEZDO.exe --desktop without a console
// window and ends. Built on GitHub with the C# compiler that comes with Windows (.NET Framework 4),
// so it is small and needs nothing installed. (C# 5: no newer syntax.)
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("GNEZDO")]
[assembly: System.Reflection.AssemblyProduct("GNEZDO")]

static class Launcher
{
    [STAThread]
    static int Main(string[] args)
    {
        string dir = AppDomain.CurrentDomain.BaseDirectory;
        string exe = Path.Combine(Path.Combine(dir, "program"), "GNEZDO.exe");
        if (!File.Exists(exe))
        {
            MessageBox.Show("GNEZDO is not complete: " + exe + " is missing.\n\nUnzip the whole GNEZDO folder again.",
                "GNEZDO", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        ProcessStartInfo psi = new ProcessStartInfo(exe, "--desktop");
        psi.UseShellExecute = false;
        psi.CreateNoWindow = true;
        psi.WorkingDirectory = dir;
        try
        {
            Process.Start(psi);
        }
        catch (Exception e)
        {
            MessageBox.Show("GNEZDO could not start:\n" + e.Message +
                "\n\nThis PC may not allow programs in this folder. Move the GNEZDO folder to Documents and try again.",
                "GNEZDO", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        return 0;
    }
}
