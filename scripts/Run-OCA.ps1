[CmdletBinding()]
param(
    [switch]$Configure
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $ProjectRoot '.oca-local.json'
$SetupMarkerPath = Join-Path $ProjectRoot '.oca-setup-complete'

function Disable-ConsoleQuickEdit {
    if ($env:OS -ne 'Windows_NT' -or [Console]::IsInputRedirected) { return }
    try {
        if (-not ('OcaConsoleMode' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class OcaConsoleMode {
    private const int STD_INPUT_HANDLE = -10;
    private const uint ENABLE_QUICK_EDIT_MODE = 0x0040;
    private const uint ENABLE_EXTENDED_FLAGS = 0x0080;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint mode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint mode);

    public static bool DisableQuickEdit() {
        IntPtr handle = GetStdHandle(STD_INPUT_HANDLE);
        uint mode;
        if (handle == IntPtr.Zero || !GetConsoleMode(handle, out mode)) return false;
        mode |= ENABLE_EXTENDED_FLAGS;
        mode &= ~ENABLE_QUICK_EDIT_MODE;
        return SetConsoleMode(handle, mode);
    }
}
'@
        }
        if ([OcaConsoleMode]::DisableQuickEdit()) {
            Write-Host '[INFO] Command Prompt QuickEdit pause protection enabled.' -ForegroundColor DarkGray
        }
    } catch {
        Write-Host '[WARN] Could not disable Command Prompt QuickEdit. Avoid clicking or selecting text while automation runs.' -ForegroundColor Yellow
    }
}

Disable-ConsoleQuickEdit

function Read-WithDefault {
    param([string]$Prompt, [string]$Default)
    $value = Read-Host "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
    return $value.Trim().Trim('"')
}

function Resolve-ProjectPath {
    param([string]$Value)
    if ([System.IO.Path]::IsPathRooted($Value)) {
        return [System.IO.Path]::GetFullPath($Value)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $Value))
}

function Save-Configuration {
    Write-Host ''
    Write-Host 'OCA laptop configuration' -ForegroundColor Cyan
    Write-Host 'Settings are saved only on this laptop in .oca-local.json (ignored by Git).'

    $environmentName = Read-WithDefault 'Environment name' 'Integration'
    $baseUrl = Read-WithDefault 'OCA login URL' 'https://ngc-itg-oca-internal.its.hpecorp.net/ocaPreForkM1/OCAInternalLogin'
    $excelInput = Read-WithDefault 'Excel input path (absolute or relative to this project)' 'input\models.xlsx'
    $outputInput = Read-WithDefault 'Results folder (absolute or relative to this project)' 'output'
    $profileInput = Read-WithDefault 'Browser profile folder (absolute or relative to this project)' '.oca-profile'
    $authWait = Read-WithDefault 'Manual login wait in seconds' '120'

    $seconds = 0
    if (-not [int]::TryParse($authWait, [ref]$seconds) -or $seconds -lt 10) {
        throw 'Manual login wait must be a whole number of at least 10 seconds.'
    }

    $excelPath = Resolve-ProjectPath $excelInput
    $samplePath = Join-Path $ProjectRoot 'input\models.sample.xlsx'
    if (-not (Test-Path -LiteralPath $excelPath) -and
        [System.IO.Path]::GetFullPath($excelPath) -eq [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot 'input\models.xlsx')) -and
        (Test-Path -LiteralPath $samplePath)) {
        Copy-Item -LiteralPath $samplePath -Destination $excelPath
        Write-Host "Created working Excel file: $excelPath" -ForegroundColor Green
    }

    $settings = [ordered]@{
        environmentName = $environmentName
        baseUrl = $baseUrl
        excelPath = $excelPath
        outputPath = Resolve-ProjectPath $outputInput
        profilePath = Resolve-ProjectPath $profileInput
        authWaitMs = $seconds * 1000
    }
    $settings | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
    Write-Host "Saved configuration: $ConfigPath" -ForegroundColor Green
}

function Load-Configuration {
    if (-not (Test-Path -LiteralPath $ConfigPath)) { Save-Configuration }
    try {
        return Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
    } catch {
        throw "Cannot read $ConfigPath. Delete it and run the launcher again. $($_.Exception.Message)"
    }
}

# Chrome or Edge, where Playwright looks for them on Windows: the automation uses Chrome, then Edge, and
# needs Playwright's own Chromium only when neither is installed.
function Test-InstalledBrowser {
    $roots = @($env:LOCALAPPDATA, ${env:ProgramFiles(x86)}, $env:ProgramFiles) | Where-Object { $_ }
    foreach ($root in $roots) {
        foreach ($exe in @('Google\Chrome\Application\chrome.exe', 'Microsoft\Edge\Application\msedge.exe')) {
            if (Test-Path -LiteralPath (Join-Path $root $exe)) { return $true }
        }
    }
    return $false
}

# Playwright's Chromium is a fallback. An office network often blocks its download; with Chrome or Edge
# installed that is only a warning.
function Install-PlaywrightChromium {
    Write-Host 'Installing the Playwright Chromium browser (first run only)...' -ForegroundColor Yellow
    & npx.cmd playwright install chromium
    if ($LASTEXITCODE -eq 0) { return }
    if (Test-InstalledBrowser) {
        Write-Host "[WARN] Playwright Chromium could not be downloaded (exit code $LASTEXITCODE). Google Chrome or Microsoft Edge is installed and will be used; continuing." -ForegroundColor Yellow
        return
    }
    throw "Playwright Chromium could not be downloaded (exit code $LASTEXITCODE), and neither Google Chrome nor Microsoft Edge is installed. Install Google Chrome, or ask IT to allow the download, then run this launcher again."
}

function Confirm-Prerequisites {
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw 'Node.js is not installed or is not on PATH. Install the Node.js LTS release, then run this launcher again.'
    }
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'npm is not available on PATH. Reinstall Node.js LTS, then run this launcher again.'
    }

    if (-not (Test-Path -LiteralPath $SetupMarkerPath)) {
        Write-Host 'Installing project packages (first run only)...' -ForegroundColor Yellow
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }

        Install-PlaywrightChromium
        Set-Content -LiteralPath $SetupMarkerPath -Value 'Setup completed successfully.' -Encoding ASCII
    }
}

function Set-OcaEnvironment {
    param($Settings)
    $env:OCA_BASE_URL = [string]$Settings.baseUrl
    $env:OCA_AUTH_WAIT_MS = [string]$Settings.authWaitMs
    $env:OCA_PROFILE_DIR = [string]$Settings.profilePath
}

function Invoke-Oca {
    param($Settings, [string[]]$ExtraArguments = @())
    if (-not (Test-Path -LiteralPath $Settings.excelPath -PathType Leaf)) {
        throw "Excel input was not found: $($Settings.excelPath). Choose option 5 to update the path."
    }
    New-Item -ItemType Directory -Force -Path $Settings.outputPath, $Settings.profilePath | Out-Null
    Set-OcaEnvironment $Settings

    $arguments = @(
        'run', 'oca', '--',
        '--input', [string]$Settings.excelPath,
        '--output', [string]$Settings.outputPath,
        '--profile', [string]$Settings.profilePath,
        '--headed', '--trace'
    ) + $ExtraArguments

    Write-Host ''
    Write-Host "Environment: $($Settings.environmentName)" -ForegroundColor Cyan
    Write-Host "Excel:       $($Settings.excelPath)"
    Write-Host 'Close the Excel workbook before continuing. Complete login in Chromium if requested.' -ForegroundColor Yellow
    & npm.cmd @arguments
}

try {
    Set-Location -LiteralPath $ProjectRoot
    if ($Configure) { Save-Configuration }
    Confirm-Prerequisites

    while ($true) {
        $settings = Load-Configuration
        Write-Host ''
        Write-Host '=== OCA Automation ===' -ForegroundColor Cyan
        Write-Host "Environment: $($settings.environmentName)"
        Write-Host "Excel: $($settings.excelPath)"
        Write-Host '1. Run all enabled Excel rows'
        Write-Host '2. Run one Job ID'
        Write-Host '3. Retry failed jobs'
        Write-Host '4. Run local unit tests (no OCA connection)'
        Write-Host '5. Change laptop configuration'
        Write-Host '6. Exit'
        $choice = Read-Host 'Choose 1-6'

        switch ($choice) {
            '1' {
                Invoke-Oca $settings
                exit $LASTEXITCODE
            }
            '2' {
                $jobId = Read-Host 'Enter the exact Job ID from Excel'
                if ([string]::IsNullOrWhiteSpace($jobId)) {
                    Write-Host 'Job ID cannot be blank.' -ForegroundColor Yellow
                    continue
                }
                Invoke-Oca $settings @('--job-id', $jobId.Trim())
                exit $LASTEXITCODE
            }
            '3' {
                Invoke-Oca $settings @('--retry-failed')
                exit $LASTEXITCODE
            }
            '4' {
                & npm.cmd run test:unit
                exit $LASTEXITCODE
            }
            '5' { Save-Configuration }
            '6' { exit 0 }
            default { Write-Host 'Please choose a number from 1 to 6.' -ForegroundColor Yellow }
        }
    }
} catch {
    Write-Host ''
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
