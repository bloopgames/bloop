#Requires -Version 5.1
<#
.SYNOPSIS
    Cross-platform setup script for Bloop (Windows)
.DESCRIPTION
    Checks for Bun and Zig, offers to install if missing, warns on version mismatch
#>

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

# Default versions (overridden by setup.config)
$BunMinVersion = "1.3.1"
$ZigMinVersion = "0.16.0-dev.1225"

function Write-Header {
    param([string]$Message)
    Write-Host "=== $Message ===" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Err {
    param([string]$Message)
    Write-Host $Message -ForegroundColor Red
}

function Load-Config {
    $configPath = Join-Path $ProjectRoot "setup.config"

    if (-not (Test-Path $configPath)) {
        Write-Warn "Warning: setup.config not found, using defaults"
        return
    }

    Get-Content $configPath | ForEach-Object {
        if ($_ -match "^\s*([A-Z_]+)\s*=\s*(.+)\s*$" -and $_ -notmatch "^\s*#") {
            $key = $Matches[1].Trim()
            $value = $Matches[2].Trim()
            switch ($key) {
                "BUN_MIN_VERSION" { $script:BunMinVersion = $value }
                "ZIG_MIN_VERSION" { $script:ZigMinVersion = $value }
            }
        }
    }
}

function Parse-ZigVersion {
    param([string]$Version)

    # Dev version: 0.16.0-dev.1225+hash
    if ($Version -match "^(\d+)\.(\d+)\.(\d+)-dev\.(\d+)") {
        return @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3], [int]$Matches[4])
    }
    # Stable version: 0.16.0 (treat as higher than any dev)
    elseif ($Version -match "^(\d+)\.(\d+)\.(\d+)$") {
        return @([int]$Matches[1], [int]$Matches[2], [int]$Matches[3], 999999)
    }
    return @(0, 0, 0, 0)
}

function Compare-ZigVersion {
    param([string]$Current, [string]$Required)

    $cParts = Parse-ZigVersion $Current
    $rParts = Parse-ZigVersion $Required

    for ($i = 0; $i -lt 4; $i++) {
        if ($cParts[$i] -gt $rParts[$i]) { return $true }
        if ($cParts[$i] -lt $rParts[$i]) { return $false }
    }
    return $true  # Equal
}

function Compare-SemVer {
    param([string]$Current, [string]$Required)

    $cParts = $Current.Split('.') | ForEach-Object { [int]$_ }
    $rParts = $Required.Split('.') | ForEach-Object { [int]$_ }

    $maxLen = [Math]::Max($cParts.Count, $rParts.Count)
    for ($i = 0; $i -lt $maxLen; $i++) {
        $c = if ($i -lt $cParts.Count) { $cParts[$i] } else { 0 }
        $r = if ($i -lt $rParts.Count) { $rParts[$i] } else { 0 }
        if ($c -gt $r) { return $true }
        if ($c -lt $r) { return $false }
    }
    return $true
}

function Install-Bun {
    Write-Host "Installing Bun..."

    # Try winget first
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "Using winget..."
        winget install Oven-sh.Bun --accept-package-agreements --accept-source-agreements
    }
    # Try scoop
    elseif (Get-Command scoop -ErrorAction SilentlyContinue) {
        Write-Host "Using scoop..."
        scoop install bun
    }
    # Fall back to PowerShell installer
    else {
        Write-Host "Using PowerShell installer..."
        irm bun.sh/install.ps1 | iex
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        Write-Warn ""
        Write-Warn "Bun was installed but not found in PATH."
        Write-Warn "You may need to restart your terminal."
        exit 1
    }

    Write-Success "Bun installed successfully!"
}

function Install-Zig {
    Write-Host "Installing Zig..."

    # Try scoop first (has good zig support)
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        Write-Host "Using scoop..."
        scoop install zig
    }
    # Try winget
    elseif (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "Using winget..."
        winget install zig.zig --accept-package-agreements --accept-source-agreements
    }
    # Fall back to direct download
    else {
        Write-Host "Downloading directly..."

        $arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else { "x86" }
        $url = "https://ziglang.org/builds/zig-windows-$arch-$ZigMinVersion.zip"
        $installDir = "$env:LOCALAPPDATA\zig"
        $zipPath = "$env:TEMP\zig.zip"

        Write-Host "Downloading from: $url"
        Invoke-WebRequest -Uri $url -OutFile $zipPath

        # Clean up old installation
        if (Test-Path $installDir) {
            Remove-Item $installDir -Recurse -Force
        }

        # Extract (strip top-level directory)
        $tempExtract = "$env:TEMP\zig-extract"
        Expand-Archive -Path $zipPath -DestinationPath $tempExtract -Force
        $extractedDir = Get-ChildItem $tempExtract | Select-Object -First 1
        Move-Item $extractedDir.FullName $installDir
        Remove-Item $tempExtract -Recurse -Force
        Remove-Item $zipPath

        # Add to user PATH
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$installDir*") {
            [Environment]::SetEnvironmentVariable("Path", "$userPath;$installDir", "User")
            $env:Path += ";$installDir"
        }

        Write-Success "Zig installed to $installDir"
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (-not (Get-Command zig -ErrorAction SilentlyContinue)) {
        Write-Warn ""
        Write-Warn "Zig was installed but not found in PATH."
        Write-Warn "You may need to restart your terminal."
        exit 1
    }

    Write-Success "Zig installed successfully!"
}

function Check-Bun {
    Write-Host "Checking for Bun..."

    $bunPath = Get-Command bun -ErrorAction SilentlyContinue
    if (-not $bunPath) {
        Write-Warn "Bun is not installed."
        Write-Host ""
        $response = Read-Host "Would you like to install Bun? [Y/n]"
        if ($response -match "^[Nn]") {
            Write-Host "Skipping Bun installation."
            Write-Host "Visit: https://bun.sh"
            exit 1
        }
        Install-Bun
        return
    }

    $bunVersion = & bun --version
    Write-Host "Found Bun $bunVersion"

    if (-not (Compare-SemVer $bunVersion $BunMinVersion)) {
        Write-Warn "Warning: Bun $bunVersion is older than suggested $BunMinVersion"
        Write-Host "Consider upgrading: bun upgrade"
    }
    else {
        Write-Success "Bun version OK"
    }
}

function Check-Zig {
    Write-Host ""
    Write-Host "Checking for Zig..."

    $zigPath = Get-Command zig -ErrorAction SilentlyContinue
    if (-not $zigPath) {
        Write-Warn "Zig is not installed."
        Write-Host ""
        $response = Read-Host "Would you like to install Zig? [Y/n]"
        if ($response -match "^[Nn]") {
            Write-Host "Skipping Zig installation."
            Write-Host "Visit: https://ziglang.org/download/"
            exit 1
        }
        Install-Zig
        return
    }

    $zigVersion = & zig version
    Write-Host "Found Zig $zigVersion"

    if (-not (Compare-ZigVersion $zigVersion $ZigMinVersion)) {
        Write-Host ""
        Write-Warn "Warning: Zig $zigVersion may not be compatible."
        Write-Host "Required: $ZigMinVersion or higher"
        Write-Host ""
        Write-Host "To upgrade, download from: https://ziglang.org/download/"
        Write-Host ""
        $response = Read-Host "Continue anyway? [y/N]"
        if ($response -notmatch "^[Yy]") {
            exit 1
        }
        Write-Host "Continuing with current Zig version..."
    }
    else {
        Write-Success "Zig version OK"
    }
}

function Run-BunInstall {
    Write-Host ""
    Write-Host "Installing dependencies with Bun..."
    Set-Location $ProjectRoot
    & bun install
}

function Verify-Setup {
    Write-Host ""
    Write-Host "Verifying setup..."

    $allOk = $true

    if (Get-Command bun -ErrorAction SilentlyContinue) {
        Write-Success "  Bun: OK"
    }
    else {
        Write-Err "  Bun: NOT FOUND"
        $allOk = $false
    }

    if (Get-Command zig -ErrorAction SilentlyContinue) {
        Write-Success "  Zig: OK"
    }
    else {
        Write-Err "  Zig: NOT FOUND"
        $allOk = $false
    }

    $nodeModules = Join-Path $ProjectRoot "node_modules"
    if (Test-Path $nodeModules) {
        Write-Success "  Dependencies: OK"
    }
    else {
        Write-Err "  Dependencies: NOT INSTALLED"
        $allOk = $false
    }

    if ($allOk) {
        Write-Host ""
        Write-Success "Setup complete!"
        Write-Host ""
        Write-Host "Next steps:"
        Write-Host "  bun run ci        # Run all checks"
        Write-Host "  cd games\mario; bun run dev  # Start a game dev server"
    }
}

function Main {
    Write-Header "Bloop Setup"
    Write-Host ""

    Load-Config
    Check-Bun
    Check-Zig
    Run-BunInstall
    Verify-Setup
}

Main
