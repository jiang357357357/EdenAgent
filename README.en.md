<div align="center">

# Eden Agent

**A local-first, persistent, embeddable agent runtime written in Rust**

React / Vite client · Electron desktop app · WebSocket JSON-RPC · SQLite

[![CI](https://github.com/jiang357357357/EdenAgent/actions/workflows/ci.yml/badge.svg)](https://github.com/jiang357357357/EdenAgent/actions/workflows/ci.yml)
![Rust 1.85+](https://img.shields.io/badge/Rust-1.85%2B-dea584?logo=rust&logoColor=white)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)
![Version](https://img.shields.io/badge/version-1.8.0-e67700)
![License](https://img.shields.io/badge/license-PolyForm%20Noncommercial-f3a712)

[简体中文](README.md) · **English**

</div>

> “And they shall make an ark of shittim wood...”<br>
> “And there I will meet with thee...”
>
> — Exodus 25:10, 25:22 (KJV)

Eden Agent is inspired by the “Shittim Chest” from *Blue Archive*. This is an independent source-available project and is not affiliated with or endorsed by the original work or its publishers.

<p align="center">
  <img src="docs/assets/eden-agent-runtime.png" alt="Eden Agent running interface" width="100%">
</p>

> [!IMPORTANT]
> Eden Agent is under active development, and its protocols and configuration formats may still change. The current source is available for noncommercial use under PolyForm Noncommercial 1.0.0. This is not an OSI-approved open-source license; commercial use requires a separate license.

## Overview

Eden Agent runs the agent loop, tool execution, persistence, and desktop experience locally. The desktop supervises separate Rust Server processes for Eden and Local. The frontend talks only to the active realm through a generated WebSocket JSON-RPC client and Blob endpoints—there is no Python sidecar or legacy native bridge.

### Capabilities

| Area | Features |
| --- | --- |
| Agent runtime | Streaming conversations, context management, compaction, tool loops, and session recovery |
| Local workspace | File browsing and editing, controlled command execution, and workspace switching |
| Model services | OpenAI, DeepSeek, Ollama, and custom OpenAI-compatible services |
| Character experience | Full character profiles, static art, Spine animation, GSV speech synthesis, and transcription settings |
| Extensibility | Skills, plugins, multi-agent orchestration, scheduled jobs, MCP, and connectors |
| Data and security | SQLite persistence, capability tokens, permission approval, fail-closed sandboxing, and Blob storage |
| Official connectors | Hearts of Iron IV, Victoria 3, OpenTTD, and Lichess |

## Architecture

```mermaid
flowchart LR
    Desktop[Electron desktop shell] --> Web[React / Vite client]
    Web -->|Eden RPC / Blob| Mon[Eden Server :40092]
    Web -->|Local RPC / Blob| Local[Local Server :40093]
    Desktop -->|separately supervises| Mon
    Desktop -->|separately supervises| Local
    Mon --> MonStore[(mon SQLite / Blob)]
    Local --> LocalStore[(local SQLite / Blob)]
    Mon --> Core[AgentCore + Eden Core]
    Local --> LocalCore[AgentCore + local model]
```

The realms use different ports, capability tokens, SQLite databases, Blob roots, logs, plugins, user skills, subagents, and connector directories, and model credentials are not shared between their processes. Local model secrets live only in `Data/realms/local/local-runtime.json`. Once a database is bound to a realm, the other realm cannot open it. Each Server persists events before broadcasting them. `AgentCore` remains host-independent and has no dependency on HTTP, SQLite, Electron, or a specific model provider.

## Repository layout

| Path | Purpose |
| --- | --- |
| [`AgentCore`](AgentCore) | Host-independent Rust library crates for domain types, the agent loop, context, and tool execution |
| [`Server`](https://github.com/jiang357357357/EdenAgentServer) | Rust host-service submodule for protocol, storage, models, permissions, and extensions |
| [`frontend`](https://github.com/jiang357357357/EdenAgentFrontend) | React/Vite client and Electron desktop-shell submodule |
| [`Connectors`](Connectors) | Official installable connectors and workers |
| [`Script`](Script) | Development launchers, configuration readers, packaging, and migration tools |
| [`文档`](文档) | Design notes, runbooks, and acceptance material |

## Quick start

### Requirements

- Rust 1.85 or newer
- Node.js 22 or newer
- npm
- A Linux or Windows desktop environment

### Clone and run

```bash
git clone --recurse-submodules https://github.com/jiang357357357/EdenAgent.git
cd EdenAgent
npm ci
npm --prefix frontend ci
cp .monconfig.example .monconfig
npm run dev
```

Default endpoints:

- Web client: `http://127.0.0.1:40091`
- Eden Server: `http://127.0.0.1:40092`
- Local Server: `http://127.0.0.1:40093`
- Health checks: `http://127.0.0.1:40092/readyz` and `http://127.0.0.1:40093/readyz`

After the desktop app starts, open **Configuration → Model Service** to set the model name, API endpoint, and key. Credentials should remain local—never commit `.monconfig`, runtime configuration, or logs.

### Run individual components

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Web client, Electron, and both isolated Rust Servers |
| `npm run dev:server` | Safely start one Rust Server; Eden by default, or Local with `EDEN_AGENT_RUNTIME_ORIGIN=local` |
| `npm run dev:web` | Start only the Web client |
| `npm run dev:desktop` | Start the desktop development environment |
| `npm run generate:rpc` | Regenerate the TypeScript RPC client from Rust API types |

## Character and visual assets

Character binaries are intentionally excluded from the source repositories. Keep static artwork and Spine exports in a separate local `AgentAssets` repository, then import them from **Configuration → Character Configuration → Visual Resources**.

To migrate existing local asset paths:

```bash
node Script/Project/MigrateCharacterAssets.mjs ../AgentAssets
```

Do not publish an asset repository until the origin and redistribution rights of every file have been verified. Third-party character, Spine, voice, model, game, and trademark materials are not covered by the Eden Agent software license.

## Development and verification

```bash
# Rust
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

# Frontend
npm --prefix frontend/web run typecheck
npm --prefix frontend/web test
npm --prefix frontend/desktop test
```

GitHub Actions runs the same core checks on every push and pull request.

## Security principles

- The Server binds to `127.0.0.1` by default.
- Each realm has its own local process, port, capability token, and durable data directories.
- The renderer connects only to the active realm using its short-lived capability token.
- File writes, command execution, and external communication go through the permission policy.
- Command tools are registered only when an OS sandbox is available; otherwise they fail closed.
- Events are persisted before they are broadcast to clients.

Read [SECURITY.md](SECURITY.md) before reporting a security issue. Do not disclose credentials or vulnerability details in a public Issue.

## Documentation

- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Licensing guide](LICENSING.md)
- [Third-party notices](THIRD-PARTY-NOTICES.md)
- [Technical documentation](文档)

## License

Current versions are source-available for noncommercial use under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use requires a [separate written commercial license](COMMERCIAL-LICENSE.md). See [LICENSING.md](LICENSING.md) for the transition and historical-version scope.

---

<div align="center">

If Eden Agent is useful to you, consider starring the repository, opening an Issue, or contributing an improvement.

</div>
