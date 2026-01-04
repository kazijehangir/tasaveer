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

## Developing Guide

This template should help get you started developing with Tauri, React and Typescript in Vite.

### Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
