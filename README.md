# KanQual

![Human + AI Collaboration: OpenAI Astra 6.0](vibe-coded-badge.svg?v=astra-6.0)

KanQual is a free, open-source, local-first qualitative research application for coding, memoing, reporting, visualization, and AI-assisted analysis. It is developed by Mehmet Cansoy, Associate Professor of Sociology at Fairfield University.

Visit [Kanqual.com](https://kanqual.com) to learn more.

KanQual is a desktop application built with Tauri, React, TypeScript, Rust, and an app-managed PostgreSQL backend. It is developed on Windows 11 and has also been tested on Windows 10, macOS 26.5, and Ubuntu 26.04.

## What KanQual Does

KanQual supports qualitative research projects that need to remain grounded in source material while offering structured analysis, collaboration, and optional local AI tools.

Core capabilities include:

- Coding and annotating text, PDF, image, audio, video, and transcript sources
- Organizing project data as sources, objects, relationships, codes, and annotations
- Exploring projects through details, graph, and timeline views
- Creating memos and reports across annotations, codes, and users
- Managing project roles, permissions, logs, snapshots, and encrypted backups
- Importing and exporting project data, including REFI-QDA exchange formats
- Collaborating over a trusted network when explicitly enabled
- Using AI Assist for chat, coding, attribute identification, transcript processing, and code analysis

## Version 0.9.10

Version 0.9.10 improves graph exploration with a new network layout, configurable grouping, reliable pinning, and controls for larger projects.

Highlights include:

- fCoSE network auto layout with grouping by type enabled by default and automatic layout when graph mode opens
- Graph settings for grouping by source/object, type, or attribute values, with spacing, label room, and advanced layout controls
- Pin objects or relationship endpoints to preserve their positions during layout, with visible pin badges
- Adaptive zoom and fit behavior for large graphs, plus labels that scale with item sizes
- A reorganized graph toolbar; sources and codes are hidden initially and can be enabled through filters
- Windows installers and portable ZIPs, macOS Apple Silicon and Intel packages, and Linux AppImage and DEB packages

KanQual remains under active development. Interfaces, AI workflows, packaging, and setup may continue to evolve as the application approaches version 1.0.

## Installation

Release packaging targets:

- Windows x64: installer and portable ZIP
- macOS: Apple Silicon and Intel app/DMG builds
- Linux x64: AppImage and DEB builds

Available builds are published on the [GitHub Releases page](https://github.com/KanQual/kanqual/releases).

## Sample Data

Explore KanQual with a fictional, AI-generated dataset about undergraduate students' sense of belonging on a college campus.

- [Download interview transcripts (ZIP)](https://github.com/KanQual/kanqual/releases/download/sample-data-v1.0.0/belonging-transcripts.zip): 18 Word transcripts, labeled as fictional demonstration data.
- [Download sample multimedia (ZIP)](https://github.com/KanQual/kanqual/releases/download/sample-data-v1.0.0/belonging-media.zip): 3 PDF event fliers, 3 image event fliers, 2 synthetic student audio diaries, and 1 captioned university promotion video, plus transcripts and a preview gallery.

Extract the ZIP files, create a demonstration project, and add the documents and media through the appropriate source-upload tabs. These are source files, not project-backup archives. All people, events, and accounts are fictional; the recordings use synthesized voices.

## Product Principles

- Local-first: project data remains on the host device unless network collaboration is enabled
- Collaborative when needed: KanQual can remain device-only or be shared over a trusted network
- Open source: the codebase is available under the Apache License 2.0
- Grounded AI: AI Assist works with project content, embeddings, and traceable citations

## AI Assist

AI Assist is optional and project-aware. It currently supports:

- Project chat grounded in project content
- AI-assisted coding workflows
- Attribute identification for sources and objects
- AI-assisted code analysis
- Transcript processing and review
- Local embedding-model downloads and project embedding builds

AI Assist requires model and runtime configuration in Settings. In network collaboration mode, remote clients use the host machine's AI runtime and project embeddings.

## Data And Privacy

KanQual stores application and project data in its bundled PostgreSQL runtime and stores uploaded source files in app-managed local storage. Normal use does not require a hosted cloud backend. Network collaboration and AI providers are optional features controlled through application settings.

## Tech Stack

- Frontend: React 19, TypeScript, and Vite
- Desktop shell: Tauri 2
- Native layer: Rust
- Database: PostgreSQL 17
- Optional AI runtime: Ollama and configured model providers
- Local embeddings: Candle with a multilingual E5 workflow

## Licensing

KanQual is licensed under the Apache License 2.0.

See:

- [LICENSE](LICENSE)
- [LICENSES.md](LICENSES.md)
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## Contributing

Contributions, issue reports, and feedback are welcome.

## AI Transparency

This project is developed through human and AI collaboration.

- **AI model:** OpenAI Astra 6.0
- **License:** Apache-2.0
- **Human contributor:** Mehmet Cansoy

We believe in transparency about AI usage in software development.
