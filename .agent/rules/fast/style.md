---
trigger: always_on
---

# Tasaveer style & conventions

The canonical, up-to-date coding conventions live in **[AGENTS.md](../../../AGENTS.md)** (single source of truth), with current project status and the next-feature spec in **[docs/HANDOFF.md](../../../docs/HANDOFF.md)**. Read AGENTS.md before making changes.

Quick reminders:

- Frontend state is raw `invoke` + **zustand** (no TanStack Query); persistent settings via `tauri-plugin-store`. Operation state that must survive navigation goes in a module-level store (see `src/store/ingestStore.ts`).
- Use semantic Tailwind tokens from `src/index.css` (`text-text-main`, `bg-surface-secondary`, `.glass-card`), support `dark:`, icons from `lucide-react`.
- Rust: delegate from `lib.rs` to modules; make long ops cancellable; batch EXIF via the stay-open daemon; deletions of user media go to Trash.
- Run all tests after changes (`npx vitest run`, `npx tsc --noEmit`, `cargo test --lib`).
