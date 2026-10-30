<#
.SYNOPSIS
  OCA Automation setup for Windows: checks this computer first, then installs for the signed-in user.

.DESCRIPTION
  Every check is listed as PASS, WARN or FAIL with what to do about it, and the list is saved to
  system-check.txt. FAIL items block the installation; WARN items do not, but may stop a run later
  (for example, OCA is reachable only on the HPE network or VPN).

  Installs per user, without administrator rights:
    App:   %LOCALAPPDATA%\Programs\OCA-Automation   (replaced by every update)
    Data:  %LOCALAPPDATA%\OCA-Automation            (runs, browser sign-in, settings.txt; kept)

  Works in Windows PowerShell 5.1 (the version every Windows 10/11 has).

.PARAMETER CheckOnly
  Run the checks and write system-check.txt, but do not install.

.PARAMETER Quiet
  No questions: install when the checks allow it and do not start the app (for automated builds).
#>
[CmdletBinding()]
param(
    [switch]$CheckOnly,
    [switch]$Quiet,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\OCA-Automation'),
    [string]$DataDir = (Join-Path $env:LOCALAPPDATA 'OCA-Automation')
)

$ErrorActionPreference = 'Stop'
$PackageRoot = Split-Path -Parent $PSScriptRoot
$PackageApp = Join-Path $PackageRoot 'app'
$DefaultOcaUrl = 'https://ngc-itg-oca-internal.its.hpecorp.net/ocaPreForkM1/OCAInternalLogin'
$MinimumFreeBytes = 1GB
$Results = New-Object System.Collections.Generic.List[object]

function Add-Result {
    param([string]$Name, [ValidateSet('PASS', 'WARN', 'FAIL')][string]$Status, [string]$Detail, [string]$Fix = '')
    $Results.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail; Fix = $Fix })
    $color = @{ PASS = 'Green'; WARN = 'Yellow'; FAIL = 'Red' }[$Status]
    Write-Host ('[{0}] ' -f $Status) -ForegroundColor $color -NoNewline
    Write-Host ('{0}: {1}' -f $Name, $Detail)
    if ($Fix -and $Status -ne 'PASS') { Write-Host ('       What to do: {0}' -f $Fix) -ForegroundColor DarkGray }
}

function Invoke-Check {
    param([string]$Name, [scriptblock]$Body)
    try { & $Body } catch { Add-Result $Name 'FAIL' ("Check could not run: {0}" -f $_.Exception.Message) 'Send system-check.txt to the OCA Automation team.' }
}

function Get-PackageVersion {
    $file = Join-Path $PackageApp 'VERSION'
    if (Test-Path -LiteralPath $file) { return (Get-Content -LiteralPath $file -Raw).Trim() }
    return 'unknown'
}

function Get-Setting {
    param([string]$Key, [string]$Default)
    $file = Join-Path $DataDir 'settings.txt'
    if (Test-Path -LiteralPath $file) {
        foreach ($line in Get-Content -LiteralPath $file) {
            if ($line -match ('^\s*{0}\s*=\s*(.+?)\s*$' -f [regex]::Escape($Key))) { return $Matches[1].Trim('"') }
        }
    }
    return $Default
}

# The same places Playwright looks for an installed Edge or Chrome on Windows.
function Find-Browser {
    param([string]$Vendor, [string]$Exe)
    $roots = @($env:LOCALAPPDATA, ${env:ProgramFiles(x86)}, $env:ProgramFiles) | Where-Object { $_ }
    foreach ($root in $roots) {
        $path = Join-Path $root ('{0}\Application\{1}' -f $Vendor, $Exe)
        if (Test-Path -LiteralPath $path) { return $path }
    }
    return $null
}

function Test-WebAddress {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 0 -ErrorAction Stop
        return @{ Reached = $true; Detail = ('HTTP {0}' -f [int]$response.StatusCode) }
    } catch [System.Net.WebException] {
        $webError = $_.Exception
        if ($null -ne $webError.Response) { return @{ Reached = $true; Detail = ('HTTP {0}' -f [int]$webError.Response.StatusCode) } }
        if ($webError.Status -eq [System.Net.WebExceptionStatus]::TrustFailure) {
            # The automation browser accepts the company's internal certificates.
            return @{ Reached = $true; Detail = 'reached (certificate not trusted by PowerShell; the automation browser accepts it)' }
        }
        return @{ Reached = $false; Detail = $webError.Message }
    } catch {
        # PowerShell reports a redirect it was told not to follow as an error; the site answered.
        if ($_.Exception.Message -match 'redirect') { return @{ Reached = $true; Detail = 'HTTP redirect' } }
        return @{ Reached = $false; Detail = $_.Exception.Message }
    }
}

function Write-Report {
    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('OCA Automation - system check')
    $lines.Add(('Date:            {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')))
    $lines.Add(('Package version: {0}' -f (Get-PackageVersion)))
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
    if ($os) { $lines.Add(('Windows:         {0} ({1}, build {2})' -f $os.Caption, $os.OSArchitecture, $os.BuildNumber)) }
    $lines.Add(('PowerShell:      {0} ({1})' -f $PSVersionTable.PSVersion, $ExecutionContext.SessionState.LanguageMode))
    $lines.Add(('Package folder:  {0}' -f $PackageRoot))
    $lines.Add(('Install folder:  {0}' -f $InstallDir))
    $lines.Add(('Data folder:     {0}' -f $DataDir))
    $lines.Add('')
    foreach ($result in $Results) {
        $lines.Add(('[{0}] {1}: {2}' -f $result.Status, $result.Name, $result.Detail))
        if ($result.Fix -and $result.Status -ne 'PASS') { $lines.Add(('       What to do: {0}' -f $result.Fix)) }
    }
    $failures = @($Results | Where-Object { $_.Status -eq 'FAIL' }).Count
    $warnings = @($Results | Where-Object { $_.Status -eq 'WARN' }).Count
    $lines.Add('')
    $lines.Add(('Result: {0} failed, {1} warning(s)' -f $failures, $warnings))
    foreach ($folder in @($PackageRoot, $env:TEMP)) {
        try {
            $path = Join-Path $folder 'system-check.txt'
            Set-Content -LiteralPath $path -Value $lines -Encoding UTF8
            return $path
        } catch { continue }
    }
    return $null
}

function Invoke-SystemCheck {
    Write-Host ''
    Write-Host '=== OCA Automation - system check ===' -ForegroundColor Cyan
    Write-Host ('Package version: {0}' -f (Get-PackageVersion))
    Write-Host ''
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    Invoke-Check 'Windows' {
        $os = Get-CimInstance Win32_OperatingSystem
        $build = [int]$os.BuildNumber
        if (-not [Environment]::Is64BitOperatingSystem) {
            Add-Result 'Windows' 'FAIL' ('{0} is 32-bit' -f $os.Caption) 'OCA Automation needs 64-bit Windows 10 or 11.'
        } elseif ($build -lt 10240) {
            Add-Result 'Windows' 'FAIL' ('{0} (build {1})' -f $os.Caption, $build) 'OCA Automation needs Windows 10 or 11.'
        } else {
            Add-Result 'Windows' 'PASS' ('{0}, 64-bit, build {1}' -f $os.Caption, $build)
        }
    }

    Invoke-Check 'Package files' {
        $required = @('OCA.exe', 'node\node.exe', 'dist\app\ui-server.js', 'dist\main.js', 'src\ui\public\index.html', 'node_modules\@playwright\test\package.json')
        $missing = @($required | Where-Object { -not (Test-Path -LiteralPath (Join-Path $PackageApp $_)) })
        if ($missing.Count) {
            $fix = 'Right-click the downloaded zip, choose "Extract All", and run Setup.cmd from the extracted folder. Do not run it from inside the zip.'
            if ($PackageRoot -match '\\AppData\\Local\\Temp\\') { $fix = 'Setup.cmd was started from inside the zip. ' + $fix }
            Add-Result 'Package files' 'FAIL' ('missing: {0}' -f ($missing -join ', ')) $fix
        } else {
            Add-Result 'Package files' 'PASS' ('complete ({0})' -f $PackageApp)
        }
    }

    Invoke-Check 'Bundled Node.js' {
        $node = Join-Path $PackageApp 'node\node.exe'
        if (-not (Test-Path -LiteralPath $node)) { Add-Result 'Bundled Node.js' 'FAIL' 'node\node.exe is missing' 'Extract the whole zip again; antivirus may have removed the file.'; return }
        $version = (& $node -e 'process.stdout.write(process.version)' 2>&1 | Out-String).Trim()
        if ($LASTEXITCODE -eq 0 -and $version -match '^v\d+') {
            Add-Result 'Bundled Node.js' 'PASS' ('runs ({0})' -f $version)
        } else {
            Add-Result 'Bundled Node.js' 'FAIL' ('did not run: {0}' -f $version) 'Antivirus or company policy blocked node.exe. Ask IT to allow the OCA Automation folder.'
        }
    }

    Invoke-Check 'Program allowed to run' {
        $exe = Join-Path $PackageApp 'OCA.exe'
        if (-not (Test-Path -LiteralPath $exe)) { Add-Result 'Program allowed to run' 'FAIL' 'OCA.exe is missing' 'Extract the whole zip again; antivirus may have removed the file.'; return }
        try {
            $output = (& $exe --version 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and $output -match 'OCA Automation') {
                Add-Result 'Program allowed to run' 'PASS' ('OCA.exe runs ({0})' -f $output)
            } else {
                Add-Result 'Program allowed to run' 'FAIL' ('OCA.exe did not run (exit {0}): {1}' -f $LASTEXITCODE, $output) 'Send system-check.txt to the OCA Automation team.'
            }
        } catch {
            $message = $_.Exception.Message
            $fix = 'Company policy (AppLocker or Software Restriction) blocks programs that are not signed. Ask IT to allow OCA.exe and node.exe in the OCA Automation folder.'
            Add-Result 'Program allowed to run' 'FAIL' ('OCA.exe was blocked: {0}' -f $message) $fix
        }
    }

    Invoke-Check 'Browser' {
        $edge = Find-Browser 'Microsoft\Edge' 'msedge.exe'
        $chrome = Find-Browser 'Google\Chrome' 'chrome.exe'
        $found = @()
        if ($edge) { $found += ('Microsoft Edge {0}' -f (Get-Item -LiteralPath $edge).VersionInfo.ProductVersion) }
        if ($chrome) { $found += ('Google Chrome {0}' -f (Get-Item -LiteralPath $chrome).VersionInfo.ProductVersion) }
        $choice = (Get-Setting 'OCA_BROWSER' 'auto').ToLowerInvariant()
        if (-not $found.Count) {
            Add-Result 'Browser' 'FAIL' 'neither Microsoft Edge nor Google Chrome was found' 'Install Microsoft Edge or Google Chrome (ask IT if you cannot).'
        } elseif ($choice -in @('edge', 'msedge') -and -not $edge) {
            Add-Result 'Browser' 'FAIL' ('settings.txt asks for Edge, which is not installed; found {0}' -f ($found -join ', ')) 'Set OCA_BROWSER=auto in settings.txt.'
        } elseif ($choice -eq 'chrome' -and -not $chrome) {
            Add-Result 'Browser' 'FAIL' ('settings.txt asks for Chrome, which is not installed; found {0}' -f ($found -join ', ')) 'Set OCA_BROWSER=auto in settings.txt.'
        } else {
            $uses = if ($choice -eq 'chrome' -or -not $edge) { 'Google Chrome' } else { 'Microsoft Edge' }
            Add-Result 'Browser' 'PASS' ('{0}; automation uses {1}' -f ($found -join ', '), $uses)
        }
    }

    Invoke-Check 'Install folder' {
        $parent = Split-Path -Parent $InstallDir
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
        $probe = Join-Path $parent ('oca-write-test-{0}.tmp' -f [guid]::NewGuid())
        Set-Content -LiteralPath $probe -Value 'test' -Encoding ASCII
        Remove-Item -LiteralPath $probe -Force
        $drive = [System.IO.DriveInfo]::new([System.IO.Path]::GetPathRoot($parent))
        $freeGb = [math]::Round($drive.AvailableFreeSpace / 1GB, 1)
        if ($drive.AvailableFreeSpace -lt $MinimumFreeBytes) {
            Add-Result 'Install folder' 'FAIL' ('{0} GB free on {1}' -f $freeGb, $drive.Name) 'Free at least 1 GB on that drive.'
        } else {
            Add-Result 'Install folder' 'PASS' ('{0} is writable; {1} GB free' -f $InstallDir, $freeGb)
        }
    }

    Invoke-Check 'OCA website' {
        $url = Get-Setting 'OCA_BASE_URL' $DefaultOcaUrl
        $hostName = ([uri]$url).Host
        try { [System.Net.Dns]::GetHostAddresses($hostName) | Out-Null } catch {
            Add-Result 'OCA website' 'WARN' ('{0} cannot be found from this network' -f $hostName) 'Connect to the HPE network or VPN before running automation. Installation can continue.'
            return
        }
        $reach = Test-WebAddress $url
        if ($reach.Reached) { Add-Result 'OCA website' 'PASS' ('{0} answered: {1}' -f $hostName, $reach.Detail) }
        else { Add-Result 'OCA website' 'WARN' ('{0}: {1}' -f $hostName, $reach.Detail) 'Connect to the HPE network or VPN before running automation. Installation can continue.' }
    }

    Invoke-Check 'GitHub (updates)' {
        $reach = Test-WebAddress 'https://github.com/Vijayadhas/OCA-Automation/releases'
        if ($reach.Reached) { Add-Result 'GitHub (updates)' 'PASS' ('github.com answered: {0}' -f $reach.Detail) }
        else { Add-Result 'GitHub (updates)' 'WARN' ('github.com not reachable: {0}' -f $reach.Detail) 'New versions must then be copied to this computer another way.' }
    }

    Invoke-Check 'Dashboard port' {
        $port = [int](Get-Setting 'OCA_UI_PORT' '4173')
        $listener = $null
        try {
            $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
            $listener.Start()
            Add-Result 'Dashboard port' 'PASS' ('port {0} is free' -f $port)
        } catch {
            $page = ''
            try { $page = (Invoke-WebRequest -Uri ('http://localhost:{0}' -f $port) -UseBasicParsing -TimeoutSec 3).Content } catch { $page = '' }
            if ($page -match 'OCA Control Center') {
                Add-Result 'Dashboard port' 'PASS' ('port {0} is used by OCA Automation, which is running now' -f $port)
            } else {
                Add-Result 'Dashboard port' 'WARN' ('port {0} is used by another program' -f $port) ('After installing, open {0}\settings.txt and set OCA_UI_PORT to another number, such as 4180.' -f $DataDir)
            }
        } finally {
            if ($listener) { $listener.Stop() }
        }
    }

    $failures = @($Results | Where-Object { $_.Status -eq 'FAIL' }).Count
    $warnings = @($Results | Where-Object { $_.Status -eq 'WARN' }).Count
    $report = Write-Report
    Write-Host ''
    if ($failures) {
        Write-Host ('{0} check(s) failed. Fix them, then run Setup.cmd again.' -f $failures) -ForegroundColor Red
    } elseif ($warnings) {
        Write-Host ('All required checks passed, with {0} warning(s).' -f $warnings) -ForegroundColor Yellow
    } else {
        Write-Host 'All checks passed.' -ForegroundColor Green
    }
    if ($report) { Write-Host ('Report saved to {0} (send this file if you need help).' -f $report) }
    return $failures
}

function Stop-InstalledApp {
    $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and $_.Path.StartsWith($InstallDir, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    })
    if (-not $running.Count) { return }
    if (-not $Quiet) {
        Write-Host ''
        Write-Host 'OCA Automation is running. It will be closed to install the new version (a run in progress stops).' -ForegroundColor Yellow
        $answer = Read-Host 'Close it now? (Y/N)'
        if ($answer -notmatch '^[Yy]') { throw 'Installation cancelled. Close OCA Automation and run Setup.cmd again.' }
    }
    $running | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

function New-Shortcut {
    param([string]$Path, [string]$Target, [string]$WorkingDirectory)
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath = $Target
    $link.WorkingDirectory = $WorkingDirectory
    $link.Description = 'OCA Automation dashboard'
    $link.IconLocation = ('{0},0' -f $Target)
    $link.Save()
}

function Install-App {
    Write-Host ''
    Write-Host '=== Installing OCA Automation ===' -ForegroundColor Cyan
    Stop-InstalledApp
    New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir | Out-Null

    Write-Host ('Copying the app to {0} ...' -f $InstallDir)
    & robocopy.exe $PackageApp $InstallDir /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw ('Copying the app failed (robocopy exit code {0}).' -f $LASTEXITCODE) }

    # Files extracted from a downloaded zip are marked as coming from the internet; the installed copy
    # is the user's own installation, so the mark is removed (no "Windows protected your PC" prompt).
    Get-ChildItem -LiteralPath $InstallDir -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

    $exe = Join-Path $InstallDir 'OCA.exe'
    $check = (& $exe --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw ('The installed OCA.exe did not run: {0}' -f $check) }

    $shortcuts = @()
    try {
        $desktop = [Environment]::GetFolderPath('Desktop')
        $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'OCA Automation.lnk'
        New-Shortcut (Join-Path $desktop 'OCA Automation.lnk') $exe $InstallDir
        New-Shortcut $startMenu $exe $InstallDir
        $shortcuts = @('Desktop', 'Start menu')
    } catch {
        Write-Host ('Shortcuts could not be created ({0}). Start OCA Automation from {1}' -f $_.Exception.Message, $exe) -ForegroundColor Yellow
    }

    Set-Content -LiteralPath (Join-Path $DataDir 'install.txt') -Encoding UTF8 -Value @(
        ('Installed:  {0}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')),
        ('Version:    {0}' -f (Get-PackageVersion)),
        ('App folder: {0}' -f $InstallDir)
    )

    Write-Host ''
    Write-Host ('OCA Automation {0} is installed.' -f (Get-PackageVersion)) -ForegroundColor Green
    if ($shortcuts.Count) { Write-Host ('Start it from the "OCA Automation" shortcut ({0}).' -f ($shortcuts -join ' and ')) }
    Write-Host ('Your runs, browser sign-in and settings.txt are kept in {0}' -f $DataDir)
    Write-Host ('To uninstall, run {0}' -f (Join-Path $InstallDir 'Uninstall.cmd'))
    return $exe
}

try {
    $failures = [int](Invoke-SystemCheck | Select-Object -Last 1)
    if ($CheckOnly) { exit ([int]($failures -gt 0)) }
    if ($failures) { exit 1 }
    if (-not $Quiet) {
        Write-Host ''
        $answer = Read-Host 'Install OCA Automation now? (Y/N)'
        if ($answer -notmatch '^[Yy]') { Write-Host 'Not installed.'; exit 0 }
    }
    $exe = Install-App | Select-Object -Last 1
    if (-not $Quiet) {
        $answer = Read-Host 'Start OCA Automation now? (Y/N)'
        if ($answer -match '^[Yy]') { Start-Process -FilePath $exe -WorkingDirectory $InstallDir }
    }
    exit 0
} catch {
    Write-Host ''
    Write-Host ('[ERROR] {0}' -f $_.Exception.Message) -ForegroundColor Red
    exit 1
}
