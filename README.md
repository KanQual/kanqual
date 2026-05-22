# Kanqual

![AI-Generated License Badge](vibe-coded-badge.svg)


Kanqual is a free, open-source, local-first qualitative research application for coding, memoing, reporting, and AI-assisted analysis by Mehmet Cansoy, Associate Professor of Sociology at Fairfield University.

It is built as a desktop app with Tauri, React, TypeScript, Rust, and an embedded PocketBase backend. It is built on Windows 11, but also confirmed to work on Windows 10, MacOS 26.5, and Ubuntu 26.04. 

## What Kanqual Does

Kanqual is designed for qualitative analysis that need to stay grounded in text data while still supporting collaboration, and the option to utilize local AI tools.

Core capabilities include:

- Project-based qualitative coding of text data
- Detailed roles and permissions for collaboration
- Local-first storage with optional collaboration
- Extensive logs for auditing
- Importing data from other software, exporting data out in multiple formats
- Reporting across annotations, codes, and users
- AI-assisted chat, coding, attribute identification, document processing, and code analysis

## Licensing

Kanqual is licensed under the Apache License 2.0.

See:

- [LICENSE](LICENSE)
- [LICENSES.md](LICENSES.md)
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## Status

Current app version: `0.9.3`

Kanqual is under active development. Interfaces, AI workflows, packaging details, and setup expectations may continue to evolve as the releases are refined for v1.0.

## Key Product Principles

- Local-first: your project data lives on the host device, not in a hosted cloud service
- Collaborative when you want it: Kanqual can stay local-only or be shared across a trusted local network
- Open source: the codebase is available under Apache 2.0
- Grounded AI: AI Assist is designed around project content, embeddings, and traceable citations

## AI Assist Overview

AI Assist is optional and project-aware.

Kanqual currently supports:

- Project chat grounded in project content
- AI-assisted coding workflows
- Attribute identification for cases and documents
- AI-assisted code analysis
- Document processing and review workflows
- Local embedding model download and project embedding builds

AI Assist depends on local model/runtime setup in App Settings. In networked collaboration mode, remote clients use the host machine's AI runtime and project embeddings rather than their own local machine state.

## Tech Stack

- Frontend: React 19, TypeScript, Vite
- Desktop shell: Tauri v2
- Native layer: Rust
- Local backend/database: PocketBase
- Optional AI runtime: Ollama
- Local embeddings: Candle + multilingual-e5 workflow

## Contributing

Contributions, issue reports, and feedback are welcome.

## Short Description

Kanqual is qualitative coding software that is free, open-source, local-first, collaborative, and increasingly AI-assisted without requiring a hosted cloud backend.

## 🤖 AI Transparency

This project human + ai collaboration.

- **AI Model**: OpenAI and Anthropic GPT 5.4 and Claude Opus 4.5
- **License**: Apache-2.0
- **Human Contributor**: Mehmet Cansoy

We believe in transparency about AI usage in software development.
