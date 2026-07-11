# Bug Fixes

## 2026-02-14: Fix Unused Import in Ingest Test

**Issue:** `npm run tauri build` failed with `TS6133: 'within' is declared but its value is never read` in `src/pages/__tests__/Ingest.test.tsx`.

**Fix:** Removed the unused `within` import from `src/pages/__tests__/Ingest.test.tsx`.

**Verification:** Ran `npm run tauri build` (backend compiled, frontend built) and `npm test` (all tests passed).
