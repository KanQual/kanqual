# PostgreSQL Runtime Sources

Platform-specific PostgreSQL 17 runtime folders go here before packaging.
KanQual currently fetches PostgreSQL 17.10 runtime archives from
[`theseus-rs/postgresql-binaries`](https://github.com/theseus-rs/postgresql-binaries)
using the pinned manifest in `scripts/bundled-postgres-runtimes.json`.

Expected layout:

```text
postgres-runtimes/
  postgresql-17/
    windows-x86_64/
      bin/
      lib/
      share/
    macos-aarch64/
      bin/
      lib/
      share/
    macos-x86_64/
      bin/
      lib/
      share/
    linux-x86_64/
      bin/
      lib/
      share/
```

The staging script copies only the current target into `src-tauri/resources/runtime/postgresql-17/`, so final installers include one platform runtime instead of every platform runtime.

Runtime payloads are intentionally ignored by Git. Use the pinned manifest and fetch script to restore the current platform payload before strict staging:

```sh
npm run fetch:bundled-postgres
npm run prepare:bundled-postgres:strict
```

GitHub Actions runs the same fetch step for each release matrix target before packaging.
