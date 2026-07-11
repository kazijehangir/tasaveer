# Tasaveer

<!-- markdownlint-disable -->
<img align="left" width="80" height="80" hspace="20" src="public/app-icon.png">

Tasaveer (/t̪ə.sɑː.ˈʋiːɾ/, Urdu: تصاویر, lit. 'photographs') is a desktop app for importing photos and videos from cameras, SD cards, and Takeout exports into a clean, deduplicated, date-organized local archive — and keeping that archive backed up and shareable.

[![Tests](https://github.com/kazijehangir/tasaveer/actions/workflows/test.yml/badge.svg)](https://github.com/kazijehangir/tasaveer/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/kazijehangir/tasaveer/graph/badge.svg?token=CODECOV_TOKEN)](https://codecov.io/gh/kazijehangir/tasaveer)

<br clear="left"/>

## What it does

Tasaveer is built around the pipeline **SD card → local archive (for editing) → Google Drive (backup) → Immich / Google Photos (sharing)**. It's a Tauri app: a Rust backend does the heavy file work, a React frontend drives it.

- **Ingest & organize** — Copy or move media from a folder (SD card / Takeout support in progress) into a `YYYY/YYYY-MM-DD` archive. Dates come from EXIF (`DateTimeOriginal`, falling back to `CreateDate` for videos) via a persistent ExifTool daemon, or from the filename. Copies are hash-verified.
- **Deduplication that survives cleanup** — An import catalog (local SQLite) records every file ever imported by content hash, so re-importing the same card doesn't re-copy files even after you've cleared your working folder. Exact duplicates are skipped; a source is only ever deleted after a full-file hash match.
- **Smart tagging** — Auto-tag files by camera model or source directory during ingest (written as EXIF keywords).
- **Clean & dedup** — Visual interface over [`czkawka`](https://github.com/qarmin/czkawka) to find duplicate and visually-similar images; deletions go to the Trash.
- **Safe by default** — Every long operation is cancellable and shows live progress; running operations survive navigating between tabs.

The archive on disk is always the source of truth; the catalog is an auxiliary index that can be rebuilt.

## Status & roadmap

**Working today:** Ingest (copy/move, organize, verified copies, tagging), cross-session dedup via the import catalog, Clean & Dedup, and a catalog inspector in Settings.

**In progress / planned** (see [`docs/HANDOFF.md`](docs/HANDOFF.md) and [`docs/sd-card-import-plan.md`](docs/sd-card-import-plan.md) for detail):

- **Backup reconciliation** — figure out which local files are safely on Google Drive (without downloading anything), back up the ones that aren't, and reclaim local space by trashing confirmed-backed-up copies. *Next up.*
- **Google Drive backup sync** — mirror new imports into a Drive folder and track backup status per file.
- **SD card source** — detect a mounted card and import straight from `DCIM`, with eject-after-import.
- **Sync to Immich** — wire the (currently stub) Sync screen to the bundled `immich-go`.

## Install & prerequisites

### Bundled dependencies
**immich-go**, **ExifTool**, and **czkawka_cli** all ship bundled directly with Tasaveer — no separate installation or system prerequisites are needed!

| Tool | Bundled | Repository |
| --- | --- | --- |
| immich-go | ✅ | [simulot/immich-go](https://github.com/simulot/immich-go) |
| ExifTool | ✅ | [exiftool.org](https://exiftool.org/) |
| czkawka | ✅ | [qarmin/czkawka](https://github.com/qarmin/czkawka) |

## Development

Tauri v2 + React + TypeScript + Vite. See [`AGENTS.md`](AGENTS.md) for architecture and conventions.

**Recommended setup:** [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer). On Windows, install Rust via `rustup` and the "Desktop development with C++" build tools.

```bash
npm install
npm run tauri dev          # run the app

npm test                   # frontend tests (watch)
npm run test:coverage      # frontend tests + coverage
npx tsc --noEmit           # type check

cargo test --manifest-path src-tauri/Cargo.toml --lib   # Rust tests
```
