# MonAgent / Eden Agent

MonAgent is a local Rust agent runtime with a React/Vite client and Electron desktop shell. The workspace contains the host-independent `AgentCore`, the Rust `Server`, the `frontend` client and desktop shell, official connectors, and development scripts.

## Licensing

Current versions are **source-available for noncommercial use** under the [PolyForm Noncommercial License 1.0.0](LICENSE). Commercial use requires a [separate written commercial license](COMMERCIAL-LICENSE.md).

This is not an OSI-approved open-source license because commercial use is restricted. Versions previously distributed under MIT remain available under the terms that accompanied those copies. See [LICENSING.md](LICENSING.md) for the transition and scope.

Third-party dependencies and character, Spine, voice, model, game and trademark materials are not covered by the MonAgent software license. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Development

Requirements: Rust 1.85+, Node.js 22+ and npm.

```bash
npm run dev
```

The local Rust server listens on `127.0.0.1:40092` by default. The web client communicates with it through the generated WebSocket JSON-RPC client and Blob endpoints.

## Character assets

Character binaries are intentionally not bundled with this source repository. Keep static artwork and Spine exports in a separate local `AgentAssets` repository, then import them from **Configuration → Character Configuration → Visual Resources**. Existing local Arona paths can be migrated with:

```bash
node Script/Project/MigrateCharacterAssets.mjs ../AgentAssets
```

Do not publish an asset repository until the origin and redistribution rights of every file have been verified.
