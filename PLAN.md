# Tasaveer Implementation Plan

## Project Goal
Create a multiplatform GUI tool ("Tasaveer") to manage a canonical local media archive.
**Core Philosophy**: The file system is the source of truth.
**Key Features**:
1.  **Ingest**: Import media from various sources.
2.  **Organize**: Sort into `YYYY/MM/DD` structure using native Rust logic + `exiftool`.
3.  **Sync**: Upload/Sync to Immich using `immich-go`.

## Architecture

### Tech Stack
-   **Framework**: [Tauri](https://tauri.app/) (v2).
    -   *Reason*: Native performance, small binary size, Rust backend for heavy file operations, cross-platform (Win/Mac/Linux).
-   **Frontend**: React + TypeScript + TailwindCSS.
    -   *Reason*: Robust ecosystem, component-based, high quality UI libraries.
-   **State Management**: TanStack Query (React Query) + Zustand.
-   **Backend (Rust)**:
    -   `std::process::Command` to spawn `exiftool` and `immich-go`.
    -   `walkdir` to recursively scan directories.
    -   `sha2` for file hashing (deduplication).
    -   `tauri-plugin-store` for configuration persistence.
    -   `tauri-plugin-dialog` for file/folder selection.

### Integration Strategy
The app will act as an orchestrator (GUI Wrapper) but will handle the "Phockup" logic internally.

1.  **Media Organization (Replacing Phockup)**:
    -   **Dependency**: bundled `exiftool` binary.
    -   **Logic**:
        -   Iterate source files using Rust.
        -   Read metadata (DateTimeOriginal) via `exiftool`.
        -   Calculate destination path (`YYYY/MM/DD`).
        -   Handle duplicates (compare hashes).
        -   Move/Copy files.
    -   **Advantage**: Precise progress tracking, no Python dependency, customized collision handling.

2.  **Immich-Go Integration**:
    -   **Dependency**: bundled `immich-go` binary.
    -   **Interaction**: Spawn process: `immich-go -server <url> -key <key> upload <directory>`.
    -   **Output Parsing**: Parse logs for status updates.

## User Flow & Features

### 1. Onboarding / Settings
-   **Welcome Screen**: Explanation of the workflow.
-   **Configuration**:
    -   **Binaries Paths**: Locating `exiftool` and `immich-go`.
    -   **Canonical Archive Path**: The master folder (e.g., `~/Pictures/Archive`).
    -   **Immich Credentials**: Server URL and API Key.

### 2. Ingestion (The "Import" Tab)
-   **Source Selection**: Drag & drop folder/file, or "Select Device".
-   **Strategy**: *Copy* (Safe) or *Move* (Clear space).
-   **Preview**: Scan source and show count of "New" vs "Duplicate" files.
-   **Action**: "Start Import".
-   **Feedback**: Real-time progress bar (File X of Y).

### 3. Synchronization (The "Sync" Tab)
-   **Status**: Show last sync time.
-   **Action**: "Sync to Immich".
-   **Options**: Defaults to Sync All / Incremental.

### 4. Tools / Utilities
-   **Duplicate Finder**: Use `czkawka_cli` (bundled) or internal hash scan.
-   **Log Viewer**: History of operations.

## Implementation Steps

### Phase 1: Foundation (Completed)
1.  [x] Initialize Tauri v2 project.
2.  [x] Set up frontend scaffolding.
3.  [x] Implement Settings with `tauri-plugin-store`.

### Phase 2: Core Organization Logic (Rust)

#### 2.1 ExifTool Performance Optimization
-   [x] Implement `ExifToolDaemon` with `-stay_open` mode (persistent process)
-   [x] Add batch processing for scan operations via stdin/stdout
-   [ ] Benchmark and validate 10x+ improvement

#### 2.2 ExifTool Sidecar Bundling
-   [x] Add `binaries/exiftool` to `externalBin` in `tauri.conf.json`
-   [x] Create download script for CI (Windows exe, macOS/Linux Perl bundle)
-   [x] Update `capabilities/shell.json` for sidecar execution
-   [ ] Implement fallback: bundled sidecar → PATH → error with install message

#### 2.3 Settings Migration to tauri-plugin-store
-   [x] Initialize `tauri_plugin_store` in `lib.rs`
-   [x] Create new store schema (migrate structure, not existing values)
-   [x] Remove manual `load_settings`/`save_settings` Tauri commands
-   [x] Update frontend to use `@tauri-apps/plugin-store` API

#### 2.4 Binary Manager Module
-   [x] Create `src-tauri/src/binaries.rs` for unified path resolution
-   [x] Implement `discover_binary()` for exiftool, immich-go, czkawka
-   [x] Provide clear install instructions when binaries are missing

#### 2.5 Organization Engine

- [x] Create `src-tauri/src/organize.rs` module

- [x] Implement logic: `Input Path` → `DateTimeOriginal` → `YYYY/MM/DD` dest

- [x] Add collision handling (hash comparison, smart rename)

- [x] Expose `preview_organize` (dry-run) to Frontend

- [x] Expose `run_organize` (execute) with progress event emission

- [ ] *(In Progress)* Remove phockup shell capabilities (Still in `shell.json`)

- [ ] Integrate `preview_organize` into Ingest UI



#### 2.6 Performance & Scalability (Completed)

- [x] **Daemon Integration**: Updated `Organizer` and `unified_ingest` to use `SharedExifToolDaemon`. Metadata extraction now benefits from the persistent process.

- [x] **Batch Tagging**: Implemented batch tagging in `unified_ingest` and `apply_tags_to_directory` to minimize process spawns.

- [x] **Parallelism**: Integrated `rayon` for parallel file hashing in the unified ingest pipeline.

- [x] **Unified Ingest**: Fully implemented `run_unified_ingest` with progress reporting and cancellation support.

### Phase 3: The Ingest UI (In Progress)
1.  **Source Selector**: Enhance "Import" tab to select source.
2.  **Preview State**: [x] Integrated `preview_organize` into backend logic.
3.  **Progress UI**: [x] Backend emits `organize-progress` and `scan-progress` events.

### Phase 4: Immich Integration
1.  **Binary Management**: [x] Integrated `immich-go` into binary discovery system.
2.  **Command Wrapper**: Implement `run_immich_go` command in Rust.
3.  **Sync UI**: connect "Sync" button to Rust command.

### Phase 5: Polish & Distribution
1.  **Error Handling**: [x] Added robust error cases and tests for all backend modules.
2.  **Bundling**: Configure `tauri.conf.json` to include `exiftool` and `immich-go`.
3.  **CI/CD**: [x] Added automated coverage reporting with `cargo-llvm-cov`.

### Phase 6: UI Redesign (Liquid Glass)
... (Phase 6 remains same) ...

### Phase 7: Testing & Quality (Updated)
1.  **Frontend Gaps (Focus on Logic) (Completed)**:
    -   [x] **Ingest.tsx & Clean.tsx**: Added comprehensive tests for unified ingest, metadata fixing, and duplicate deletion.
    -   [x] **Settings.tsx**: Added tests for theme switching, connection testing, and custom binary paths.
2.  **UI Component Testing (Completed)**:
    -   [x] Added unit tests for `Button`, `Card`, and `Input` to ensure they handle props correctly.
3.  **Backend (Rust) Logic Expansion (Completed)**:
    -   **Status**: ~65% coverage. Logic is decoupled from Tauri commands for unit testing.
    -   [x] Implement integration tests for `run_unified_ingest` using `tempfile` to verify end-to-end flow.
    -   [x] Cover `organize.rs` branching (collisions, duplicates, path resolution).
    -   [x] Cover `dedup.rs` parsing logic and trash integration.
    -   [x] Mock `exiftool` process to test daemon error recovery and metadata parsing.
    -   [x] Test binary path resolution across platforms in `binaries.rs`.
    -   [x] Unit test `AppState` and cancellation logic.
4.  **Infrastructure (Completed)**:
    -   [x] CI Coverage enforcement (Frontend + Rust).
    -   [x] Automated `cargo-llvm-cov` integration in GitHub Actions.
    -   [x] Sidecar binary caching and repository inclusion for Linux/macOS.

