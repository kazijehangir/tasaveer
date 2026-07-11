# Bundled Binaries

This directory contains platform-specific binaries that are bundled with Tasaveer.

## Upstream Repositories

| Tool | Repository | Description |
|------|-----------|-------------|
| **immich-go** | [simulot/immich-go](https://github.com/simulot/immich-go) | CLI tool for uploading to Immich and extracting Google Photos/iCloud takeouts |
| **ExifTool** | [exiftool.org](https://exiftool.org/) | EXIF metadata read/write (date extraction, tagging). Runs in persistent `-stay_open` mode. |

> Note: media organization is done natively in Rust (`src-tauri/src/organize.rs`); the old `phockup` dependency has been removed.

## Downloading Binaries

Run the download script from the project root:

```bash
npm run download-deps
```

This will fetch the latest releases for your current platform.

## Target Triples

Binaries must be named with Rust target triples for Tauri's sidecar system:

| Platform | Target Triple | immich-go Binary | ExifTool Binary |
|----------|--------------|------------------|-----------------|
| Windows x64 | `x86_64-pc-windows-msvc` | `immich-go-x86_64-pc-windows-msvc.exe` | `exiftool-x86_64-pc-windows-msvc.exe` |
| macOS Intel | `x86_64-apple-darwin` | `immich-go-x86_64-apple-darwin` | `exiftool-x86_64-apple-darwin` |
| macOS Apple Silicon | `aarch64-apple-darwin` | `immich-go-aarch64-apple-darwin` | `exiftool-aarch64-apple-darwin` |
| Linux x64 | `x86_64-unknown-linux-gnu` | `immich-go-x86_64-unknown-linux-gnu` | `exiftool-x86_64-unknown-linux-gnu` |

## License Notes

- **immich-go**: MIT License - safe to bundle
- **ExifTool**: GPL License - bundling may have license implications

