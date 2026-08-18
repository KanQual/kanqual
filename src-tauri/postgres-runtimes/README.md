# PostgreSQL Runtime Sources

Platform-specific PostgreSQL 17 runtime folders go here before packaging.

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
