# KanQual

![AI-Generated License Badge](vibe-coded-badge.svg)

KanQual is a free, open-source, local-first qualitative research application for coding, memoing, reporting, visualization, and AI-assisted analysis. It is developed by Mehmet Cansoy, Associate Professor of Sociology at Fairfield University.

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

## Version 0.9.5

Version 0.9.5 moves KanQual to its current PostgreSQL-only application architecture and substantially expands the working research interface.

Highlights include:

- An app-owned bundled PostgreSQL runtime with guided administrator and project setup
- Dedicated databases and file storage for individual projects
- Expanded source, object, relationship, code, annotation, graph, and timeline workflows
- Redesigned audio and video coding controls
- Improved reports, project exports, snapshots, and full administrative backups
- A first-run guide covering project creation, users, sources, coding, and code assignment
- Broader localization coverage and a consolidated Lucide icon system
- Cross-platform packaging for Windows, macOS, and Linux

KanQual remains under active development. Interfaces, AI workflows, packaging, and setup may continue to evolve as the application approaches version 1.0.

## Installation

Release packaging targets:

- Windows x64: installer and portable ZIP
- macOS: Apple Silicon and Intel app/DMG builds
- Linux x64: AppImage and DEB builds

Available builds are published on the [GitHub Releases page](https://github.com/KanQual/kanqual/releases).

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

- **AI models:** OpenAI GPT-5.4 and Anthropic Claude Opus 4.5
- **License:** Apache-2.0
- **Human contributor:** Mehmet Cansoy

We believe in transparency about AI usage in software development.
