PocketBase sidecars for packaged builds live in `src-tauri/binaries/local`.

Expected filenames:

- `pocketbase-x86_64-pc-windows-msvc.exe`
- `pocketbase-x86_64-unknown-linux-gnu`
- `pocketbase-aarch64-unknown-linux-gnu`
- `pocketbase-x86_64-apple-darwin`
- `pocketbase-aarch64-apple-darwin`

Tauri resolves these automatically from `externalBin` in `tauri.conf.json` when the current build target matches the filename suffix.

To prepare a sidecar file from a downloaded PocketBase binary:

```bash
node scripts/prepare-pocketbase-sidecar.mjs --source /path/to/pocketbase --target x86_64-unknown-linux-gnu
```

Examples:

- Linux Intel: `x86_64-unknown-linux-gnu`
- Linux ARM64: `aarch64-unknown-linux-gnu`
- macOS Intel: `x86_64-apple-darwin`
- macOS Apple Silicon: `aarch64-apple-darwin`
- Windows x64: `x86_64-pc-windows-msvc`

Notes:

- Linux and macOS builds should be produced on those platforms, or via a properly configured cross-compilation CI setup.
- During build, `src-tauri/build.rs` will copy the platform-specific sidecar into `src-tauri/binaries/local/pocketbase` (or `pocketbase.exe` on Windows) so the app can resolve the correct executable for the current OS.
- If the matching sidecar is missing, local-mode startup and app packaging will warn or fail with a platform-specific message.
