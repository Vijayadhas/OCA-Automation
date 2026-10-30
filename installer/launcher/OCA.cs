// OCA.exe: starts the OCA Automation dashboard for the signed-in Windows user and opens it in the
// default browser. Built by .github/workflows/windows-package.yml with the .NET Framework compiler
// that ships with Windows (C# 5: no string interpolation or null-conditional operators).
//
//   OCA.exe               start the dashboard (or open it, when it is already running)
//   OCA.exe --version     print the package version and exit (used by Setup's system check)
//   OCA.exe --no-browser  start the dashboard without opening a browser window
//
// The app files stay in the install folder; each user's runs, browser sign-in profiles and
// settings.txt live in %LOCALAPPDATA%\OCA-Automation (or OCA_DATA_DIR), so updates never touch them.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading;

[assembly: AssemblyTitle("OCA Automation")]
[assembly: AssemblyProduct("OCA Automation")]
[assembly: AssemblyDescription("Starts the OCA Automation dashboard")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Launcher
{
    const string DefaultPort = "4173";

    static readonly string SettingsTemplate = string.Join(Environment.NewLine, new[]
    {
        "# OCA Automation settings for this Windows user.",
        "# A line starting with # is ignored. Remove the # to use a setting, then restart OCA Automation.",
        "",
        "# How long to wait for you to sign in to OCA, in milliseconds.",
        "OCA_AUTH_WAIT_MS=120000",
        "",
        "# Browser: auto (Microsoft Edge, then Google Chrome), edge, chrome or chromium.",
        "# OCA_BROWSER=auto",
        "",
        "# OCA login page.",
        "# OCA_BASE_URL=https://ngc-itg-oca-internal.its.hpecorp.net/ocaPreForkM1/OCAInternalLogin",
        "",
        "# Dashboard port, when 4173 is used by another program.",
        "# OCA_UI_PORT=4173",
        "",
        "# Attempts per model before it is reported as failed.",
        "# OCA_MODEL_ATTEMPTS=1",
        ""
    });

    static string AppDir
    {
        get { return AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\'); }
    }

    static int Main(string[] args)
    {
        try
        {
            return Run(args);
        }
        catch (Exception error)
        {
            Console.ForegroundColor = ConsoleColor.Red;
            Console.WriteLine();
            Console.WriteLine("[ERROR] " + error.Message);
            Console.ResetColor();
            PauseBeforeClosing(args);
            return 1;
        }
    }

    static bool Has(string[] args, string flag)
    {
        foreach (string arg in args)
        {
            if (string.Equals(arg, flag, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    static string ReadVersion()
    {
        string file = Path.Combine(AppDir, "VERSION");
        return File.Exists(file) ? File.ReadAllText(file).Trim() : "unknown";
    }

    static int Run(string[] args)
    {
        if (Has(args, "--version"))
        {
            Console.WriteLine("OCA Automation " + ReadVersion());
            return 0;
        }
        Console.Title = "OCA Automation";

        string node = Path.Combine(AppDir, @"node\node.exe");
        string server = Path.Combine(AppDir, @"dist\app\ui-server.js");
        foreach (string required in new[] { node, server })
        {
            if (!File.Exists(required))
            {
                throw new Exception("OCA Automation is not installed completely (" + required
                    + " is missing). Run Setup.cmd from the downloaded package again.");
            }
        }

        string dataDir = Environment.GetEnvironmentVariable("OCA_DATA_DIR");
        if (string.IsNullOrEmpty(dataDir))
        {
            dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OCA-Automation");
        }
        Directory.CreateDirectory(dataDir);

        Dictionary<string, string> settings = LoadSettings(dataDir);
        settings["OCA_DATA_DIR"] = dataDir;
        if (!settings.ContainsKey("OCA_PROFILE_DIR")) settings["OCA_PROFILE_DIR"] = Path.Combine(dataDir, "browser-profile");
        if (!settings.ContainsKey("OCA_UI_PORT")) settings["OCA_UI_PORT"] = DefaultPort;
        string url = "http://localhost:" + settings["OCA_UI_PORT"];
        bool openBrowser = !Has(args, "--no-browser");

        if (IsDashboard(url))
        {
            Console.WriteLine("OCA Automation is already running: " + url);
            if (openBrowser) Process.Start(url);
            return 0;
        }

        Console.ForegroundColor = ConsoleColor.Cyan;
        Console.WriteLine("=== OCA Automation ===");
        Console.ResetColor();
        Console.WriteLine("Version:   " + ReadVersion());
        Console.WriteLine("Dashboard: " + url);
        Console.WriteLine("Your data: " + dataDir);
        Console.ForegroundColor = ConsoleColor.Yellow;
        Console.WriteLine("Keep this window open while you use OCA Automation. Close it to stop.");
        Console.ResetColor();
        Console.WriteLine();

        ProcessStartInfo start = new ProcessStartInfo(node, "\"" + server + "\"");
        start.UseShellExecute = false;
        start.WorkingDirectory = dataDir;
        foreach (KeyValuePair<string, string> setting in settings) start.EnvironmentVariables[setting.Key] = setting.Value;
        Process dashboard = Process.Start(start);

        bool ready = false;
        for (int attempt = 0; attempt < 120 && !dashboard.HasExited; attempt++)
        {
            if (IsDashboard(url)) { ready = true; break; }
            Thread.Sleep(500);
        }
        if (!ready)
        {
            if (dashboard.HasExited)
            {
                throw new Exception("The dashboard stopped with exit code " + dashboard.ExitCode + ". See the messages above.");
            }
            try { dashboard.Kill(); } catch (Exception) { }
            throw new Exception("The dashboard did not start at " + url + " within 60 seconds.");
        }

        Console.ForegroundColor = ConsoleColor.Green;
        Console.WriteLine("OCA Automation is ready: " + url);
        Console.ResetColor();
        if (openBrowser) Process.Start(url);

        dashboard.WaitForExit();
        if (dashboard.ExitCode != 0)
        {
            Console.WriteLine("The dashboard stopped with exit code " + dashboard.ExitCode + ".");
            PauseBeforeClosing(args);
        }
        return dashboard.ExitCode;
    }

    /// <summary>KEY=VALUE lines of settings.txt; written with the defaults the first time.</summary>
    static Dictionary<string, string> LoadSettings(string dataDir)
    {
        string file = Path.Combine(dataDir, "settings.txt");
        if (!File.Exists(file)) File.WriteAllText(file, SettingsTemplate);
        Dictionary<string, string> settings = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        Regex line = new Regex(@"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$");
        foreach (string text in File.ReadAllLines(file))
        {
            if (text.TrimStart().StartsWith("#")) continue;
            Match match = line.Match(text);
            if (match.Success && match.Groups[2].Value.Length > 0)
            {
                settings[match.Groups[1].Value.ToUpperInvariant()] = match.Groups[2].Value.Trim('"');
            }
        }
        return settings;
    }

    /// <summary>True when the OCA dashboard answers at the URL.</summary>
    static bool IsDashboard(string url)
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
            request.Proxy = null;
            request.Timeout = 1500;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
            {
                return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd().Contains("OCA Control Center");
            }
        }
        catch (Exception)
        {
            return false;
        }
    }

    static void PauseBeforeClosing(string[] args)
    {
        if (Has(args, "--no-browser") || Console.IsInputRedirected) return;
        Console.WriteLine("Press Enter to close this window.");
        Console.ReadLine();
    }
}
