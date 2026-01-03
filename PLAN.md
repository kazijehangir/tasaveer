# Tasaveer Implementation Plan

## Project Goal
Create a multiplatform GUI tool ("Tasaveer") to manage a canonical local media archive.
**Core Philosophy**: The file system is the source of truth.
**Key Features**:
1.  **Ingest**: Import media from various sources (Process A).
2.  **Organize**: Sort into `YYYY/MM/DD` structure using `phockup`.
3.  **Sync**: Upload/Sync to Immich using `immich-go`.

## Architecture

### Tech Stack
-   **Framework**: [Tauri](https://tauri.app/) (v2).
    -   *Reason*: Native performance, small binary size, Rust backend for heavy file operations, cross-platform (Win/Mac/Linux).
-   **Frontend**: React + TypeScript + TailwindCSS.
    -   *Reason*: Robust ecosystem, component-based, high quality UI libraries (e.g., Shadcn/UI).
-   **state Management**: TanStack Query (React Query) + Zustand.
-   **Backend (Rust)**:
    -   `std::process::Command` to spawn `phockup` and `immich-go`.
    -   `tauri-plugin-store` for configuration persistence.
    -   `tauri-plugin-dialog` for file/folder selection.

### Integration Strategy
The app will act as an orchestrator (GUI Wrapper) for the CLI tools.

1.  **Phockup Integration**:
    -   **Dependency**: Requires Python 3 & Phockup installed, OR a bundled standalone executable.
    -   **Interaction**: Spawn process: `phockup <source> <destination> [options]`.
    -   **Output Parsing**: Read `stdout`/`stderr` to show progress bars in GUI.

2.  **Immich-Go Integration**:
    -   **Dependency**: Single Go binary. Easy to download/bundle.
    -   **Interaction**: Spawn process: `immich-go -server <url> -key <key> upload <directory>`.
    -   **Output Parsing**: Parse logs for status updates.

## User Flow & Features

### 1. Onboarding / Settings
-   **Welcome Screen**: Explanation of the workflow.
-   **Configuration**:
    -   **Binaries Paths**: Locating `phockup` and `immich-go`. (Auto-detect + Manual Override).
    -   **Canonical Archive Path**: The master folder (e.g., `~/Pictures/Archive`).
    -   **Immich Credentials**: Server URL and API Key.

### 2. Ingestion (The "Import" Tab)
-   **Source Selection**: Drag & drop folder/file, or "Select Device" (detect mounted SD cards).
-   **Strategy**:
    -   *Copy*: Safe, keeps source.
    -   *Move*: Good for SD cards (clears space).
-   **Preview**: (Optional) Quick scan to count files.
-   **Action**: "Start Import" -> Runs `phockup`.
-   **Feedback**: Real-time log/progress bar.

### 3. Synchronization (The "Sync" Tab)
-   **Status**: Show last sync time.
-   **Action**: "Sync to Immich".
-   **Options**:
    -   Sync specific year/month? (Default: Sync All / Incremental).
    -   Uses `immich-go` to upload the Canonical Archive to Immich.

### 4. Tools / Utilities
-   **Duplicate Finder**: Leverage `phockup`'s duplicate handling or `immich-go`'s dedupe.
-   **Log Viewer**: History of operations.

## Multiplatform Considerations
-   **Windows**:
    -   Path handling (`\` vs `/`).
    -   Bundling `immich-go.exe`.
-   **macOS**:
    -   **Permissions**: App Sandbox entitlement to read/write User Selected Files.
    -   Notarization if distributing.
-   **Linux**:
    -   AppImage or Deb.
    -   Dependencies (`python3`, `exiftool`) usually easier to satisfy via package manager.

## Implementation Steps

### Phase 1: Foundation
1.  Initialize Tauri v2 project (React/TS).
2.  Set up frontend scaffolding (Tailwind, Router, Sidebar layout).
3.  Implement "Settings" page to persist paths and API keys using `tauri-plugin-store`.

### Phase 2: Binary Orchestration (Rust)
1.  Create Rust modules to command CLI tools.
2.  Implement `check_dependencies` command: verify if `phockup` and `immich-go` are executable.
3.  Implement `run_process` command: generic wrapper to spawn child process and stream output to frontend via Tauri Events.

### Phase 3: The Ingest Workflow
1.  UI for Source Selection (File Dialog).
2.  Construct `phockup` arguments logic (Source -> Canonical).
3.  Connect UI "Import" button to Rust `run_phockup` command.
4.  Parse `phockup` output to update progress bar.

### Phase 4: The Sync Workflow
1.  UI for Immich sync status.
2.  Construct `immich-go` arguments.
3.  Connect UI "Sync" button to Rust `run_immich_go` command.

### Phase 5: Polish & Distribution
1.  Error handling (e.g., binary not found, permission denied).
2.  Theme (Dark/Light mode).
3.  CI/CD setup to build binaries for Win/Mac/Linux.
