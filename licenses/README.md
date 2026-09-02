# Third-Party License Texts

This folder contains license texts for the main third-party license families and
bundled components used in KanQual releases.

It is intended to ship alongside the application and the
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) inventory.

## Included files

- `APACHE-2.0.txt`
  Covers KanQual itself and many bundled code dependencies that are licensed
  under Apache 2.0 or dual Apache 2.0 / MIT terms.
- `BSD-3-Clause.txt`
  Generic BSD 3-Clause license text used by JavaScript and Rust dependencies.
- `0BSD.txt`
  Generic Zero-Clause BSD license text used by JavaScript dependencies.
- `MIT.txt`
  Generic MIT license text used by many JavaScript, Rust, and bundled
  components.
- `ISC.txt`
  Generic ISC license text used by JavaScript and Rust dependencies.
- `ECHARTS-D3-BSD-3-Clause.txt`
  Apache ECharts subcomponent notice and d3.js BSD 3-Clause license text.
- `POSTGRESQL.txt`
  PostgreSQL license text for the bundled PostgreSQL runtime payloads. KanQual
  currently fetches compact PostgreSQL runtime archives from the
  `theseus-rs/postgresql-binaries` release artifacts during packaging.
- `SIL-OFL-1.1.txt`
  License text for the bundled Inter font assets.
- `UBUNTU-FONT-LICENCE-1.0.txt`
  License text for the bundled Ubuntu font assets.

## Notes

- The per-package inventory remains in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- When a dependency is dual licensed, this folder includes the common license
  texts rather than one file per package.
- If future releases add new bundled binaries or assets with different license
  families, add their texts here as well.
