---
trigger: manual
---

# Tasaveer Project Architecture Guide

This document defines architectural patterns and context specific to the **Tasaveer** project. Follow these rules when making changes or suggesting new features.

---

> Canonical agent guidance now lives in [AGENTS.md](../../../AGENTS.md); current status and the next-feature spec are in [docs/HANDOFF.md](../../../docs/HANDOFF.md). This file is a thin architecture reminder.

## 🏗️ Core Philosophy

-   **File System as Source of Truth**: The archive on disk (and the EXIF metadata embedded in each file) is authoritative.
-   **Auxiliary catalog, not authoritative**: an import catalog (SQLite, `src-tauri/src/catalog.rs`) indexes files by content hash for cross-session dedup and backup tracking. It is a rebuildable convenience — never the source of truth for media.
-   **Native Capabilities**: Use Rust for heavy file operations, hashing, metadata extraction (`exiftool`), and process orchestration. Use the React frontend for UI and state.

---