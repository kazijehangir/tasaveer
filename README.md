# Tasaveer

Tasaveer is a media ingestion tool for photographers and videographers. It simplifies the process of importing media from various sources (like SD cards) into an organized archive on your local machine.

## Features

- **Ingest Workflow**: Streamlined process to select source and destination paths.
- **Import Strategies**:
  - **Copy**: Safely duplicates files (keeps originals).
  - **Move**: Transfers files and clears source (saves space).
- **Control**: Start and cancel operations safely at any time.
- **Monitoring**: Real-time progress logs.

## Installation and Prerequisites

### Prerequisites

This app uses `phockup` to ingest media. Please install it on your system.

#### MacOS

The Homebrew formula for phockup is currently broken. Please use `pipx` to install it reliably:

```bash
# 1. Install pipx (if not already installed)
brew install pipx
pipx ensurepath

# 2. Install phockup from source
pipx install git+https://github.com/ivandokov/phockup.git
```

#### Windows

1. **Install Python 3** (if not already installed):
   - Download from [python.org](https://www.python.org/downloads/windows/) or use Winget:
   ```powershell
   winget install Python.Python.3.13
   ```

2. **Install ExifTool** (required by phockup):
   ```powershell
   winget install OliverBetz.ExifTool --accept-package-agreements --accept-source-agreements
   ```

3. **Install phockup**:
   ```powershell
   # Clone phockup to your local Programs folder
   git clone --depth 1 https://github.com/ivandokov/phockup.git "$env:LOCALAPPDATA\Programs\phockup"

   # Install Python dependencies
   pip install -r "$env:LOCALAPPDATA\Programs\phockup\requirements.txt"

   # Add phockup to your PATH
   [Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:LOCALAPPDATA\Programs\phockup", [EnvironmentVariableTarget]::User)

   # Create a batch wrapper for easy execution
   Set-Content -Path "$env:LOCALAPPDATA\Programs\phockup\phockup.bat" -Value '@echo off','python "%~dp0phockup.py" %*'
   ```

4. **Restart your terminal** to pick up the new PATH, then verify:
   ```powershell
   phockup --version
   ```

### Immich-Go

To upload media to your Immich server, you need `immich-go`.

#### MacOS / Linux

1. Download the latest release from the [GitHub Release Page](https://github.com/simulot/immich-go/releases).
2. Rename the binary to `immich-go` and `chmod +x` it.
3. Place it in a folder included in your system PATH (e.g., `/usr/local/bin`).

#### Windows

Run the following in PowerShell:

```powershell
# Download and extract immich-go
Invoke-WebRequest -Uri "https://github.com/simulot/immich-go/releases/latest/download/immich-go_Windows_x86_64.zip" -OutFile "$env:TEMP\immich-go.zip"
Expand-Archive -Path "$env:TEMP\immich-go.zip" -DestinationPath "$env:LOCALAPPDATA\Programs\immich-go" -Force

# Add to PATH
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:LOCALAPPDATA\Programs\immich-go", [EnvironmentVariableTarget]::User)
```

Restart your terminal, then verify with `immich-go version`.

## Developing Guide

This template should help get you started developing with Tauri, React and Typescript in Vite.

### Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

### Windows Development Setup

1.  **Install Rust**:
    *   Download and run `rustup-init.exe` from [rust-lang.org](https://www.rust-lang.org/tools/install).
    *   Or use Winget: `winget install Rustlang.Rustup`.
2.  **C++ Build Tools**:
    *   Ensure "Desktop development with C++" is installed via Visual Studio Build Tools.
