# 🗺️ Tasaveer Roadmap

This roadmap outlines the planned evolution of Tasaveer, categorized into implementation phases. 

> [!NOTE]
> This is a living document and priorities may shift based on user feedback and project needs.

---

## 🚀 Phase 1: Stabilization & Core Refinement (Short-term)
Focus on making the current features rock-solid and polished.

### ✨ Features
- **Smart Tagging Suggestions**: Automatically suggest tags based on directory names or GPS metadata.
- **Improved Log Viewer**: A dedicated, searchable history of all operations with error filtering.

### 🐛 Bug Fixes & Stability
- **Cross-Platform Pathing**: Fix potential issues with Windows paths in the Rust/React bridge.

### 🧪 Testing & Quality
- **E2E Testing**: Implement Playwright or custom Tauri E2E tests for the full "Ingest" and "Clean" workflows.

### 🧹 Tech Debt
- **Standardized Error Handling**: Implement a unified error reporting system in the UI.

---

## 🏔️ Phase 2: Advanced Media Management (Mid-term)
Expanding capabilities beyond basic organization and cleaning.

### ✨ Features
- **Immich Deep Integration**: 
    - Full GUI for `immich-go` operations.
    - Sync status monitoring directly in Tasaveer.
    - Automatic library scan triggers after sync.
- **AI-Powered Deduplication**: Integrate more advanced similarity checks (beyond `czkawka`).
- **Bulk Metadata Editing**: Ability to manually edit dates, locations, and descriptions for groups of photos.
- **Map View**: Visualize the archive on a map based on GPS metadata.

### 🧪 Testing & Quality
- **Regression Suite**: Automated tests for common edge cases (e.g., corrupt files, missing EXIF, full disks).
- **Security Audit**: Ensure bundled binaries are handled securely and API keys are stored safely.

---

## 🌌 Phase 3: Ecosystem & integration (Long-term)
Tasaveer as the central hub for local media.

### ✨ Features
- **Plugin System**: Allow users to write custom Rust or JS plugins for specific organization logic.
- **Mobile Companion**: A lightweight app to trigger ingestion from mobile devices to the master archive.
- **Multi-Server Sync**: Support for syncing to multiple Immich instances or other self-hosted solutions (e.g., PhotoPrism).
- **Archive Health Dashboard**: Statistics and visualizations of your local media archive over time.

---

## ✅ Completed Milestones
- [x] **Tauri v2 Foundation**: Native cross-platform core.
- [x] **Modular Backend Architecture**: Refactored core logic into testable, decoupled Rust modules.
- [x] **ExifTool Stay-Open Integration**: Shared daemon for high-performance metadata operations.
- [x] **Comprehensive Testing**: ~65% backend coverage and ~80% frontend coverage.
- [x] **Dual-Mode UI**: Full "Tahoe" Liquid Glass design system.
- [x] **Unified Ingest Logic**: End-to-end "Stage -> Tag -> Organize" pipeline with parallel processing.
- [x] **Czkawka Integration**: Duplicate and similar image scanning.
- [x] **CI/CD Pipeline**: Automated testing, linting, and coverage reporting on every PR.
