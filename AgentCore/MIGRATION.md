# AgentCore Python to Rust migration

This file is the acceptance ledger for replacing `../AgentCore`. A row is only
marked complete when the Rust implementation has tests and the Server no longer
needs the Python implementation for that capability.

## Boundary

- `mon-agent-core` owns provider-neutral agent semantics and reusable native
  services.
- `mon-agent-protocol` owns the versioned Server/sidecar wire contract.
- `mon-agent-runtime` owns sessions, cancellation, callback routing, isolation,
  and process lifecycle.
- Mon-specific persistence, HTTP routes, UI events, credentials, and connector
  implementations remain in `Server`. They call the Rust runtime instead of
  importing Python AgentCore.
- Server-hosted model providers and business tools may initially execute through
  callbacks over the protocol. Generic local coding tools move into Rust.

## Acceptance matrix

| Area | Python source | Rust target | Status |
| --- | --- | --- | --- |
| Messages and wire shapes | `types.py` | `mon-agent-core/message.rs` | Implemented including custom/summary/thinking blocks with parity fixtures |
| Event stream | `event_stream.py` | `mon-agent-core/event.rs` | Implemented through the sidecar protocol and integration tests |
| Agent loop | `agent_loop.py` | `mon-agent-core/engine.rs` | Double loop, streaming, dynamic hooks and stop policy implemented |
| Agent state and queues | `agent.py` | `mon-agent-core/agent.rs`, `queue.rs` | Base implementation complete |
| Tool registry/validation/errors | `tool_registry.py`, `tool_validation.py`, `tool_errors.py` | `mon-agent-core/tool.rs`, `validation.rs` | Registry, prepared arguments, Python-compatible JSON Schema subset, output validation and structured failures implemented |
| Token counting | `token_counting.py` | `mon-agent-core/token_counting.rs` | Implemented with model-aware tiktoken, Python parity fixtures and provider-usage anchoring |
| Runtime control protocol | n/a | `mon-agent-protocol`, `mon-agent-runtime` | Sessions, turns, cancellation, model/tool/hook callbacks implemented |
| Read/list/grep/find/get_diff | `coding_agent/tools/*` | `mon-agent-tools` | Implemented natively with workspace confinement, ignore/glob behavior, structured Git diffs, truncation, images and tests |
| Write/edit/apply patch | `coding_agent/tools/*` | `mon-agent-tools` | Implemented natively with serialized mutation, structured diffs, multi-file prevalidation/rollback and tests |
| Bash/process sessions | `bash_executor.py`, `coding_agent/tools/process_*` | `mon-agent-tools` | Implemented natively with process groups, yield/poll/stdin/terminate, bounded streaming capture and tests |
| Skills/resources/prompts | `harness/resources.py`, `harness/skills.py` | `mon-agent-tools/skills.rs` + Server resource policy | Native discovery, ignore rules, YAML parsing and validation complete |
| Context compaction | `harness/compaction/*` | `mon-agent-core/compaction.rs` | Planning, prompt construction, finalization and context rebuild complete |
| Session JSONL and migrations | `harness/session/*`, `coding_agent/persistence/*` | Server persistence + native context protocol | Host boundary complete; Rust rebuilds model context |
| Settings/auth/model catalog | `coding_agent/settings/*`, model/auth modules | Server | Host boundary complete; credentials never enter reusable core storage |
| Extensions/event bus | `coding_agent/extensions/*`, `event_bus.py` | Server plugin host + protocol callbacks | Host boundary complete; trusted plugins remain isolated from core |
| Multi-agent control/mailboxes | `multi_agent/*` | `mon-agent-core/multi_agent.rs` | Native state machine and `agent.control` protocol integrated |
| Proxy stream compatibility | `proxy.py` | Server adapter/direct provider adapter | Host boundary complete |
| HTML export and ANSI rendering | `coding_agent/export_html/*` | Server/UI utility | UI boundary complete |
| Server integration | direct `mon_agent_core` imports | native runtime client | Production imports and Python package dependency removed |
| Distribution | Python package | platform sidecar binaries | Package scripts, SHA-256 files, Server lookup and Windows/Linux/macOS glibc/musl CI matrix implemented |

## Completion gates

1. Rust unit and integration tests cover every implemented row.
2. Recorded Python fixtures and Rust outputs agree for messages, loop events,
   tool failures, compaction, sessions, and multi-agent state transitions.
3. `Server` passes its test suite using the Rust sidecar by default.
4. Production Server source has no runtime import of `mon_agent_core`.
5. Windows, Linux glibc/musl, and macOS binaries are built with checksums and a
   documented lookup/override mechanism.
6. Shutdown, crash recovery, cancellation, oversized frames, slow consumers,
   concurrent sessions, and tool/model timeouts have automated coverage.

## Verification snapshot

Verified on 2026-08-17:

- `cargo fmt --all --check`
- `cargo clippy --workspace --all-targets --locked -- -D warnings`
- `cargo test --workspace --locked` (51 tests passed)
- Server full suite against the bundled Rust release sidecar (396 tests passed,
  3 environment-dependent skips, 10 subtests passed)
- Server environment contains no installed `mon-agent-core` Python package and
  production source/lock files contain no `mon_agent_core` import.
- Windows x64 release packaging produced a stripped executable and SHA-256
  checksum; the CI matrix covers Windows x64/ARM64, Linux x64/ARM64 glibc and
  musl, and macOS Intel/Apple Silicon.
