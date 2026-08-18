# Mon AgentCore Rust

Rust implementation of the Mon local agent runtime. This repository is being
developed as the native replacement for the former Python `AgentCore` and is
verified against the same event and message contracts.

## Workspace

- `mon-agent-core`: agent loop, messages, tools, cancellation, queues, and events.
- `mon-agent-protocol`: versioned Server-to-Runtime NDJSON contract.
- `mon-agent-runtime`: native sidecar executable. Standard output is reserved
  for protocol frames; diagnostics are written to standard error.

## Development

```powershell
cargo fmt --all --check
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
```

Run the sidecar over standard IO:

```powershell
cargo run -p mon-agent-runtime -- --transport=stdio
```

The first supported request is an initialization handshake:

```json
{"type":"runtime.initialize","requestID":"req_1","protocolVersion":1,"serverVersion":"dev"}
```

## Distribution

Build a release artifact and its SHA-256 checksum on Windows:

```powershell
.\scripts\package.ps1
```

On Linux or macOS:

```sh
sh ./scripts/package.sh
```

Artifacts are written below `dist/<platform>/`. A packaged MonAgent copies that
directory into `Server/bin/<platform>/`; the Server then starts the executable
as a private stdio sidecar. `MON_AGENT_RUNTIME_PATH` overrides bundled lookup.
