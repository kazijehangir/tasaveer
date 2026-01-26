---
trigger: manual
---

# Tasaveer Project Architecture Guide

This document defines architectural patterns and context specific to the **Tasaveer** project. Follow these rules when making changes or suggesting new features.

---

## 🏗️ Core Philosophy

-   **File System as Source of Truth**: Tasaveer is a local media manager. We do **not** maintain a central database for media indexing. Metadata is read from and written directly to files or sidecars.
-   **Native Capabilities**: Use Rust for heavy file operations, metadata extraction (`exiftool`), and process orchestration. Use the React frontend for UI and state management.

---