# KanQual

![Human + AI Collaboration: OpenAI Astra 6.0](vibe-coded-badge.svg?v=astra-6.0)

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

## Version 0.9.9

Version 0.9.9 improves full-installation restore in Admin Settings, fixes administrator-session checks, and simplifies the backup and password steps.

Highlights include:

- Backup selection and password validation in Admin Settings, followed by a dedicated restore workflow on the login background
- A strongly recommended recovery backup that users can choose to skip; the current administrator password is required only when creating that backup
- A shared four-card backup summary and a separate new-administrator-password screen
- Continue opens the password step without restarting or asking for the validated backup password again; passwords remain in memory and must be re-entered if the app is closed or reloaded
- Restoration blocks normal app commands, stops PostgreSQL before replacing data, and retains recovery handling for failed or interrupted restores
- Clearer labels, consistent button ordering, and login-sized restore screens that scroll on smaller displays
- Windows installers and portable ZIPs, macOS Apple Silicon and Intel packages, and Linux AppImage and DEB packages

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

- **AI model:** OpenAI Astra 6.0
- **License:** Apache-2.0
- **Human contributor:** Mehmet Cansoy

We believe in transparency about AI usage in software development.
