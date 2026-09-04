# Third-Party Notices

This file inventories the third-party software dependencies and bundled third-party components currently used by KanQual.

KanQual itself is licensed under `Apache-2.0`. See [LICENSE](./LICENSE) and [LICENSES.md](./LICENSES.md).

This inventory is generated from:

- `package-lock.json` for resolved JavaScript / TypeScript dependencies
- `cargo metadata --locked` for resolved Rust crates

Generation details:

- Generated at: `2026-09-01T15:36:11.492Z`
- JavaScript scope: `runtime dependencies only`
- Rust scope: `runtime dependency graph only`

## Bundled Third-Party Components

PostgreSQL is redistributed as a bundled runtime. KanQual fetches the platform-specific PostgreSQL runtime archives from the `theseus-rs/postgresql-binaries` release artifacts during packaging.

The corresponding license text files included with KanQual releases are kept in the [licenses](./licenses/) folder.

| Component | Where Bundled | Upstream | License |
| --- | --- | --- | --- |
| `PostgreSQL runtime binaries` | `src-tauri/resources/runtime/postgresql-17/` | `https://github.com/theseus-rs/postgresql-binaries` | `PostgreSQL License` |

## Resolved JavaScript / TypeScript Dependency Inventory

| Package | Version | License |
| --- | --- | --- |
| `@babel/runtime` | `7.29.2` | `MIT` |
| `@floating-ui/core` | `1.7.5` | `MIT` |
| `@floating-ui/dom` | `1.7.6` | `MIT` |
| `@floating-ui/utils` | `0.2.11` | `MIT` |
| `@fontsource/inter` | `5.2.8` | `OFL-1.1` |
| `@fontsource/noto-sans` | `5.2.10` | `OFL-1.1` |
| `@fontsource/noto-sans-mono` | `5.2.10` | `OFL-1.1` |
| `@fontsource/ubuntu` | `5.2.8` | `UFL-1.0` |
| `@formatjs/fast-memoize` | `3.1.6` | `MIT` |
| `@formatjs/icu-messageformat-parser` | `3.5.11` | `MIT` |
| `@formatjs/icu-skeleton-parser` | `2.1.10` | `MIT` |
| `@napi-rs/canvas` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-android-arm64` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-darwin-arm64` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-darwin-x64` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-linux-arm-gnueabihf` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-linux-arm64-gnu` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-linux-arm64-musl` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-linux-riscv64-gnu` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-linux-x64-gnu` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-linux-x64-musl` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-win32-arm64-msvc` | `1.0.8` | `MIT` |
| `@napi-rs/canvas-win32-x64-msvc` | `1.0.8` | `MIT` |
| `@tauri-apps/api` | `2.10.1` | `Apache-2.0 OR MIT` |
| `@tauri-apps/plugin-dialog` | `2.7.0` | `MIT OR Apache-2.0` |
| `@tauri-apps/plugin-fs` | `2.5.0` | `MIT OR Apache-2.0` |
| `@tauri-apps/plugin-opener` | `2.5.3` | `MIT OR Apache-2.0` |
| `@tiptap/core` | `3.22.4` | `MIT` |
| `@tiptap/extension-blockquote` | `3.22.4` | `MIT` |
| `@tiptap/extension-bold` | `3.22.4` | `MIT` |
| `@tiptap/extension-bubble-menu` | `3.22.4` | `MIT` |
| `@tiptap/extension-bullet-list` | `3.22.4` | `MIT` |
| `@tiptap/extension-code` | `3.22.4` | `MIT` |
| `@tiptap/extension-code-block` | `3.22.4` | `MIT` |
| `@tiptap/extension-color` | `3.22.4` | `MIT` |
| `@tiptap/extension-document` | `3.22.4` | `MIT` |
| `@tiptap/extension-dropcursor` | `3.22.4` | `MIT` |
| `@tiptap/extension-floating-menu` | `3.22.4` | `MIT` |
| `@tiptap/extension-gapcursor` | `3.22.4` | `MIT` |
| `@tiptap/extension-hard-break` | `3.22.4` | `MIT` |
| `@tiptap/extension-heading` | `3.22.4` | `MIT` |
| `@tiptap/extension-horizontal-rule` | `3.22.4` | `MIT` |
| `@tiptap/extension-italic` | `3.22.4` | `MIT` |
| `@tiptap/extension-link` | `3.22.4` | `MIT` |
| `@tiptap/extension-list` | `3.22.4` | `MIT` |
| `@tiptap/extension-list-item` | `3.22.4` | `MIT` |
| `@tiptap/extension-list-keymap` | `3.22.4` | `MIT` |
| `@tiptap/extension-ordered-list` | `3.22.4` | `MIT` |
| `@tiptap/extension-paragraph` | `3.22.4` | `MIT` |
| `@tiptap/extension-strike` | `3.22.4` | `MIT` |
| `@tiptap/extension-text` | `3.22.4` | `MIT` |
| `@tiptap/extension-text-align` | `3.22.4` | `MIT` |
| `@tiptap/extension-text-style` | `3.22.4` | `MIT` |
| `@tiptap/extension-underline` | `3.22.4` | `MIT` |
| `@tiptap/extensions` | `3.22.4` | `MIT` |
| `@tiptap/pm` | `3.22.4` | `MIT` |
| `@tiptap/react` | `3.22.4` | `MIT` |
| `@tiptap/starter-kit` | `3.22.4` | `MIT` |
| `@types/node` | `25.6.0` | `MIT` |
| `@types/pako` | `2.0.4` | `MIT` |
| `@types/raf` | `3.4.3` | `MIT` |
| `@types/trusted-types` | `2.0.7` | `MIT` |
| `@types/use-sync-external-store` | `0.0.6` | `MIT` |
| `@xmldom/xmldom` | `0.9.10` | `MIT` |
| `abort-controller` | `3.0.0` | `MIT` |
| `archiver-node` | `8.0.8` | `MIT` |
| `async` | `3.2.6` | `MIT` |
| `b4a` | `1.8.1` | `Apache-2.0` |
| `balanced-match` | `4.0.4` | `MIT` |
| `bare-events` | `2.9.1` | `Apache-2.0` |
| `bare-fs` | `4.7.2` | `Apache-2.0` |
| `bare-os` | `3.9.1` | `Apache-2.0` |
| `bare-path` | `3.0.1` | `Apache-2.0` |
| `bare-stream` | `2.13.1` | `Apache-2.0` |
| `bare-url` | `2.4.5` | `Apache-2.0` |
| `base64-arraybuffer` | `1.0.2` | `MIT` |
| `base64-js` | `1.5.1` | `MIT` |
| `bluebird` | `3.7.2` | `MIT` |
| `brace-expansion` | `5.0.9` | `MIT` |
| `buffer` | `6.0.3` | `MIT` |
| `buffer-crc32` | `1.0.0` | `MIT` |
| `canvg` | `3.0.11` | `MIT` |
| `ce-la-react` | `0.3.2` | `BSD-3-Clause` |
| `compress-commons` | `7.0.1` | `MIT` |
| `core-js` | `3.49.0` | `MIT` |
| `core-util-is` | `1.0.3` | `MIT` |
| `crc-32` | `1.2.2` | `Apache-2.0` |
| `crc32-stream` | `7.0.1` | `MIT` |
| `css-line-break` | `2.1.0` | `MIT` |
| `cssesc` | `3.0.0` | `MIT` |
| `cytoscape` | `3.34.0` | `MIT` |
| `cytoscape-grid-guide` | `2.3.3` | `MIT` |
| `docx` | `9.6.1` | `MIT` |
| `dompurify` | `3.4.14` | `(MPL-2.0 OR Apache-2.0)` |
| `duplexer2` | `0.1.4` | `BSD-3-Clause` |
| `echarts` | `6.1.0` | `Apache-2.0` |
| `elkjs` | `0.11.1` | `EPL-2.0` |
| `event-target-shim` | `5.0.1` | `MIT` |
| `events` | `3.3.0` | `MIT` |
| `events-universal` | `1.0.1` | `Apache-2.0` |
| `fast-equals` | `5.4.0` | `MIT` |
| `fast-fifo` | `1.3.2` | `MIT` |
| `fast-png` | `6.4.0` | `MIT` |
| `fflate` | `0.8.2` | `MIT` |
| `font-family-papandreou` | `0.2.0-patch2` | `MIT` |
| `fs-extra` | `11.3.5` | `MIT` |
| `functional-red-black-tree` | `1.0.1` | `MIT` |
| `graceful-fs` | `4.2.11` | `ISC` |
| `hash.js` | `1.1.7` | `MIT` |
| `html2canvas` | `1.4.1` | `MIT` |
| `ieee754` | `1.2.1` | `BSD-3-Clause` |
| `immediate` | `3.0.6` | `MIT` |
| `inherits` | `2.0.4` | `ISC` |
| `intl-messageformat` | `11.2.8` | `BSD-3-Clause` |
| `iobuffer` | `5.4.0` | `MIT` |
| `is-stream` | `4.0.1` | `MIT` |
| `isarray` | `1.0.0` | `MIT` |
| `jsonfile` | `6.2.1` | `MIT` |
| `jspdf` | `4.2.1` | `MIT` |
| `jszip` | `3.10.1` | `(MIT OR GPL-3.0-or-later)` |
| `lie` | `3.3.0` | `MIT` |
| `linkifyjs` | `4.3.2` | `MIT` |
| `lucide-react` | `1.39.0` | `ISC` |
| `media-chrome` | `4.19.2` | `MIT` |
| `minimalistic-assert` | `1.0.1` | `ISC` |
| `minimatch` | `10.2.5` | `BlueOak-1.0.0` |
| `mp4box` | `2.4.1` | `BSD-3-Clause` |
| `nanoid` | `5.1.16` | `MIT` |
| `node-int64` | `0.4.0` | `MIT` |
| `normalize-path` | `3.0.0` | `MIT` |
| `orderedmap` | `2.1.1` | `MIT` |
| `pako` | `1.0.11` | `(MIT AND Zlib)` |
| `pako` | `2.1.0` | `(MIT AND Zlib)` |
| `pdfjs-dist` | `6.3.289` | `Apache-2.0` |
| `performance-now` | `2.1.0` | `MIT` |
| `process` | `0.11.10` | `MIT` |
| `process-nextick-args` | `2.0.1` | `MIT` |
| `prosemirror-changeset` | `2.4.1` | `MIT` |
| `prosemirror-commands` | `1.7.1` | `MIT` |
| `prosemirror-dropcursor` | `1.8.2` | `MIT` |
| `prosemirror-gapcursor` | `1.4.1` | `MIT` |
| `prosemirror-history` | `1.5.0` | `MIT` |
| `prosemirror-keymap` | `1.2.3` | `MIT` |
| `prosemirror-model` | `1.25.4` | `MIT` |
| `prosemirror-schema-list` | `1.5.1` | `MIT` |
| `prosemirror-state` | `1.4.4` | `MIT` |
| `prosemirror-tables` | `1.8.5` | `MIT` |
| `prosemirror-transform` | `1.12.0` | `MIT` |
| `prosemirror-view` | `1.41.8` | `MIT` |
| `raf` | `3.4.1` | `MIT` |
| `react` | `19.2.5` | `MIT` |
| `react-dom` | `19.2.5` | `MIT` |
| `read-excel-file` | `9.0.10` | `MIT` |
| `readable-stream` | `2.3.8` | `MIT` |
| `readable-stream` | `4.7.0` | `MIT` |
| `readdir-glob` | `3.0.0` | `Apache-2.0` |
| `regenerator-runtime` | `0.13.11` | `MIT` |
| `rgbcolor` | `1.0.1` | `MIT OR SEE LICENSE IN FEEL-FREE.md` |
| `rope-sequence` | `1.3.4` | `MIT` |
| `safe-buffer` | `5.1.2` | `MIT` |
| `safe-buffer` | `5.2.1` | `MIT` |
| `sax` | `1.6.0` | `BlueOak-1.0.0` |
| `scheduler` | `0.27.0` | `MIT` |
| `setimmediate` | `1.0.5` | `MIT` |
| `specificity` | `0.4.1` | `MIT` |
| `stackblur-canvas` | `2.7.0` | `MIT` |
| `streamx` | `2.26.0` | `MIT` |
| `string_decoder` | `1.1.1` | `MIT` |
| `string_decoder` | `1.3.0` | `MIT` |
| `svg-pathdata` | `6.0.3` | `MIT` |
| `svg2pdf.js` | `2.7.0` | `MIT` |
| `svgpath` | `2.6.0` | `MIT` |
| `tar-stream` | `3.2.0` | `MIT` |
| `teex` | `1.0.1` | `MIT` |
| `text-decoder` | `1.2.7` | `Apache-2.0` |
| `text-segmentation` | `1.0.3` | `MIT` |
| `tslib` | `2.3.0` | `0BSD` |
| `undici-types` | `7.19.2` | `MIT` |
| `universalify` | `2.0.1` | `MIT` |
| `unzipper` | `0.12.3` | `MIT` |
| `use-sync-external-store` | `1.6.0` | `MIT` |
| `util-deprecate` | `1.0.2` | `MIT` |
| `utrie` | `1.0.2` | `MIT` |
| `vis-timeline` | `8.5.4` | `(Apache-2.0 OR MIT)` |
| `w3c-keyname` | `2.2.8` | `MIT` |
| `wavesurfer.js` | `7.12.10` | `BSD-3-Clause` |
| `write-excel-file` | `4.0.7` | `MIT` |
| `xml` | `1.0.1` | `MIT` |
| `xml-js` | `1.6.11` | `MIT` |
| `zip-stream` | `7.0.5` | `MIT` |
| `zrender` | `6.1.0` | `BSD-3-Clause` |

## Resolved Rust Crate Inventory

| Crate | Version | License | License File |
| --- | --- | --- | --- |
| `adler2` | `2.0.1` | `0BSD OR MIT OR Apache-2.0` | `` |
| `aead` | `0.5.2` | `MIT OR Apache-2.0` | `` |
| `aes` | `0.8.4` | `MIT OR Apache-2.0` | `` |
| `aes-gcm` | `0.10.3` | `Apache-2.0 OR MIT` | `` |
| `ahash` | `0.8.12` | `MIT OR Apache-2.0` | `` |
| `aho-corasick` | `1.1.4` | `Unlicense OR MIT` | `` |
| `alloc-no-stdlib` | `2.0.4` | `BSD-3-Clause` | `` |
| `alloc-stdlib` | `0.2.2` | `BSD-3-Clause` | `` |
| `allocator-api2` | `0.2.21` | `MIT OR Apache-2.0` | `` |
| `android_system_properties` | `0.1.5` | `MIT/Apache-2.0` | `` |
| `anyhow` | `1.0.102` | `MIT OR Apache-2.0` | `` |
| `argon2` | `0.5.3` | `MIT OR Apache-2.0` | `` |
| `async-broadcast` | `0.7.2` | `MIT OR Apache-2.0` | `` |
| `async-channel` | `2.5.0` | `Apache-2.0 OR MIT` | `` |
| `async-executor` | `1.14.0` | `Apache-2.0 OR MIT` | `` |
| `async-io` | `2.6.0` | `Apache-2.0 OR MIT` | `` |
| `async-lock` | `3.4.2` | `Apache-2.0 OR MIT` | `` |
| `async-process` | `2.5.0` | `Apache-2.0 OR MIT` | `` |
| `async-recursion` | `1.1.1` | `MIT OR Apache-2.0` | `` |
| `async-signal` | `0.2.14` | `Apache-2.0 OR MIT` | `` |
| `async-task` | `4.7.1` | `Apache-2.0 OR MIT` | `` |
| `async-trait` | `0.1.89` | `MIT OR Apache-2.0` | `` |
| `atk` | `0.18.2` | `MIT` | `` |
| `atk-sys` | `0.18.2` | `MIT` | `` |
| `atomic-waker` | `1.1.2` | `Apache-2.0 OR MIT` | `` |
| `base64` | `0.13.1` | `MIT/Apache-2.0` | `` |
| `base64` | `0.21.7` | `MIT OR Apache-2.0` | `` |
| `base64` | `0.22.1` | `MIT OR Apache-2.0` | `` |
| `base64ct` | `1.8.3` | `Apache-2.0 OR MIT` | `` |
| `bit-set` | `0.8.0` | `Apache-2.0 OR MIT` | `` |
| `bit-vec` | `0.8.0` | `Apache-2.0 OR MIT` | `` |
| `bitflags` | `1.3.2` | `MIT/Apache-2.0` | `` |
| `bitflags` | `2.11.1` | `MIT OR Apache-2.0` | `` |
| `blake2` | `0.10.6` | `MIT OR Apache-2.0` | `` |
| `block-buffer` | `0.10.4` | `MIT OR Apache-2.0` | `` |
| `block-buffer` | `0.12.1` | `MIT OR Apache-2.0` | `` |
| `block2` | `0.6.2` | `MIT` | `` |
| `blocking` | `1.6.2` | `Apache-2.0 OR MIT` | `` |
| `brotli` | `8.0.2` | `BSD-3-Clause AND MIT` | `` |
| `brotli-decompressor` | `5.0.0` | `BSD-3-Clause/MIT` | `` |
| `bumpalo` | `3.20.2` | `MIT OR Apache-2.0` | `` |
| `bytemuck` | `1.25.0` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `bytemuck_derive` | `1.10.2` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `byteorder` | `1.5.0` | `Unlicense OR MIT` | `` |
| `bytes` | `1.11.1` | `MIT` | `` |
| `cairo-rs` | `0.18.5` | `MIT` | `` |
| `cairo-sys-rs` | `0.18.2` | `MIT` | `` |
| `camino` | `1.2.2` | `MIT OR Apache-2.0` | `` |
| `candle-core` | `0.10.2` | `MIT OR Apache-2.0` | `` |
| `candle-nn` | `0.10.2` | `MIT OR Apache-2.0` | `` |
| `candle-transformers` | `0.10.2` | `MIT OR Apache-2.0` | `` |
| `cargo_metadata` | `0.19.2` | `MIT` | `` |
| `cargo-platform` | `0.1.9` | `MIT OR Apache-2.0` | `` |
| `castaway` | `0.2.4` | `MIT` | `` |
| `cesu8` | `1.1.0` | `Apache-2.0/MIT` | `` |
| `cfb` | `0.7.3` | `MIT` | `` |
| `cfg-if` | `1.0.4` | `MIT OR Apache-2.0` | `` |
| `chacha20` | `0.10.0` | `MIT OR Apache-2.0` | `` |
| `chrono` | `0.4.44` | `MIT OR Apache-2.0` | `` |
| `cipher` | `0.4.4` | `MIT OR Apache-2.0` | `` |
| `cmov` | `0.5.4` | `Apache-2.0 OR MIT` | `` |
| `combine` | `4.6.7` | `MIT` | `` |
| `compact_str` | `0.9.0` | `MIT` | `` |
| `concurrent-queue` | `2.5.0` | `Apache-2.0 OR MIT` | `` |
| `console` | `0.15.11` | `MIT` | `` |
| `const-oid` | `0.10.2` | `Apache-2.0 OR MIT` | `` |
| `convert_case` | `0.4.0` | `MIT` | `` |
| `cookie` | `0.18.1` | `MIT OR Apache-2.0` | `` |
| `core-foundation` | `0.10.1` | `MIT OR Apache-2.0` | `` |
| `core-foundation-sys` | `0.8.7` | `MIT OR Apache-2.0` | `` |
| `core-graphics` | `0.25.0` | `MIT OR Apache-2.0` | `` |
| `core-graphics-types` | `0.2.0` | `MIT OR Apache-2.0` | `` |
| `cpufeatures` | `0.2.17` | `MIT OR Apache-2.0` | `` |
| `cpufeatures` | `0.3.0` | `MIT OR Apache-2.0` | `` |
| `crc32fast` | `1.5.0` | `MIT OR Apache-2.0` | `` |
| `crossbeam-channel` | `0.5.15` | `MIT OR Apache-2.0` | `` |
| `crossbeam-deque` | `0.8.6` | `MIT OR Apache-2.0` | `` |
| `crossbeam-epoch` | `0.9.18` | `MIT OR Apache-2.0` | `` |
| `crossbeam-utils` | `0.8.21` | `MIT OR Apache-2.0` | `` |
| `crunchy` | `0.2.4` | `MIT` | `` |
| `crypto-common` | `0.1.7` | `MIT OR Apache-2.0` | `` |
| `crypto-common` | `0.2.2` | `MIT OR Apache-2.0` | `` |
| `cssparser` | `0.29.6` | `MPL-2.0` | `` |
| `cssparser` | `0.36.0` | `MPL-2.0` | `` |
| `cssparser-macros` | `0.6.1` | `MPL-2.0` | `` |
| `ctor` | `0.2.9` | `Apache-2.0 OR MIT` | `` |
| `ctr` | `0.9.2` | `MIT OR Apache-2.0` | `` |
| `ctutils` | `0.4.2` | `Apache-2.0 OR MIT` | `` |
| `darling` | `0.20.11` | `MIT` | `` |
| `darling` | `0.23.0` | `MIT` | `` |
| `darling_core` | `0.20.11` | `MIT` | `` |
| `darling_core` | `0.23.0` | `MIT` | `` |
| `darling_macro` | `0.20.11` | `MIT` | `` |
| `darling_macro` | `0.23.0` | `MIT` | `` |
| `dary_heap` | `0.3.9` | `MIT OR Apache-2.0` | `` |
| `deranged` | `0.5.8` | `MIT OR Apache-2.0` | `` |
| `derive_builder` | `0.20.2` | `MIT OR Apache-2.0` | `` |
| `derive_builder_core` | `0.20.2` | `MIT OR Apache-2.0` | `` |
| `derive_builder_macro` | `0.20.2` | `MIT OR Apache-2.0` | `` |
| `derive_more` | `0.99.20` | `MIT` | `` |
| `derive_more` | `2.1.1` | `MIT` | `` |
| `derive_more-impl` | `2.1.1` | `MIT` | `` |
| `digest` | `0.10.7` | `MIT OR Apache-2.0` | `` |
| `digest` | `0.11.3` | `MIT OR Apache-2.0` | `` |
| `dirs` | `6.0.0` | `MIT OR Apache-2.0` | `` |
| `dirs-sys` | `0.5.0` | `MIT OR Apache-2.0` | `` |
| `dispatch2` | `0.3.1` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `displaydoc` | `0.2.5` | `MIT OR Apache-2.0` | `` |
| `dlopen2` | `0.8.2` | `MIT` | `` |
| `dlopen2_derive` | `0.4.3` | `MIT` | `` |
| `dom_query` | `0.27.0` | `MIT` | `` |
| `dpi` | `0.1.2` | `Apache-2.0 AND MIT` | `` |
| `dtoa` | `1.0.11` | `MIT OR Apache-2.0` | `` |
| `dtoa-short` | `0.3.5` | `MPL-2.0` | `` |
| `dunce` | `1.0.5` | `CC0-1.0 OR MIT-0 OR Apache-2.0` | `` |
| `dyn-clone` | `1.0.20` | `MIT OR Apache-2.0` | `` |
| `dyn-stack` | `0.13.2` | `MIT` | `` |
| `dyn-stack-macros` | `0.1.3` | `MIT` | `` |
| `either` | `1.15.0` | `MIT OR Apache-2.0` | `` |
| `embed_plist` | `1.2.2` | `MIT OR Apache-2.0` | `` |
| `encode_unicode` | `1.0.0` | `Apache-2.0 OR MIT` | `` |
| `encoding_rs` | `0.8.35` | `(Apache-2.0 OR MIT) AND BSD-3-Clause` | `` |
| `endi` | `1.1.1` | `MIT` | `` |
| `enum-as-inner` | `0.6.1` | `MIT/Apache-2.0` | `` |
| `enumflags2` | `0.7.12` | `MIT OR Apache-2.0` | `` |
| `enumflags2_derive` | `0.7.12` | `MIT OR Apache-2.0` | `` |
| `equivalent` | `1.0.2` | `Apache-2.0 OR MIT` | `` |
| `erased-serde` | `0.4.10` | `MIT OR Apache-2.0` | `` |
| `errno` | `0.3.14` | `MIT OR Apache-2.0` | `` |
| `esaxx-rs` | `0.1.10` | `Apache-2.0` | `` |
| `event-listener` | `5.4.1` | `Apache-2.0 OR MIT` | `` |
| `event-listener-strategy` | `0.5.4` | `Apache-2.0 OR MIT` | `` |
| `fallible-iterator` | `0.2.0` | `MIT/Apache-2.0` | `` |
| `fancy-regex` | `0.17.0` | `MIT` | `` |
| `fastrand` | `2.4.1` | `Apache-2.0 OR MIT` | `` |
| `fdeflate` | `0.3.7` | `MIT OR Apache-2.0` | `` |
| `field-offset` | `0.3.6` | `MIT OR Apache-2.0` | `` |
| `flate2` | `1.1.9` | `MIT OR Apache-2.0` | `` |
| `float8` | `0.7.0` | `MIT` | `` |
| `fnv` | `1.0.7` | `Apache-2.0 / MIT` | `` |
| `foldhash` | `0.1.5` | `Zlib` | `` |
| `foldhash` | `0.2.0` | `Zlib` | `` |
| `foreign-types` | `0.5.0` | `MIT/Apache-2.0` | `` |
| `foreign-types-macros` | `0.2.3` | `MIT/Apache-2.0` | `` |
| `foreign-types-shared` | `0.3.1` | `MIT/Apache-2.0` | `` |
| `form_urlencoded` | `1.2.2` | `MIT OR Apache-2.0` | `` |
| `futf` | `0.1.5` | `MIT / Apache-2.0` | `` |
| `futures-channel` | `0.3.32` | `MIT OR Apache-2.0` | `` |
| `futures-core` | `0.3.32` | `MIT OR Apache-2.0` | `` |
| `futures-executor` | `0.3.32` | `MIT OR Apache-2.0` | `` |
| `futures-io` | `0.3.32` | `MIT OR Apache-2.0` | `` |
| `futures-lite` | `2.6.1` | `Apache-2.0 OR MIT` | `` |
| `futures-macro` | `0.3.32` | `MIT OR Apache-2.0` | `` |
| `futures-sink` | `0.3.32` | `MIT OR Apache-2.0` | `` |
| `futures-task` | `0.3.32` | `MIT OR Apache-2.0` | `` |
| `futures-util` | `0.3.32` | `MIT OR Apache-2.0` | `` |
| `fxhash` | `0.2.1` | `Apache-2.0/MIT` | `` |
| `gdk` | `0.18.2` | `MIT` | `` |
| `gdk-pixbuf` | `0.18.5` | `MIT` | `` |
| `gdk-pixbuf-sys` | `0.18.0` | `MIT` | `` |
| `gdk-sys` | `0.18.2` | `MIT` | `` |
| `gdkwayland-sys` | `0.18.2` | `MIT` | `` |
| `gdkx11` | `0.18.2` | `MIT` | `` |
| `gdkx11-sys` | `0.18.2` | `MIT` | `` |
| `gemm` | `0.19.0` | `MIT` | `` |
| `gemm-c32` | `0.19.0` | `MIT` | `` |
| `gemm-c64` | `0.19.0` | `MIT` | `` |
| `gemm-common` | `0.19.0` | `MIT` | `` |
| `gemm-f16` | `0.19.0` | `MIT` | `` |
| `gemm-f32` | `0.19.0` | `MIT` | `` |
| `gemm-f64` | `0.19.0` | `MIT` | `` |
| `generic-array` | `0.14.7` | `MIT` | `` |
| `getrandom` | `0.2.17` | `MIT OR Apache-2.0` | `` |
| `getrandom` | `0.3.4` | `MIT OR Apache-2.0` | `` |
| `getrandom` | `0.4.2` | `MIT OR Apache-2.0` | `` |
| `ghash` | `0.5.1` | `Apache-2.0 OR MIT` | `` |
| `gio` | `0.18.4` | `MIT` | `` |
| `gio-sys` | `0.18.1` | `MIT` | `` |
| `glib` | `0.18.5` | `MIT` | `` |
| `glib-macros` | `0.18.5` | `MIT` | `` |
| `glib-sys` | `0.18.1` | `MIT` | `` |
| `glob` | `0.3.3` | `MIT OR Apache-2.0` | `` |
| `gobject-sys` | `0.18.0` | `MIT` | `` |
| `gtk` | `0.18.2` | `MIT` | `` |
| `gtk-sys` | `0.18.2` | `MIT` | `` |
| `gtk3-macros` | `0.18.2` | `MIT` | `` |
| `half` | `2.7.1` | `MIT OR Apache-2.0` | `` |
| `hashbrown` | `0.12.3` | `MIT OR Apache-2.0` | `` |
| `hashbrown` | `0.15.5` | `MIT OR Apache-2.0` | `` |
| `hashbrown` | `0.16.1` | `MIT OR Apache-2.0` | `` |
| `hashbrown` | `0.17.0` | `MIT OR Apache-2.0` | `` |
| `heck` | `0.4.1` | `MIT OR Apache-2.0` | `` |
| `heck` | `0.5.0` | `MIT OR Apache-2.0` | `` |
| `hermit-abi` | `0.5.2` | `MIT OR Apache-2.0` | `` |
| `hex` | `0.4.3` | `MIT OR Apache-2.0` | `` |
| `hmac` | `0.13.0` | `MIT OR Apache-2.0` | `` |
| `html5ever` | `0.29.1` | `MIT OR Apache-2.0` | `` |
| `html5ever` | `0.38.0` | `MIT OR Apache-2.0` | `` |
| `http` | `1.4.0` | `MIT OR Apache-2.0` | `` |
| `http-body` | `1.0.1` | `MIT` | `` |
| `http-body-util` | `0.1.3` | `MIT` | `` |
| `httparse` | `1.10.1` | `MIT OR Apache-2.0` | `` |
| `hybrid-array` | `0.4.10` | `MIT OR Apache-2.0` | `` |
| `hyper` | `1.9.0` | `MIT` | `` |
| `hyper-rustls` | `0.27.9` | `Apache-2.0 OR ISC OR MIT` | `` |
| `hyper-util` | `0.1.20` | `MIT` | `` |
| `iana-time-zone` | `0.1.65` | `MIT OR Apache-2.0` | `` |
| `iana-time-zone-haiku` | `0.1.2` | `MIT OR Apache-2.0` | `` |
| `ico` | `0.5.0` | `MIT` | `` |
| `icu_collections` | `2.2.0` | `Unicode-3.0` | `` |
| `icu_locale_core` | `2.2.0` | `Unicode-3.0` | `` |
| `icu_normalizer` | `2.2.0` | `Unicode-3.0` | `` |
| `icu_normalizer_data` | `2.2.0` | `Unicode-3.0` | `` |
| `icu_properties` | `2.2.0` | `Unicode-3.0` | `` |
| `icu_properties_data` | `2.2.0` | `Unicode-3.0` | `` |
| `icu_provider` | `2.2.0` | `Unicode-3.0` | `` |
| `id-arena` | `2.3.0` | `MIT/Apache-2.0` | `` |
| `ident_case` | `1.0.1` | `MIT/Apache-2.0` | `` |
| `idna` | `1.1.0` | `MIT OR Apache-2.0` | `` |
| `idna_adapter` | `1.2.1` | `Apache-2.0 OR MIT` | `` |
| `indexmap` | `1.9.3` | `Apache-2.0 OR MIT` | `` |
| `indexmap` | `2.14.0` | `Apache-2.0 OR MIT` | `` |
| `indicatif` | `0.17.11` | `MIT` | `` |
| `infer` | `0.19.0` | `MIT` | `` |
| `inout` | `0.1.4` | `MIT OR Apache-2.0` | `` |
| `ipnet` | `2.12.0` | `MIT OR Apache-2.0` | `` |
| `iri-string` | `0.7.12` | `MIT OR Apache-2.0` | `` |
| `is-docker` | `0.2.0` | `MIT` | `` |
| `is-wsl` | `0.4.0` | `MIT` | `` |
| `itertools` | `0.14.0` | `MIT OR Apache-2.0` | `` |
| `itoa` | `1.0.18` | `MIT OR Apache-2.0` | `` |
| `javascriptcore-rs` | `1.1.2` | `MIT` | `` |
| `javascriptcore-rs-sys` | `1.1.1` | `MIT` | `` |
| `jni` | `0.21.1` | `MIT/Apache-2.0` | `` |
| `jni-sys` | `0.3.1` | `MIT OR Apache-2.0` | `` |
| `jni-sys` | `0.4.1` | `MIT OR Apache-2.0` | `` |
| `jni-sys-macros` | `0.4.1` | `MIT OR Apache-2.0` | `` |
| `js-sys` | `0.3.95` | `MIT OR Apache-2.0` | `` |
| `json-patch` | `3.0.1` | `MIT/Apache-2.0` | `` |
| `jsonptr` | `0.6.3` | `MIT OR Apache-2.0` | `` |
| `keyboard-types` | `0.7.0` | `MIT OR Apache-2.0` | `` |
| `kuchikiki` | `0.8.8-speedreader` | `MIT` | `` |
| `leb128fmt` | `0.1.0` | `MIT OR Apache-2.0` | `` |
| `libappindicator` | `0.9.0` | `Apache-2.0 OR MIT` | `` |
| `libappindicator-sys` | `0.9.0` | `Apache-2.0 OR MIT` | `` |
| `libc` | `0.2.185` | `MIT OR Apache-2.0` | `` |
| `libloading` | `0.7.4` | `ISC` | `` |
| `libm` | `0.2.16` | `MIT` | `` |
| `libredox` | `0.1.16` | `MIT` | `` |
| `linux-raw-sys` | `0.12.1` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `litemap` | `0.8.2` | `Unicode-3.0` | `` |
| `lock_api` | `0.4.14` | `MIT OR Apache-2.0` | `` |
| `log` | `0.4.29` | `MIT OR Apache-2.0` | `` |
| `lru-slab` | `0.1.2` | `MIT OR Apache-2.0 OR Zlib` | `` |
| `mac` | `0.1.1` | `MIT/Apache-2.0` | `` |
| `macro_rules_attribute` | `0.2.2` | `Apache-2.0 OR MIT OR Zlib` | `` |
| `macro_rules_attribute-proc_macro` | `0.2.2` | `Apache-2.0 OR MIT OR Zlib` | `` |
| `markup5ever` | `0.14.1` | `MIT OR Apache-2.0` | `` |
| `markup5ever` | `0.38.0` | `MIT OR Apache-2.0` | `` |
| `match_token` | `0.1.0` | `MIT OR Apache-2.0` | `` |
| `matches` | `0.1.10` | `MIT` | `` |
| `md-5` | `0.11.0` | `MIT OR Apache-2.0` | `` |
| `memchr` | `2.8.0` | `Unlicense OR MIT` | `` |
| `memmap2` | `0.9.10` | `MIT OR Apache-2.0` | `` |
| `memoffset` | `0.9.1` | `MIT` | `` |
| `mime` | `0.3.17` | `MIT OR Apache-2.0` | `` |
| `minimal-lexical` | `0.2.1` | `MIT/Apache-2.0` | `` |
| `miniz_oxide` | `0.8.9` | `MIT OR Zlib OR Apache-2.0` | `` |
| `mio` | `1.2.0` | `MIT` | `` |
| `monostate` | `0.1.18` | `MIT OR Apache-2.0` | `` |
| `monostate-impl` | `0.1.18` | `MIT OR Apache-2.0` | `` |
| `muda` | `0.17.2` | `Apache-2.0 OR MIT` | `` |
| `ndk` | `0.9.0` | `MIT OR Apache-2.0` | `` |
| `ndk-context` | `0.1.1` | `MIT OR Apache-2.0` | `` |
| `ndk-sys` | `0.6.0+11769913` | `MIT OR Apache-2.0` | `` |
| `new_debug_unreachable` | `1.0.6` | `MIT` | `` |
| `nodrop` | `0.1.14` | `MIT/Apache-2.0` | `` |
| `nom` | `7.1.3` | `MIT` | `` |
| `num_cpus` | `1.17.0` | `MIT OR Apache-2.0` | `` |
| `num_enum` | `0.7.6` | `BSD-3-Clause OR MIT OR Apache-2.0` | `` |
| `num_enum_derive` | `0.7.6` | `BSD-3-Clause OR MIT OR Apache-2.0` | `` |
| `num-complex` | `0.4.6` | `MIT OR Apache-2.0` | `` |
| `num-conv` | `0.2.1` | `MIT OR Apache-2.0` | `` |
| `num-traits` | `0.2.19` | `MIT OR Apache-2.0` | `` |
| `number_prefix` | `0.4.0` | `MIT` | `` |
| `objc2` | `0.6.4` | `MIT` | `` |
| `objc2-app-kit` | `0.3.2` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `objc2-core-foundation` | `0.3.2` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `objc2-core-graphics` | `0.3.2` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `objc2-encode` | `4.1.0` | `MIT` | `` |
| `objc2-exception-helper` | `0.1.1` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `objc2-foundation` | `0.3.2` | `MIT` | `` |
| `objc2-io-surface` | `0.3.2` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `objc2-quartz-core` | `0.3.2` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `objc2-system-configuration` | `0.3.2` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `objc2-ui-kit` | `0.3.2` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `objc2-web-kit` | `0.3.2` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `once_cell` | `1.21.4` | `MIT OR Apache-2.0` | `` |
| `onig` | `6.5.3` | `MIT` | `` |
| `onig_sys` | `69.9.3` | `MIT` | `` |
| `opaque-debug` | `0.3.1` | `MIT OR Apache-2.0` | `` |
| `open` | `5.3.3` | `MIT` | `` |
| `option-ext` | `0.2.0` | `MPL-2.0` | `` |
| `ordered-stream` | `0.2.0` | `MIT OR Apache-2.0` | `` |
| `os_pipe` | `1.2.3` | `MIT` | `` |
| `pango` | `0.18.3` | `MIT` | `` |
| `pango-sys` | `0.18.0` | `MIT` | `` |
| `parking` | `2.2.1` | `Apache-2.0 OR MIT` | `` |
| `parking_lot` | `0.12.5` | `MIT OR Apache-2.0` | `` |
| `parking_lot_core` | `0.9.12` | `MIT OR Apache-2.0` | `` |
| `password-hash` | `0.5.0` | `MIT OR Apache-2.0` | `` |
| `paste` | `1.0.15` | `MIT OR Apache-2.0` | `` |
| `pathdiff` | `0.2.3` | `MIT/Apache-2.0` | `` |
| `percent-encoding` | `2.3.2` | `MIT OR Apache-2.0` | `` |
| `phf` | `0.10.1` | `MIT` | `` |
| `phf` | `0.11.3` | `MIT` | `` |
| `phf` | `0.13.1` | `MIT` | `` |
| `phf` | `0.8.0` | `MIT` | `` |
| `phf_generator` | `0.10.0` | `MIT` | `` |
| `phf_generator` | `0.11.3` | `MIT` | `` |
| `phf_generator` | `0.13.1` | `MIT` | `` |
| `phf_macros` | `0.10.0` | `MIT` | `` |
| `phf_macros` | `0.11.3` | `MIT` | `` |
| `phf_macros` | `0.13.1` | `MIT` | `` |
| `phf_shared` | `0.10.0` | `MIT` | `` |
| `phf_shared` | `0.11.3` | `MIT` | `` |
| `phf_shared` | `0.13.1` | `MIT` | `` |
| `phf_shared` | `0.8.0` | `MIT` | `` |
| `pin-project-lite` | `0.2.17` | `Apache-2.0 OR MIT` | `` |
| `piper` | `0.2.5` | `MIT OR Apache-2.0` | `` |
| `plist` | `1.8.0` | `MIT` | `` |
| `png` | `0.17.16` | `MIT OR Apache-2.0` | `` |
| `polling` | `3.11.0` | `Apache-2.0 OR MIT` | `` |
| `polyval` | `0.6.2` | `Apache-2.0 OR MIT` | `` |
| `portable-atomic` | `1.13.1` | `Apache-2.0 OR MIT` | `` |
| `postgres-protocol` | `0.6.12` | `MIT OR Apache-2.0` | `` |
| `postgres-types` | `0.2.14` | `MIT OR Apache-2.0` | `` |
| `potential_utf` | `0.1.5` | `Unicode-3.0` | `` |
| `powerfmt` | `0.2.0` | `MIT OR Apache-2.0` | `` |
| `ppv-lite86` | `0.2.21` | `MIT OR Apache-2.0` | `` |
| `precomputed-hash` | `0.1.1` | `MIT` | `` |
| `prettyplease` | `0.2.37` | `MIT OR Apache-2.0` | `` |
| `proc-macro-crate` | `1.3.1` | `MIT OR Apache-2.0` | `` |
| `proc-macro-crate` | `2.0.2` | `MIT OR Apache-2.0` | `` |
| `proc-macro-crate` | `3.5.0` | `MIT OR Apache-2.0` | `` |
| `proc-macro-error` | `1.0.4` | `MIT OR Apache-2.0` | `` |
| `proc-macro-error-attr` | `1.0.4` | `MIT OR Apache-2.0` | `` |
| `proc-macro-hack` | `0.5.20+deprecated` | `MIT OR Apache-2.0` | `` |
| `proc-macro2` | `1.0.106` | `MIT OR Apache-2.0` | `` |
| `pulp` | `0.22.2` | `MIT` | `` |
| `pulp-wasm-simd-flag` | `0.1.0` | `MIT` | `` |
| `quick-xml` | `0.38.4` | `MIT` | `` |
| `quinn` | `0.11.9` | `MIT OR Apache-2.0` | `` |
| `quinn-proto` | `0.11.14` | `MIT OR Apache-2.0` | `` |
| `quinn-udp` | `0.5.14` | `MIT OR Apache-2.0` | `` |
| `quote` | `1.0.45` | `MIT OR Apache-2.0` | `` |
| `r-efi` | `5.3.0` | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` | `` |
| `r-efi` | `6.0.0` | `MIT OR Apache-2.0 OR LGPL-2.1-or-later` | `` |
| `rand` | `0.10.1` | `MIT OR Apache-2.0` | `` |
| `rand` | `0.8.5` | `MIT OR Apache-2.0` | `` |
| `rand` | `0.9.4` | `MIT OR Apache-2.0` | `` |
| `rand_chacha` | `0.3.1` | `MIT OR Apache-2.0` | `` |
| `rand_chacha` | `0.9.0` | `MIT OR Apache-2.0` | `` |
| `rand_core` | `0.10.1` | `MIT OR Apache-2.0` | `` |
| `rand_core` | `0.6.4` | `MIT OR Apache-2.0` | `` |
| `rand_core` | `0.9.5` | `MIT OR Apache-2.0` | `` |
| `rand_distr` | `0.5.1` | `MIT OR Apache-2.0` | `` |
| `raw-cpuid` | `11.6.0` | `MIT` | `` |
| `raw-window-handle` | `0.6.2` | `MIT OR Apache-2.0 OR Zlib` | `` |
| `rayon` | `1.12.0` | `MIT OR Apache-2.0` | `` |
| `rayon-cond` | `0.4.0` | `Apache-2.0/MIT` | `` |
| `rayon-core` | `1.13.0` | `MIT OR Apache-2.0` | `` |
| `reborrow` | `0.5.5` | `MIT` | `` |
| `redox_syscall` | `0.5.18` | `MIT` | `` |
| `redox_users` | `0.5.2` | `MIT` | `` |
| `ref-cast` | `1.0.25` | `MIT OR Apache-2.0` | `` |
| `ref-cast-impl` | `1.0.25` | `MIT OR Apache-2.0` | `` |
| `regex` | `1.12.3` | `MIT OR Apache-2.0` | `` |
| `regex-automata` | `0.4.14` | `MIT OR Apache-2.0` | `` |
| `regex-syntax` | `0.8.10` | `MIT OR Apache-2.0` | `` |
| `reqwest` | `0.12.28` | `MIT OR Apache-2.0` | `` |
| `reqwest` | `0.13.2` | `MIT OR Apache-2.0` | `` |
| `rfd` | `0.16.0` | `MIT` | `` |
| `ring` | `0.17.14` | `Apache-2.0 AND ISC` | `` |
| `rustc-hash` | `2.1.2` | `Apache-2.0 OR MIT` | `` |
| `rustix` | `1.1.4` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `rustls` | `0.23.40` | `Apache-2.0 OR ISC OR MIT` | `` |
| `rustls-pki-types` | `1.14.1` | `MIT OR Apache-2.0` | `` |
| `rustls-webpki` | `0.103.13` | `ISC` | `` |
| `rustversion` | `1.0.22` | `MIT OR Apache-2.0` | `` |
| `ryu` | `1.0.23` | `Apache-2.0 OR BSL-1.0` | `` |
| `safetensors` | `0.7.0` | `Apache-2.0` | `` |
| `same-file` | `1.0.6` | `Unlicense/MIT` | `` |
| `schemars` | `0.8.22` | `MIT` | `` |
| `schemars` | `0.9.0` | `MIT` | `` |
| `schemars` | `1.2.1` | `MIT` | `` |
| `schemars_derive` | `0.8.22` | `MIT` | `` |
| `scopeguard` | `1.2.0` | `MIT OR Apache-2.0` | `` |
| `selectors` | `0.24.0` | `MPL-2.0` | `` |
| `selectors` | `0.36.1` | `MPL-2.0` | `` |
| `semver` | `1.0.28` | `MIT OR Apache-2.0` | `` |
| `seq-macro` | `0.3.6` | `MIT OR Apache-2.0` | `` |
| `serde` | `1.0.228` | `MIT OR Apache-2.0` | `` |
| `serde_core` | `1.0.228` | `MIT OR Apache-2.0` | `` |
| `serde_derive` | `1.0.228` | `MIT OR Apache-2.0` | `` |
| `serde_derive_internals` | `0.29.1` | `MIT OR Apache-2.0` | `` |
| `serde_json` | `1.0.149` | `MIT OR Apache-2.0` | `` |
| `serde_plain` | `1.0.2` | `MIT/Apache-2.0` | `` |
| `serde_repr` | `0.1.20` | `MIT OR Apache-2.0` | `` |
| `serde_spanned` | `0.6.9` | `MIT OR Apache-2.0` | `` |
| `serde_spanned` | `1.1.1` | `MIT OR Apache-2.0` | `` |
| `serde_urlencoded` | `0.7.1` | `MIT/Apache-2.0` | `` |
| `serde_with` | `3.18.0` | `MIT OR Apache-2.0` | `` |
| `serde_with_macros` | `3.18.0` | `MIT OR Apache-2.0` | `` |
| `serde-untagged` | `0.1.9` | `MIT OR Apache-2.0` | `` |
| `serialize-to-javascript` | `0.1.2` | `MIT OR Apache-2.0` | `` |
| `serialize-to-javascript-impl` | `0.1.2` | `MIT OR Apache-2.0` | `` |
| `servo_arc` | `0.2.0` | `MIT OR Apache-2.0` | `` |
| `servo_arc` | `0.4.3` | `MIT OR Apache-2.0` | `` |
| `sha2` | `0.10.9` | `MIT OR Apache-2.0` | `` |
| `sha2` | `0.11.0` | `MIT OR Apache-2.0` | `` |
| `shared_child` | `1.1.1` | `MIT` | `` |
| `sigchld` | `0.2.4` | `MIT` | `` |
| `signal-hook` | `0.3.18` | `Apache-2.0/MIT` | `` |
| `signal-hook-registry` | `1.4.8` | `MIT OR Apache-2.0` | `` |
| `simd-adler32` | `0.3.9` | `MIT` | `` |
| `siphasher` | `0.3.11` | `MIT/Apache-2.0` | `` |
| `siphasher` | `1.0.2` | `MIT/Apache-2.0` | `` |
| `slab` | `0.4.12` | `MIT` | `` |
| `smallvec` | `1.15.1` | `MIT OR Apache-2.0` | `` |
| `socket2` | `0.6.3` | `MIT OR Apache-2.0` | `` |
| `softbuffer` | `0.4.8` | `MIT OR Apache-2.0` | `` |
| `soup3` | `0.5.0` | `MIT` | `` |
| `soup3-sys` | `0.5.0` | `MIT` | `` |
| `spm_precompiled` | `0.1.4` | `Apache-2.0` | `` |
| `stable_deref_trait` | `1.2.1` | `MIT OR Apache-2.0` | `` |
| `static_assertions` | `1.1.0` | `MIT OR Apache-2.0` | `` |
| `string_cache` | `0.8.9` | `MIT OR Apache-2.0` | `` |
| `string_cache` | `0.9.0` | `MIT OR Apache-2.0` | `` |
| `stringprep` | `0.1.5` | `MIT/Apache-2.0` | `` |
| `strsim` | `0.11.1` | `MIT` | `` |
| `subtle` | `2.6.1` | `BSD-3-Clause` | `` |
| `swift-rs` | `1.0.7` | `MIT OR Apache-2.0` | `` |
| `syn` | `1.0.109` | `MIT OR Apache-2.0` | `` |
| `syn` | `2.0.117` | `MIT OR Apache-2.0` | `` |
| `sync_wrapper` | `1.0.2` | `Apache-2.0` | `` |
| `synstructure` | `0.13.2` | `MIT` | `` |
| `sysctl` | `0.6.0` | `MIT` | `` |
| `tao` | `0.34.8` | `Apache-2.0` | `` |
| `tao-macros` | `0.1.3` | `MIT OR Apache-2.0` | `` |
| `tauri` | `2.10.3` | `Apache-2.0 OR MIT` | `` |
| `tauri-codegen` | `2.5.5` | `Apache-2.0 OR MIT` | `` |
| `tauri-macros` | `2.5.5` | `Apache-2.0 OR MIT` | `` |
| `tauri-plugin-dialog` | `2.7.0` | `Apache-2.0 OR MIT` | `` |
| `tauri-plugin-fs` | `2.5.0` | `Apache-2.0 OR MIT` | `` |
| `tauri-plugin-opener` | `2.5.3` | `Apache-2.0 OR MIT` | `` |
| `tauri-runtime` | `2.10.1` | `Apache-2.0 OR MIT` | `` |
| `tauri-runtime-wry` | `2.10.1` | `Apache-2.0 OR MIT` | `` |
| `tauri-utils` | `2.8.3` | `Apache-2.0 OR MIT` | `` |
| `tempfile` | `3.27.0` | `MIT OR Apache-2.0` | `` |
| `tendril` | `0.4.3` | `MIT/Apache-2.0` | `` |
| `tendril` | `0.5.0` | `MIT OR Apache-2.0` | `` |
| `thiserror` | `1.0.69` | `MIT OR Apache-2.0` | `` |
| `thiserror` | `2.0.18` | `MIT OR Apache-2.0` | `` |
| `thiserror-impl` | `1.0.69` | `MIT OR Apache-2.0` | `` |
| `thiserror-impl` | `2.0.18` | `MIT OR Apache-2.0` | `` |
| `time` | `0.3.47` | `MIT OR Apache-2.0` | `` |
| `time-core` | `0.1.8` | `MIT OR Apache-2.0` | `` |
| `time-macros` | `0.2.27` | `MIT OR Apache-2.0` | `` |
| `tinystr` | `0.8.3` | `Unicode-3.0` | `` |
| `tinyvec` | `1.11.0` | `Zlib OR Apache-2.0 OR MIT` | `` |
| `tinyvec_macros` | `0.1.1` | `MIT OR Apache-2.0 OR Zlib` | `` |
| `tokenizers` | `0.21.4` | `Apache-2.0` | `` |
| `tokenizers` | `0.22.2` | `Apache-2.0` | `` |
| `tokio` | `1.52.0` | `MIT` | `` |
| `tokio-postgres` | `0.7.18` | `MIT OR Apache-2.0` | `` |
| `tokio-rustls` | `0.26.4` | `MIT OR Apache-2.0` | `` |
| `tokio-util` | `0.7.18` | `MIT` | `` |
| `toml` | `0.9.12+spec-1.1.0` | `MIT OR Apache-2.0` | `` |
| `toml_datetime` | `0.6.3` | `MIT OR Apache-2.0` | `` |
| `toml_datetime` | `0.7.5+spec-1.1.0` | `MIT OR Apache-2.0` | `` |
| `toml_datetime` | `1.1.1+spec-1.1.0` | `MIT OR Apache-2.0` | `` |
| `toml_edit` | `0.19.15` | `MIT OR Apache-2.0` | `` |
| `toml_edit` | `0.20.2` | `MIT OR Apache-2.0` | `` |
| `toml_edit` | `0.25.11+spec-1.1.0` | `MIT OR Apache-2.0` | `` |
| `toml_parser` | `1.1.2+spec-1.1.0` | `MIT OR Apache-2.0` | `` |
| `toml_writer` | `1.1.1+spec-1.1.0` | `MIT OR Apache-2.0` | `` |
| `tower` | `0.5.3` | `MIT` | `` |
| `tower-http` | `0.6.8` | `MIT` | `` |
| `tower-layer` | `0.3.3` | `MIT` | `` |
| `tower-service` | `0.3.3` | `MIT` | `` |
| `tracing` | `0.1.44` | `MIT` | `` |
| `tracing-attributes` | `0.1.31` | `MIT` | `` |
| `tracing-core` | `0.1.36` | `MIT` | `` |
| `tray-icon` | `0.21.3` | `MIT OR Apache-2.0` | `` |
| `try-lock` | `0.2.5` | `MIT` | `` |
| `typed-path` | `0.12.3` | `MIT OR Apache-2.0` | `` |
| `typeid` | `1.0.3` | `MIT OR Apache-2.0` | `` |
| `typenum` | `1.19.0` | `MIT OR Apache-2.0` | `` |
| `uds_windows` | `1.2.1` | `MIT` | `` |
| `unic-char-property` | `0.9.0` | `MIT/Apache-2.0` | `` |
| `unic-char-range` | `0.9.0` | `MIT/Apache-2.0` | `` |
| `unic-common` | `0.9.0` | `MIT/Apache-2.0` | `` |
| `unic-ucd-ident` | `0.9.0` | `MIT/Apache-2.0` | `` |
| `unic-ucd-version` | `0.9.0` | `MIT/Apache-2.0` | `` |
| `unicode_categories` | `0.1.1` | `MIT OR Apache-2.0` | `` |
| `unicode-bidi` | `0.3.18` | `MIT OR Apache-2.0` | `` |
| `unicode-ident` | `1.0.24` | `(MIT OR Apache-2.0) AND Unicode-3.0` | `` |
| `unicode-normalization` | `0.1.25` | `MIT OR Apache-2.0` | `` |
| `unicode-normalization-alignments` | `0.1.12` | `MIT/Apache-2.0` | `` |
| `unicode-properties` | `0.1.4` | `MIT/Apache-2.0` | `` |
| `unicode-segmentation` | `1.13.2` | `MIT OR Apache-2.0` | `` |
| `unicode-width` | `0.2.2` | `MIT OR Apache-2.0` | `` |
| `unicode-xid` | `0.2.6` | `MIT OR Apache-2.0` | `` |
| `universal-hash` | `0.5.1` | `MIT OR Apache-2.0` | `` |
| `untrusted` | `0.9.0` | `ISC` | `` |
| `url` | `2.5.8` | `MIT OR Apache-2.0` | `` |
| `urlpattern` | `0.3.0` | `MIT` | `` |
| `utf-8` | `0.7.6` | `MIT OR Apache-2.0` | `` |
| `utf8_iter` | `1.0.4` | `Apache-2.0 OR MIT` | `` |
| `uuid` | `1.23.0` | `Apache-2.0 OR MIT` | `` |
| `walkdir` | `2.5.0` | `Unlicense/MIT` | `` |
| `want` | `0.3.1` | `MIT` | `` |
| `wasi` | `0.11.1+wasi-snapshot-preview1` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wasi` | `0.14.7+wasi-0.2.4` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wasip2` | `1.0.2+wasi-0.2.9` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wasip3` | `0.4.0+wasi-0.3.0-rc-2026-01-06` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wasite` | `1.0.2` | `Apache-2.0 OR BSL-1.0 OR MIT` | `` |
| `wasm-bindgen` | `0.2.118` | `MIT OR Apache-2.0` | `` |
| `wasm-bindgen-futures` | `0.4.68` | `MIT OR Apache-2.0` | `` |
| `wasm-bindgen-macro` | `0.2.118` | `MIT OR Apache-2.0` | `` |
| `wasm-bindgen-macro-support` | `0.2.118` | `MIT OR Apache-2.0` | `` |
| `wasm-bindgen-shared` | `0.2.118` | `MIT OR Apache-2.0` | `` |
| `wasm-encoder` | `0.244.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wasm-metadata` | `0.244.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wasm-streams` | `0.5.0` | `MIT OR Apache-2.0` | `` |
| `wasmparser` | `0.244.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `web_atoms` | `0.2.3` | `MIT OR Apache-2.0` | `` |
| `web-sys` | `0.3.95` | `MIT OR Apache-2.0` | `` |
| `web-time` | `1.1.0` | `MIT OR Apache-2.0` | `` |
| `webkit2gtk` | `2.0.2` | `MIT` | `` |
| `webkit2gtk-sys` | `2.0.2` | `MIT` | `` |
| `webpki-roots` | `1.0.7` | `CDLA-Permissive-2.0` | `` |
| `webview2-com` | `0.38.2` | `MIT` | `` |
| `webview2-com-macros` | `0.8.1` | `MIT` | `` |
| `webview2-com-sys` | `0.38.2` | `MIT` | `` |
| `whoami` | `2.1.1` | `Apache-2.0 OR BSL-1.0 OR MIT` | `` |
| `winapi` | `0.3.9` | `MIT/Apache-2.0` | `` |
| `winapi-i686-pc-windows-gnu` | `0.4.0` | `MIT/Apache-2.0` | `` |
| `winapi-util` | `0.1.11` | `Unlicense OR MIT` | `` |
| `winapi-x86_64-pc-windows-gnu` | `0.4.0` | `MIT/Apache-2.0` | `` |
| `window-vibrancy` | `0.6.0` | `Apache-2.0 OR MIT` | `` |
| `windows` | `0.61.3` | `MIT OR Apache-2.0` | `` |
| `windows_aarch64_gnullvm` | `0.42.2` | `MIT OR Apache-2.0` | `` |
| `windows_aarch64_gnullvm` | `0.52.6` | `MIT OR Apache-2.0` | `` |
| `windows_aarch64_gnullvm` | `0.53.1` | `MIT OR Apache-2.0` | `` |
| `windows_aarch64_msvc` | `0.42.2` | `MIT OR Apache-2.0` | `` |
| `windows_aarch64_msvc` | `0.52.6` | `MIT OR Apache-2.0` | `` |
| `windows_aarch64_msvc` | `0.53.1` | `MIT OR Apache-2.0` | `` |
| `windows_i686_gnu` | `0.42.2` | `MIT OR Apache-2.0` | `` |
| `windows_i686_gnu` | `0.52.6` | `MIT OR Apache-2.0` | `` |
| `windows_i686_gnu` | `0.53.1` | `MIT OR Apache-2.0` | `` |
| `windows_i686_gnullvm` | `0.52.6` | `MIT OR Apache-2.0` | `` |
| `windows_i686_gnullvm` | `0.53.1` | `MIT OR Apache-2.0` | `` |
| `windows_i686_msvc` | `0.42.2` | `MIT OR Apache-2.0` | `` |
| `windows_i686_msvc` | `0.52.6` | `MIT OR Apache-2.0` | `` |
| `windows_i686_msvc` | `0.53.1` | `MIT OR Apache-2.0` | `` |
| `windows_x86_64_gnu` | `0.42.2` | `MIT OR Apache-2.0` | `` |
| `windows_x86_64_gnu` | `0.52.6` | `MIT OR Apache-2.0` | `` |
| `windows_x86_64_gnu` | `0.53.1` | `MIT OR Apache-2.0` | `` |
| `windows_x86_64_gnullvm` | `0.42.2` | `MIT OR Apache-2.0` | `` |
| `windows_x86_64_gnullvm` | `0.52.6` | `MIT OR Apache-2.0` | `` |
| `windows_x86_64_gnullvm` | `0.53.1` | `MIT OR Apache-2.0` | `` |
| `windows_x86_64_msvc` | `0.42.2` | `MIT OR Apache-2.0` | `` |
| `windows_x86_64_msvc` | `0.52.6` | `MIT OR Apache-2.0` | `` |
| `windows_x86_64_msvc` | `0.53.1` | `MIT OR Apache-2.0` | `` |
| `windows-collections` | `0.2.0` | `MIT OR Apache-2.0` | `` |
| `windows-core` | `0.61.2` | `MIT OR Apache-2.0` | `` |
| `windows-core` | `0.62.2` | `MIT OR Apache-2.0` | `` |
| `windows-future` | `0.2.1` | `MIT OR Apache-2.0` | `` |
| `windows-implement` | `0.60.2` | `MIT OR Apache-2.0` | `` |
| `windows-interface` | `0.59.3` | `MIT OR Apache-2.0` | `` |
| `windows-link` | `0.1.3` | `MIT OR Apache-2.0` | `` |
| `windows-link` | `0.2.1` | `MIT OR Apache-2.0` | `` |
| `windows-numerics` | `0.2.0` | `MIT OR Apache-2.0` | `` |
| `windows-result` | `0.3.4` | `MIT OR Apache-2.0` | `` |
| `windows-result` | `0.4.1` | `MIT OR Apache-2.0` | `` |
| `windows-strings` | `0.4.2` | `MIT OR Apache-2.0` | `` |
| `windows-strings` | `0.5.1` | `MIT OR Apache-2.0` | `` |
| `windows-sys` | `0.45.0` | `MIT OR Apache-2.0` | `` |
| `windows-sys` | `0.52.0` | `MIT OR Apache-2.0` | `` |
| `windows-sys` | `0.59.0` | `MIT OR Apache-2.0` | `` |
| `windows-sys` | `0.60.2` | `MIT OR Apache-2.0` | `` |
| `windows-sys` | `0.61.2` | `MIT OR Apache-2.0` | `` |
| `windows-targets` | `0.42.2` | `MIT OR Apache-2.0` | `` |
| `windows-targets` | `0.52.6` | `MIT OR Apache-2.0` | `` |
| `windows-targets` | `0.53.5` | `MIT OR Apache-2.0` | `` |
| `windows-threading` | `0.1.0` | `MIT OR Apache-2.0` | `` |
| `windows-version` | `0.1.7` | `MIT OR Apache-2.0` | `` |
| `winnow` | `0.5.40` | `MIT` | `` |
| `winnow` | `0.7.15` | `MIT` | `` |
| `winnow` | `1.0.1` | `MIT` | `` |
| `wit-bindgen` | `0.51.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wit-bindgen-core` | `0.51.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wit-bindgen-rust` | `0.51.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wit-bindgen-rust-macro` | `0.51.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wit-component` | `0.244.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `wit-parser` | `0.244.0` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` | `` |
| `writeable` | `0.6.3` | `Unicode-3.0` | `` |
| `wry` | `0.54.4` | `Apache-2.0 OR MIT` | `` |
| `x11` | `2.21.0` | `MIT` | `` |
| `x11-dl` | `2.21.0` | `MIT` | `` |
| `yoke` | `0.8.2` | `Unicode-3.0` | `` |
| `yoke-derive` | `0.8.2` | `Unicode-3.0` | `` |
| `zbus` | `5.14.0` | `MIT` | `` |
| `zbus_macros` | `5.14.0` | `MIT` | `` |
| `zbus_names` | `4.3.1` | `MIT` | `` |
| `zerocopy` | `0.8.48` | `BSD-2-Clause OR Apache-2.0 OR MIT` | `` |
| `zerocopy-derive` | `0.8.48` | `BSD-2-Clause OR Apache-2.0 OR MIT` | `` |
| `zerofrom` | `0.1.7` | `Unicode-3.0` | `` |
| `zerofrom-derive` | `0.1.7` | `Unicode-3.0` | `` |
| `zeroize` | `1.8.2` | `Apache-2.0 OR MIT` | `` |
| `zerotrie` | `0.2.4` | `Unicode-3.0` | `` |
| `zerovec` | `0.11.6` | `Unicode-3.0` | `` |
| `zerovec-derive` | `0.11.3` | `Unicode-3.0` | `` |
| `zip` | `7.2.0` | `MIT` | `` |
| `zmij` | `1.0.21` | `MIT` | `` |
| `zvariant` | `5.10.0` | `MIT` | `` |
| `zvariant_derive` | `5.10.0` | `MIT` | `` |
| `zvariant_utils` | `3.3.0` | `MIT` | `` |

## Included License Texts

- Full license text files for the primary license families and bundled assets are included in [licenses](./licenses/).
- PostgreSQL runtime redistribution notice and license text are included in [licenses/POSTGRESQL.txt](./licenses/POSTGRESQL.txt).
