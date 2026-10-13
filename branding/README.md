# Application icons

`app-icon-master.png` is the canonical 1024 × 1024 transparent application icon.
It preserves the dog artwork from the former macOS iconset. Keep this source
image when updating the generated icons.

After installing dependencies with `npm ci`, regenerate desktop icons from the
repository root:

```sh
npm run generate:icons
```

The script uses the Tauri CLI version pinned in `package-lock.json`. It generates
icons in a temporary workspace directory, copies only the following desktop
outputs to `src-tauri/icons/`, and removes the temporary files:

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.ico` (Windows)
- `icon.icns` (macOS)

These outputs are configured in `src-tauri/tauri.conf.json` and committed so
normal builds do not require icon generation. Review their appearance before
committing regenerated icons. Android/iOS exports and intermediate `.iconset`
directories are not maintained for this desktop application.

The interface logos in `src/assets/` and `public/logo.png` have separate uses;
this command does not modify them.
