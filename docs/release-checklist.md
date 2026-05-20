# Cross-Platform Release Checklist

This checklist covers the release path for Windows, macOS, and Linux builds of Kanqual.

## Before Tagging

- Confirm the intended version is aligned in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Confirm platform sidecars are present under `src-tauri/binaries/local`.
- Review the changelog or release notes summary for the release.
- Confirm CI is green on the default branch.

## Sidecars

- Windows sidecar present:
  `pocketbase-x86_64-pc-windows-msvc.exe`
- macOS sidecar present:
  `pocketbase-x86_64-apple-darwin` and/or `pocketbase-aarch64-apple-darwin`
- Linux sidecar present:
  `pocketbase-x86_64-unknown-linux-gnu` and/or `pocketbase-aarch64-unknown-linux-gnu`
- Verify `src-tauri/build.rs` resolves the correct sidecar name for each packaged target.

## Signing And Platform Trust

- Windows signing certificate configured and tested.
- macOS certificate, signing identity, and notarization credentials configured and tested.
- Linux artifact trust model decided and documented.
- Tauri signing key configured if updater or signed release metadata is introduced later.

## Packaged App Smoke Tests

- Windows:
  installer launches
- Windows:
  portable build launches and keeps data in the portable directory when `portable-mode.json` is present
- macOS:
  packaged app launches outside dev mode
- Linux:
  packaged app launches outside dev mode
- All platforms:
  splash screen closes and the main window appears
- All platforms:
  PocketBase sidecar starts successfully
- All platforms:
  sign-in or first-run registration succeeds
- All platforms:
  create project and open project succeed
- All platforms:
  app shutdown cleanly stops the PocketBase sidecar
- GitHub Actions release workflow runs the deeper packaged runtime smoke flow on every platform:
  Windows via the packaged release executable, macOS via the `.app` bundle executable, and Linux via the `AppImage` under `xvfb-run`
- Runtime smoke timeouts are intentionally longer than the artifact smoke checks to allow first-run PocketBase setup and WebView cold start on CI runners

## Artifact Review

- Windows artifacts generated and named consistently.
- macOS artifacts generated and named consistently.
- Linux artifacts generated and named consistently.
- SHA256 checksum files generated for each platform.
- Release artifacts attached to the GitHub release draft.

## Release Notes

- Call out supported platforms for this release.
- Note any platform-specific caveats such as portable mode limitations or notarization expectations.
- Include upgrade notes if database, backup, or AI features changed.

## After Publishing

- Download one artifact per platform and verify the checksum manually.
- Confirm the GitHub release page presents the intended artifact names and notes.
- Record any known issues discovered after packaging in the next release planning pass.
