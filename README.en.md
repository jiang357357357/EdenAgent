# Eden Agent

Canonical repository: [jiang357357357/EdenAgent](https://github.com/jiang357357357/EdenAgent)

A local-first, persistent TypeScript agent host using the public pi SDK.

React / Vite · Electron · Node.js 22.23.1 · SQLite · WebSocket JSON-RPC

[简体中文](README.md) · **English**

> Migration is in progress. Recent business, recovery and distribution code has not been executed or accepted. Source availability does not prove completion of P0–P5. See the [implementation tracker](文档/技术/Eden%20Agent%20TS%20迁移实施跟踪.md) and [business plan](文档/技术/ts-migration/业务优先长期计划.md).

Eden Agent draws inspiration from the Shittim Chest in Blue Archive. It is an independent source-available project, unaffiliated with the original work or its publishers.

## Architecture

Electron supervises two independent Node hosts: Eden (`mon`, port 40092) and Local (`local`, port 40093). The development web client uses port 40091. Each host calls pi through `packages/runtime-pi`; the browser accesses its selected realm through JSON-RPC and Blob endpoints.

| Location | Responsibility |
| --- | --- |
| `Server/src` | TypeScript host, business modules and transport |
| `packages/runtime-pi` | The only package importing pi directly |
| `packages/api`, `packages/store` | Protocol schemas, types, SQLite and migration infrastructure |
| `packages/plugin-sdk`, `packages/plugin-host` | Agent-authored plugins and isolated version lifecycle |
| `packages/execution`, `packages/integrations` | Execution boundaries and external integrations |
| `frontend/web`, `frontend/desktop` | React client and Electron shell |
| `Server/connectors/official` | TypeScript connector plugins and assets |
| `Archive/2026-09-10-rust-connectors` | Archived Rust workers and helpers |
| `Archive/2026-09-09-rust-runtime` | Historical Rust AgentCore and Server |

The host and connectors use Node/TypeScript. The separate Windows desktop pointer observer still uses Rust.

## Realms and models

The two hosts keep separate processes, capability tokens, databases, files and credentials. Events are committed before broadcast. Default new roots are `Data/realms/mon/v2` and `Data/realms/local/v2`; old production data is not automatically copied or migrated in place.

Mon models come from verified Mon Core connections, including actor and director bindings. Local models use local configuration or `EDEN_AGENT_MODEL=provider/model`. Independent child-model profiles stay within their realm; updating a profile does not silently change existing task snapshots.

## Development

Use Node.js 22.23.1 and npm. Install root dependencies and the frontend packager dependencies:

```sh
npm ci
npm --prefix frontend ci
```

Configure `.monconfig` from `.monconfig.example` as needed. Never commit real data, model credentials or capability tokens.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the TS hosts, web client and Electron |
| `npm run dev:server` | Start a single configured TS host |
| `npm run dev:web` | Start the web client |
| `npm run dev:desktop` | Start the desktop development environment |
| `npm run generate:rpc` | Generate the browser entry from TS contracts and template |
| `npm run build:server` | Build the host and offline migration tools |

These are script entry points, not claims of successful execution. Current work prioritizes business implementation, followed by writing tests; tests and acceptance runs require the user's explicit request.

Linux isolation uses bubblewrap and prlimit. Explicit Windows host execution through PowerShell has been implemented in source; there is no built-in Windows sandbox. Workspace commands can use an administrator-configured external isolation adapter; plugin, MCP and skill isolation still need platform integration. Packaging for an OS does not imply every isolated feature works there. Missing sandbox support must not silently fall back to host execution.

## Agent-authored plugins

The `eden_plugin` tool and plugin development page expose guidance, draft read/write, validation, declared tests, exact-version installation and activation. Existing draft replacement requires its current `draftRevision`; compiled artifacts have a separate `revision` and require a matching successful report before installation.

Workspace access needs user authorization. Generated code and editor templates do not run automatically. Generated plugins are constrained single-file TypeScript tools, not unrestricted npm applications. Connector components use the unified package registry, version authorization and isolated Node workers; each instance additionally requires resolved-resource grants.

## Migration and distribution

See the [migration guide](文档/技术/ts-migration/数据迁移操作.md), [desktop distribution guide](文档/技术/ts-migration/桌面发行操作.md) and [script documentation](Script/Project/README.md).

The distribution workflow assembles TS, Node, Electron and portable connector workers. Signing, file inventories, separate version installation and managed launch tools are implemented in source. No signed release from the current changes has been built or accepted. Automatic extraction and managed launch are implemented in source. System shortcuts, launcher upgrades and complete data upgrade/rollback coordination remain unfinished. Selecting an older application does not restore its database schema.

Host execution uses the current OS account and does not isolate one realm's files from the other. Permission approval remains separate, and enabling host commands does not bypass sandbox requirements for MCP stdio, skills or plugins.

## Documentation and licensing

[Design](文档/技术/Eden%20Agent%20TypeScript%20宿主与%20pi%20实现方案.md) · [Engineering constraints](文档/技术/Eden%20Agent%20TypeScript%20工程约束.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

Character binaries are managed separately, for example in a local `AgentAssets` repository. Third-party characters, Spine assets, voices, models, game content and trademarks are not covered by this project's software license.

Source is available for noncommercial use under [PolyForm Noncommercial 1.0.0](LICENSE), not an OSI-approved open-source license. Commercial use requires [separate written authorization](COMMERCIAL-LICENSE.md). See [LICENSING.md](LICENSING.md) and [third-party notices](THIRD-PARTY-NOTICES.md).
