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



#### 2.6 Performance & Scalability (New)

- [ ] **Daemon Integration**: Update `Organizer` in `organize.rs` to use `SharedExifToolDaemon`. Currently, organization extraction spawns a process per file.

- [ ] **Batch Tagging**: Replace sequential frontend-to-backend tagging loops with a single backend command. Use ExifTool's `-@` (argfile) mode for mass updates.

- [ ] **Parallelism**: Use `rayon` to parallelize file hashing and metadata scanning.

- [ ] **Unified Ingest**: Implement a single `run_unified_ingest` command to handle the "Stage -> Tag -> Organize" pipeline entirely on the backend to minimize IPC overhead.



### Phase 3: The Ingest UI
1.  **Source Selector**: Enhance "Import" tab to select source.
2.  **Preview State**: Display "Scanning..." -> "Found 50 files (10 duplicates)".
3.  **Progress UI**: Connect to Rust events (`scan-progress`, `import-progress`).

### Phase 4: Immich Integration
1.  **Binary Management**: Ensure `immich-go` is accessible.
2.  **Command Wrapper**: Implement `run_immich_go` command in Rust.
3.  **Sync UI**: connect "Sync" button to Rust command.

### Phase 5: Polish & Distribution
1.  **Error Handling**: Graceful failures for locked files or permissions.
2.  **Bundling**: Configure `tauri.conf.json` to include `exiftool` and `immich-go`.
3.  **CI/CD**: Github Actions for multi-platform build.

### Phase 6: UI Redesign (Liquid Glass)
1.  **Design System Foundation**:
    -   [ ] Define "Tahoe" color palette (San Francisco Blue, Glass backgrounds) in `tailwind.config.js`.
    -   [ ] Configure typography (Inter or System Fonts).
    -   [ ] Create reusable "Glass" utility classes (backdrop-blur, subtle borders).
2.  **Layout Overhaul**:
    -   [ ] Implement Mac-style Sidebar (translucent, collapsible/resizable if needed).
    -   [ ] Create Main Content Area with "Card" metaphors.
3.  **Component Library**:
    -   [ ] **Buttons**: "Liquid" gradients, distinct primary/secondary styles.
    -   [ ] **Inputs**: Rounded corners, focus rings matching the theme.
    -   [ ] **Feedback**: Toast notifications with glass effect.
4.  **Dark Mode**:
    -   [ ] Ensure full `dark:` variant support for all components.
    -   [ ] Verify contrast ratios.

## Accessibility & Contrast Audit (Tahoe Design System)

### Identified Issues

#### 1. Text Contrast Failures (Light Mode)
*   **Muted Text (`--color-text-muted`)**: Currently uses Neutral 500 (#6B7280) on white/light backgrounds. Contrast ratio is ~3.9:1, failing the 4.5:1 requirement for normal text.
*   **Tertiary Text (`--color-text-tertiary`)**: Currently uses Neutral 400 (#9CA3AF). Contrast ratio is ~2.1:1, significant failure.
*   **Workflow Step Labels**: "STEP 1", "STEP 2" labels use light tinted colors (e.g., `text-purple-400`) on tinted backgrounds, resulting in poor legibility.
*   **Empty State Text**: "No recent activity" is too faint.

#### 2. Visual Hierarchy Issues (Dark Mode)
*   **Section Headers**: Headings like "RECENT ACTIVITY" use very dark gray on a dark background.
*   **Tertiary Text**: Contrast is too low for helper text and metadata.

### Proposed Fixes

#### [index.css](file:///Users/jehangir/dev/tasaveer/src/index.css) adjustments:
*   [ ] **Light Mode**: Increase contrast for `text-muted` and `text-tertiary`.
    *   Change `--color-text-muted` to Neutral 600 (#4B5563) or 700.
    *   Change `--color-text-tertiary` to Neutral 500 (#6B7280).
*   [ ] **Dark Mode**: Increase visibility of tertiary elements.
    *   Change `--color-text-tertiary` to Neutral 400 (#9CA3AF).

#### Component-specific adjustments:
*   [ ] **Workflow Cards**: Use a bolder weight or darker shade for "STEP X" labels.
*   [ ] **Sidebar**: Ensure section headers meet 3:1 contrast for non-text UI elements.

### Phase 7: Testing & Quality
1.  **Frontend Gaps (Focus on Logic)**:
    -   [ ] **Ingest.tsx & Clean.tsx**: Test edge cases for unified ingest (cancellation, error states).
    -   [ ] **Ingest.tsx**: Test metadata tagging logic (especially the new batch tagging).
2.  **UI Component Testing (Completed)**:
    -   [x] Added unit tests for `Button`, `Card`, and `Input` to ensure they handle props correctly.
3.  **Backend (Rust) Logic Expansion**:
    -   [ ] Integration tests for `run_unified_ingest` using mock file system.
    -   [ ] Test ExifTool daemon error recovery.
4.  **Infrastructure**:
    -   [ ] CI Coverage enforcement.

