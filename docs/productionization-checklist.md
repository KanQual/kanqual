# Productionization Checklist

This checklist tracks the work needed to take Kanqual from active development toward a repeatable, supportable release process.

## Completed in this slice

- Added a baseline GitHub Actions CI workflow for Windows that runs dependency install, frontend production build, and native Rust tests.
- Moved inline startup theme bootstrapping into an external script so the main app can run under a stricter CSP.
- Moved splash screen styling into an external stylesheet so the splash page no longer requires inline styles.
- Added a non-null default Tauri CSP in the desktop config.
- Removed unused shell permissions from the default Tauri window capability.
- Added a cross-platform release workflow skeleton for Windows, macOS, and Linux packaging.
- Added an in-repo cross-platform release checklist covering sidecars, signing, smoke tests, and artifact review.

## Release Engineering

- Add branch protection that requires the CI workflow to pass before merge.
- Connect the release workflow to real signing and notarization secrets and verify each platform path end-to-end.
- Decide whether packaged-build smoke tests should run on every pull request or only on release branches.
- Add a versioning and release-notes process so app version, installer artifacts, and changelog stay aligned.
- Turn the existing role-matrix validation into a guaranteed CI check once `role_permission_matrix_recommended.csv` is committed or generated in CI.
- Decide which macOS architectures and Linux package targets are officially supported in the first public release.

## Security Hardening

- Verify the new CSP against all app flows, especially PDF viewing, AI export flows, remote PocketBase connections, and LAN-hosted sessions.
- Review every `dangerouslySetInnerHTML` usage and document the sanitization guarantees for stored rich text.
- Audit filesystem permissions to confirm the app only has the minimum Tauri plugin access it needs.
- Reduce `expect` and `unwrap` usage in the Rust layer where a recoverable error can be surfaced to the user instead of crashing.
- Document the threat model for bundled PocketBase, LAN mode, portable mode, and local AI integrations.

## Quality Gates

- Add frontend linting and enforce it in CI.
- Add targeted tests for backup/restore, import/export, first-run setup, and authentication edge cases.
- Add packaged-app smoke tests for local PocketBase startup and shutdown.
- Capture and track bundle-size regressions so the main renderer bundle does not continue to grow silently.

## Performance

- Split large views with lazy loading so the main renderer bundle is smaller and startup becomes cheaper.
- Profile the largest routes, especially reports and AI views, to identify high-cost imports that can be deferred.
- Decide whether `pdfjs` and export libraries should be loaded on demand rather than in the main application chunk.

## Operations And Support

- Add structured local logging plus an exportable diagnostics bundle for support cases.
- Define backup retention, restore validation, and recovery guidance for users before wider release.
- Add a clear compatibility matrix for Windows, macOS, Linux, PocketBase sidecars, and optional AI runtimes.
- Document a support playbook for common failures such as sidecar startup problems, port conflicts, and model download interruptions.
