---
trigger: manual
---

# Tasaveer Project Style Guide

This document defines concrete coding decisions and context specific to the **Tasaveer** project. Follow these rules when making changes or suggesting new features.

---

## 🎨 Frontend & Design (Tahoe System)

Tasaveer uses the **"Tahoe"** design system, characterized by a "Liquid Glass" aesthetic inspired by modern macOS.

-   **Tailwind v4 & CSS Variables**:
    -   Do **not** use ad-hoc hex codes. Use semantic tokens defined in `src/index.css` (e.g., `var(--color-primary-500)`, `var(--color-surface-elevated)`).
    -   Support full **Dark Mode** using the `.dark` class and `dark:` Tailwind variants.
-   **Aesthetics**:
    -   **Glassmorphism**: Use the `.glass-card` and `.glass-card-hover` classes for containers.
    -   **Typography**: Use the system font stack (Inter / San Francisco).
    -   **Icons**: Use `Lucide-React`.
-   **Layout**:
    -   Main navigation should stay in the `Sidebar.tsx`.
    -   The main content area is managed by `AppLayout.tsx`.

---

## ⚙️ Backend (Rust / Tauri v2)

-   **Command Delegation**:
    -   Keep `src-tauri/src/lib.rs` as the orchestration layer. Delegate logic to specialized modules: `binaries`, `metadata`, `organize`, `dedup`.
-   **Operation Management**:
    -   Use the `AppState` struct (see `state.rs`) to manage long-running tasks.
    -   Every long-running operation must be cancellable via `cancel_operation`.
-   **Binary Handling**:
    -   External tools (`exiftool`, `immich-go`, `czkawka`) must be handled via `src-tauri/src/binaries.rs`.
    -   Use `discover_binary()` to resolve paths, prioritizing bundled sidecars.
-   **MacOS Environment**:
    -   On macOS, always call `fix_path_env()` in the Tauri run loop to ensure $PATH consistency for spawned processes.

---

## 📁 State Management

-   **Server State**: Use **TanStack Query** (React Query) for all Tauri command invocations that fetch or mutate data.
-   **Local UI State**: Use **Zustand** for global UI state (e.g., settings, navigation flags).
-   **Persistent State**: Use `tauri-plugin-store` for user settings that must persist across app restarts.

---

## 🧪 Testing Conventions

-   **Frontend**: Place tests in a `__tests__` directory adjacent to the component/page being tested. Use `vitest` and `react-testing-library`.
-   **Backend**: Use standard Rust `#[cfg(test)]` modules within the respective source files for unit tests. Use `tempfile` for file system tests.

---

## 🛠️ Performance

-   **ExifTool Optimization**: Always use the persistent `-stay_open` mode via `ExifToolDaemon` for batch metadata operations to avoid process spawning overhead.
